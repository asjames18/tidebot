import type { MiddlewareHandler } from 'hono';

/** In-memory sliding-window rate limiter, keyed by client IP (plus user id when available). */
export function rateLimit(opts: { limit: number; windowMs: number }): MiddlewareHandler<any> {
  const hits = new Map<string, number[]>();
  return async (c, next) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
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
