import { isIP } from 'node:net';
import type { MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { env } from '../env.js';

const strip = (ip: string) => ip.trim().replace(/^::ffff:/i, '');
const isLoopback = (ip: string) => ip === '::1' || ip.startsWith('127.');

/**
 * Pick the client address for rate limiting. X-Forwarded-For is attacker-controlled
 * unless the request came through a proxy we trust, so it is honoured only when the
 * socket peer is loopback (the documented reverse-proxy setup) or listed in
 * TRUST_PROXY (comma-separated IPs, or `*` to trust any peer). Then the rightmost
 * entry is used, since that is the one the trusted proxy appended. Supports exactly one
 * trusted proxy hop: behind a chain (CDN then local proxy) the rightmost entry is the CDN
 * edge, not the end user, so clients share buckets per edge. A non-IP or empty header falls
 * back to the peer. Loopback is always trusted, so any local process can pick its own bucket
 * by sending the header; that is acceptable because local callers are already trusted.
 */
export function clientIp(peer: string | undefined, xff: string | undefined, trustProxy = ''): string {
  const p = strip(peer || '') || 'local';
  const list = trustProxy.split(',').map(strip).filter(Boolean);
  const trusted = isLoopback(p) || list.includes('*') || list.includes(p);
  if (!trusted || !xff) return p;
  const last = xff.split(',').map(strip).filter(Boolean).pop();
  return last && isIP(last) ? last : p;
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
