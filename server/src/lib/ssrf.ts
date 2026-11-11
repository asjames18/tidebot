import dns from 'node:dns/promises';
import net from 'node:net';

/** True for loopback, private, link-local, CGNAT, multicast and reserved addresses. */
export function isPrivateIp(ip: string): boolean {
  const fam = net.isIP(ip);
  if (fam === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 192 && b === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
    return false;
  }
  if (fam === 6) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return true;
    if (low.startsWith('fe8') || low.startsWith('fe9') || low.startsWith('fea') || low.startsWith('feb')) return true;
    if (low.startsWith('fc') || low.startsWith('fd')) return true;
    if (low.startsWith('ff')) return true;
    const m = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateIp(m[1]);
    return false;
  }
  return true;
}

export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (net.isIP(h)) {
    if (h.startsWith('127.')) return true;
    if (h === '::1') return true;
  }
  return false;
}

/** Synchronous check for IP-literal / localhost hostnames (no DNS). Throws on blocked targets. */
export function assertUrlHostAllowedSync(raw: string, opts: { allowLoopback?: boolean } = {}): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('Invalid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('URL must use http or https');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host) throw new Error('URL has no host');
  if (isLoopbackHost(host)) {
    if (opts.allowLoopback) return u;
    throw new Error('Loopback URLs are not allowed');
  }
  if (net.isIP(host) && isPrivateIp(host)) throw new Error('Private or reserved IPs are not allowed');
  return u;
}

/**
 * Full check including DNS resolution of every address. Note: fetch() resolves
 * again afterwards, so a DNS-rebinding window remains; this blocks direct and
 * ordinarily-resolving private targets, which is the practical SSRF surface here.
 */
export async function assertPublicUrl(raw: string, opts: { allowLoopback?: boolean } = {}): Promise<URL> {
  const u = assertUrlHostAllowedSync(raw, opts);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return u;
  let addrs: { address: string }[];
  try { addrs = await dns.lookup(host, { all: true }); } catch { throw new Error(`Cannot resolve host: ${host}`); }
  if (!addrs.length) throw new Error(`Cannot resolve host: ${host}`);
  for (const a of addrs) {
    if (opts.allowLoopback && isLoopbackHost(a.address)) continue;
    if (isPrivateIp(a.address)) throw new Error('Host resolves to a private or reserved IP');
  }
  return u;
}

const MAX_REDIRECTS = 5;

/** fetch() that re-validates every redirect hop and caps the response body. */
export async function safeFetch(raw: string, init: { headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number } = {}): Promise<{ status: number; contentType: string; text: string }> {
  const maxBytes = init.maxBytes ?? 1_000_000;
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = await assertPublicUrl(current);
    const res = await fetch(u, { headers: init.headers, redirect: 'manual', signal: AbortSignal.timeout(init.timeoutMs ?? 12_000) });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return { status: res.status, contentType: res.headers.get('content-type') ?? '', text: '' };
      if (hop === MAX_REDIRECTS) throw new Error('Too many redirects');
      current = new URL(loc, u).toString();
      continue;
    }
    const ct = res.headers.get('content-type') ?? '';
    if (!res.body) return { status: res.status, contentType: ct, text: await res.text().then((t) => t.slice(0, maxBytes)) };
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel().catch(() => {}); throw new Error('Response too large'); }
      chunks.push(value);
    }
    return { status: res.status, contentType: ct, text: Buffer.concat(chunks).toString('utf8') };
  }
  throw new Error('Too many redirects');
}
