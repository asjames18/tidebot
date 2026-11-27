import type { MiddlewareHandler } from 'hono';

/**
 * Parse a `TRUST_PROXY` setting into a hop count:
 * - `'1'` / `'true'` -> 1 trusted reverse proxy hop
 * - positive integer `N` -> `min(N, 16)` trusted hops
 * - empty / `'0'` / `'false'` / invalid -> 0 (ignore `X-Forwarded-For`)
 */
export function parseTrustProxyHops(raw: string | number | boolean | undefined): number {
  if (raw === true) return 1;
  if (raw === false || raw === undefined || raw === null) return 0;
  if (typeof raw === 'number') return Number.isInteger(raw) && raw > 0 ? Math.min(raw, 16) : 0;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === '0' || trimmed === 'false') return 0;
  if (trimmed === 'true') return 1;
  if (/^\d+$/.test(trimmed)) return Math.min(Number(trimmed), 16);
  return 0;
}

/**
 * Resolve the rate-limit client IP. By default (`trustProxyHops === 0`),
 * `X-Forwarded-For` is ignored so callers cannot spoof arbitrary values to
 * bypass `/api/auth/*` rate limits. When behind `N` trusted reverse proxies,
 * selects the hop recorded by the proxy from the right side of the chain so a
 * client-prepended spoofed entry cannot override it.
 */
export function resolveClientIp(opts: {
  forwardedFor?: string | null;
  remoteAddress?: string | null;
  trustProxyHops?: number;
}): string {
  const hops = opts.trustProxyHops ?? 0;
  if (hops > 0 && opts.forwardedFor) {
    const parts = opts.forwardedFor
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      return parts[Math.max(0, parts.length - hops)];
    }
  }
  const remote = (opts.remoteAddress ?? '').trim();
  return remote || 'local';
}

function normalizePath(p: string): string {
  return p.length > 1 ? p.replace(/\/+$/, '') || '/' : p;
}

/** In-memory sliding-window rate limiter, keyed by client IP (plus user id when available). */
export function rateLimit(opts: {
  limit: number;
  windowMs: number;
  trustProxy?: boolean | number;
  maxEntries?: number;
}): MiddlewareHandler<any> {
  const hits = new Map<string, number[]>();
  const maxEntries = opts.maxEntries ?? 5000;
  return async (c, next) => {
    const trustProxyHops = opts.trustProxy !== undefined
      ? parseTrustProxyHops(opts.trustProxy)
      : parseTrustProxyHops(process.env.TRUST_PROXY);
    const remoteAddress = (c.env as any)?.incoming?.socket?.remoteAddress as string | undefined;
    const ip = resolveClientIp({
      forwardedFor: c.req.header('x-forwarded-for'),
      remoteAddress,
      trustProxyHops,
    });
    let userId = '';
    try { userId = (c.get as any)('user')?.id ?? ''; } catch { /* pre-auth routes */ }
    const key = `${normalizePath(c.req.path)}|${ip}|${userId}`;
    const nowMs = Date.now();
    const arr = (hits.get(key) ?? []).filter((t) => nowMs - t < opts.windowMs);
    if (arr.length >= opts.limit) {
      hits.set(key, arr);
      const retryAfterSec = Math.max(1, Math.ceil((arr[0] + opts.windowMs - nowMs) / 1000));
      c.header('Retry-After', String(retryAfterSec));
      return c.json({ error: 'Too many requests, slow down' }, 429);
    }
    arr.push(nowMs);
    hits.set(key, arr);
    if (hits.size > maxEntries) {
      // Prune expired buckets first so spoofed/idle keys cannot evict active rate limits.
      for (const [k, times] of hits) {
        if (!times.length || nowMs - times[times.length - 1] >= opts.windowMs) hits.delete(k);
      }
      if (hits.size > maxEntries) {
        const target = Math.floor(maxEntries / 2);
        for (const k of hits.keys()) {
          hits.delete(k);
          if (hits.size <= target) break;
        }
      }
    }
    await next();
  };
}
