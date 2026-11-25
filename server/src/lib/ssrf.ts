import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';

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
    if (ip.includes('%')) return true;
    const normalized = new URL(`http://[${ip}]`).hostname.slice(1, -1);
    const mapped = normalized.match(/^::ffff:([\da-f]+):([\da-f]+)$/);
    if (mapped) {
      const hi = parseInt(mapped[1], 16);
      const lo = parseInt(mapped[2], 16);
      return isPrivateIp([hi >> 8, hi & 255, lo >> 8, lo & 255].join('.'));
    }
    const [first, second] = normalized.split(':').map((part) => parseInt(part || '0', 16));
    // Require global unicast and exclude transition, special-purpose, and documentation ranges.
    return (first & 0xe000) !== 0x2000
      || (first === 0x2001 && (second < 0x200 || second === 0xdb8))
      || first === 0x2002 || first === 0x3fff;
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
  if (u.username || u.password) throw new Error('URL credentials are not allowed');
  if (isLoopbackHost(host)) {
    if (opts.allowLoopback) return u;
    throw new Error('Loopback URLs are not allowed');
  }
  if (net.isIP(host) && isPrivateIp(host)) throw new Error('Private or reserved IPs are not allowed');
  return u;
}

async function resolveAllowedUrl(raw: string, opts: { allowLoopback?: boolean } = {}) {
  const u = assertUrlHostAllowedSync(raw, opts);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const family = net.isIP(host);
  if (family) return { u, addrs: [{ address: host, family }] };
  let addrs: { address: string; family: number }[];
  try { addrs = await dns.lookup(host, { all: true }); } catch { throw new Error(`Cannot resolve host: ${host}`); }
  if (!addrs.length) throw new Error(`Cannot resolve host: ${host}`);
  for (const a of addrs) {
    if (opts.allowLoopback && isLoopbackHost(a.address)) continue;
    if (isPrivateIp(a.address)) throw new Error('Host resolves to a private or reserved IP');
  }
  return { u, addrs };
}

export async function assertPublicUrl(raw: string, opts: { allowLoopback?: boolean } = {}): Promise<URL> {
  return (await resolveAllowedUrl(raw, opts)).u;
}

const MAX_REDIRECTS = 5;

/** fetch() that re-validates every redirect hop and caps the response body. */
export async function safeFetch(raw: string, init: { headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number } = {}): Promise<{ status: number; contentType: string; text: string }> {
  const maxBytes = init.maxBytes ?? 1_000_000;
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { u, addrs } = await resolveAllowedUrl(current);
    const request = u.protocol === 'https:' ? https.request : http.request;
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = request(u, {
        agent: false,
        headers: { ...init.headers, 'Accept-Encoding': 'identity' },
        signal: AbortSignal.timeout(init.timeoutMs ?? 12_000),
        lookup: (_host, opts, callback) => {
          if (opts.all) callback(null, addrs);
          else callback(null, addrs[0].address, addrs[0].family);
        },
      }, resolve);
      req.once('error', reject);
      req.end();
    });
    const status = res.statusCode ?? 0;
    const contentType = res.headers['content-type'] ?? '';
    if (status >= 300 && status < 400) {
      const loc = res.headers.location;
      res.destroy();
      if (!loc) return { status, contentType, text: '' };
      if (hop === MAX_REDIRECTS) throw new Error('Too many redirects');
      current = new URL(loc, u).toString();
      continue;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of res) {
      total += chunk.byteLength;
      if (total > maxBytes) throw new Error('Response too large');
      chunks.push(chunk);
    }
    return { status, contentType, text: Buffer.concat(chunks).toString('utf8') };
  }
  throw new Error('Too many redirects');
}
