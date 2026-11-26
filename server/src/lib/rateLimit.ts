import { readFileSync } from 'node:fs';
import { BlockList, isIP } from 'node:net';
import type { MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { env } from '../env.js';

const strip = (ip: string) => ip.trim().replace(/^::ffff:/i, '');
const isLoopback = (ip: string) => ip === '::1' || ip.startsWith('127.');

/** IPv4 default-route gateways from the text of /proc/net/route (little-endian hex). */
export function defaultGateways(routeText: string): string[] {
  const out: string[] = [];
  for (const line of routeText.split('\n').slice(1)) {
    const c = line.trim().split(/\s+/);
    if (c.length < 3 || c[1] !== '00000000' || !/^[0-9A-Fa-f]{8}$/.test(c[2]) || c[2] === '00000000') continue;
    const n = parseInt(c[2], 16);
    out.push([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255].join('.'));
  }
  return out;
}
let gatewayCache: string[] | undefined;
function gateways(): string[] {
  if (!gatewayCache) { try { gatewayCache = defaultGateways(readFileSync('/proc/net/route', 'utf8')); } catch { gatewayCache = []; } }
  return gatewayCache;
}

/** Parse a TRUST_PROXY value: comma-separated IPs and/or CIDR ranges, `gateway` (this host's IPv4 default-route gateway, e.g. the Docker bridge), or `*`. */
function parseTrust(trustProxy: string) {
  const all = new BlockList();
  let any = false;
  for (const raw of trustProxy.split(',').map((x) => x.trim()).filter(Boolean)) {
    if (raw === '*') { any = true; continue; }
    if (raw === 'gateway') { for (const g of gateways()) all.addAddress(g, 'ipv4'); continue; }
    const [addr, bits] = raw.split('/');
    const a = strip(addr);
    const fam = isIP(a);
    if (!fam) continue;
    const type = fam === 6 ? 'ipv6' : 'ipv4';
    try { if (bits !== undefined) all.addSubnet(a, Number(bits), type); else all.addAddress(a, type); } catch { /* ignore bad entry */ }
  }
  return (ip: string) => any || isLoopback(ip) || all.check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4');
}

/**
 * Pick the client address for rate limiting by walking the proxy chain right to left.
 * The chain is X-Forwarded-For entries followed by the socket peer. Starting at the peer,
 * each address that is a trusted proxy (loopback, or listed in TRUST_PROXY as IPs or CIDR
 * ranges, or `*` for all) lets us move one entry left. We stop at the first untrusted
 * address and use it as the client. Consequences:
 * - Direct callers (untrusted peer) are keyed by their socket address; a spoofed header is ignored.
 * - Single proxy on loopback: the entry it appended is the client.
 * - CDN then local proxy: list the CDN ranges in TRUST_PROXY to get per-user buckets. Unlisted,
 *   the CDN edge is the first untrusted address, so users are bucketed per edge (conservative).
 * - A non-IP or empty entry stops the walk at the last trusted address.
 * - `*` trusts every hop, so the leftmost entry is used. Only use it when the proxy overwrites the header.
 * Loopback is always trusted, so any local process can choose its own bucket via the header.
 */
export function clientIp(peer: string | undefined, xff: string | undefined, trustProxy = ''): string {
  const p = strip(peer || '') || 'local';
  const trusted = parseTrust(trustProxy);
  if (!xff || !trusted(p)) return p;
  const chain = xff.split(',').map(strip).filter(Boolean);
  let cur = p;
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!isIP(chain[i])) return cur;
    cur = chain[i];
    if (!trusted(cur)) return cur;
  }
  return cur;
}

/** In-memory sliding-window rate limiter, keyed by client IP (plus user id when available). */
export function rateLimit(opts: { limit: number; windowMs: number }): MiddlewareHandler<any> {
  const hits = new Map<string, number[]>();
  return async (c, next) => {
    let peer: string | undefined;
    try { peer = getConnInfo(c).remote.address; } catch { /* no socket info (tests) */ }
    const ip = clientIp(peer, c.req.header('x-forwarded-for'), env.trustProxy);
    let userId = '';
    try { userId = (c.get as any)('user')?.id ?? ''; } catch { /* pre-auth routes */ }
    const key = `${c.req.path}|${ip}|${userId}`;
    const nowMs = Date.now();
    const arr = (hits.get(key) ?? []).filter((t) => nowMs - t < opts.windowMs);
    if (arr.length >= opts.limit) {
      hits.set(key, arr);
      return c.json({ error: 'Too many requests, slow down' }, 429);
    }
    arr.push(nowMs);
    hits.set(key, arr);
    if (hits.size > 5000) { for (const k of hits.keys()) { hits.delete(k); if (hits.size <= 2500) break; } }
    await next();
  };
}
