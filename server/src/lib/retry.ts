const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry transient provider failures (429 / 5xx / network) with backoff. Honors Retry-After when present. */
export async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal, delaysMs = [1000, 2500, 6000]): Promise<T> {
  let lastErr: any;
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      if (signal?.aborted) throw e;
      const status = e?.status ?? e?.response?.status;
      const transient = status === 429 || (typeof status === 'number' && status >= 500) || status === undefined;
      if (!transient || attempt === delaysMs.length) throw e;
      const retryAfter = Number(e?.headers?.['retry-after'] ?? e?.response?.headers?.get?.('retry-after'));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : delaysMs[attempt] + Math.random() * 400;
      console.warn(`[llm] transient provider error (status ${status ?? 'network'}), retrying in ${Math.round(wait)}ms (attempt ${attempt + 1})`);
      await sleep(wait);
      if (signal?.aborted) throw lastErr;
    }
  }
  throw lastErr;
}
