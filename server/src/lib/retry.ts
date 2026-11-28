const MAX_RETRY_AFTER_MS = 30_000;

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function readHeader(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  if (typeof (headers as { get?: unknown }).get === 'function') {
    const val = (headers as { get: (k: string) => string | null }).get(name);
    return typeof val === 'string' && val.trim() ? val.trim() : null;
  }
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    if (k.toLowerCase() !== target) continue;
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    if (Array.isArray(v) && typeof v[0] === 'string' && v[0].trim()) return v[0].trim();
  }
  return null;
}

/**
 * Parse a `Retry-After` header (numeric delta-seconds or RFC 9110 HTTP-date)
 * from either a Fetch `Headers` object or a plain header record on `err.headers`
 * or `err.response.headers`. Returns milliseconds clamped to `[1, maxWaitMs]`,
 * or `null` when absent/invalid/in the past.
 */
export function parseRetryAfterMs(err: unknown, nowMs = Date.now(), maxWaitMs = MAX_RETRY_AFTER_MS): number | null {
  const e = err as { headers?: unknown; response?: { headers?: unknown } } | null | undefined;
  const raw = readHeader(e?.headers, 'retry-after') ?? readHeader(e?.response?.headers, 'retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    return seconds > 0 ? Math.min(seconds * 1000, maxWaitMs) : null;
  }
  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) {
    const delta = dateMs - nowMs;
    return delta > 0 ? Math.min(delta, maxWaitMs) : null;
  }
  return null;
}

function isAbortError(e: unknown): boolean {
  const name = (e as { name?: unknown } | null | undefined)?.name;
  return name === 'AbortError' || name === 'APIUserAbortError';
}

/** Retry transient provider failures (429 / 5xx / network) with backoff. Honors Retry-After when present. */
export async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal, delaysMs = [1000, 2500, 6000]): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
    }
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      if (signal?.aborted || isAbortError(e)) throw e;
      const status = e?.status ?? e?.response?.status;
      const transient = status === 429 || (typeof status === 'number' && status >= 500) || status === undefined;
      if (!transient || attempt === delaysMs.length) throw e;
      const retryAfterMs = parseRetryAfterMs(e);
      const wait = retryAfterMs ?? delaysMs[attempt] + Math.random() * 400;
      console.warn(`[llm] transient provider error (status ${status ?? 'network'}), retrying in ${Math.round(wait)}ms (attempt ${attempt + 1})`);
      await sleepAbortable(wait, signal);
      if (signal?.aborted) throw lastErr;
    }
  }
  throw lastErr;
}
