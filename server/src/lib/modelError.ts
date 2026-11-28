// Actionable setup-path model errors (development plan §2.2).
//
// A failed model call on the setup path must name the provider, the likely
// cause, and the next step — never a raw stack trace in the UI. This module
// is the classifier; the wire-in is one line in checkConnection
// (server/src/agent/llm.ts) once PR #2's setup-area work merges, because
// that PR owns llm.ts / routes-config.ts / AppSettings.tsx right now.
//
// Safety: the raw message is only pattern-matched, never echoed back, so no
// key material can leak through an explanation. The one exception is the
// fallback case, which includes a redacted, truncated excerpt.

export interface ModelErrorExplanation {
  /** Display name of the provider, e.g. "OpenRouter". */
  provider: string;
  /** Short what-happened line. */
  title: string;
  /** Likely cause, in plain language. */
  cause: string;
  /** Concrete next step for the user. */
  nextStep: string;
  /** Redacted excerpt of the raw error, only for unrecognised failures. */
  detail?: string;
}

export function providerDisplayName(provider: string): string {
  switch ((provider || '').toLowerCase()) {
    case 'openrouter':
      return 'OpenRouter';
    case 'xai':
      return 'xAI';
    case 'custom':
      return 'your custom provider';
    default:
      return provider ? `your ${provider} provider` : 'your model provider';
  }
}

interface Signals {
  status?: number;
  message: string;
  code: string;
}

function collectSignals(error: unknown): Signals {
  const messages: string[] = [];
  const codes: string[] = [];
  let status: number | undefined;
  // Walk the error + cause chain: undici nests network failures as
  // TypeError('fetch failed') with cause { code: 'ECONNREFUSED' }, and the
  // OpenAI SDK nests API errors under .error.
  let current: any = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current === 'string') {
      messages.push(current);
      break;
    }
    if (typeof current.message === 'string' && current.message) messages.push(current.message);
    if (typeof current.code === 'string' && current.code) codes.push(current.code);
    if (typeof current.status === 'number') status ??= current.status;
    if (typeof current.statusCode === 'number') status ??= current.statusCode;
    if (current.error && current.error !== current) {
      current = current.error;
      continue;
    }
    current = current.cause;
  }
  const message = messages.join(' ');
  // A bare status can also hide inside the message ("HTTP 401", "401 ...").
  if (status === undefined) {
    const m = message.match(/\b(?:HTTP\s+)?([45]\d\d)\b/);
    if (m) status = Number(m[1]);
  }
  return { status, message, code: codes.join(' ') };
}

// Key-shaped values are scrubbed before anything is echoed back.
function redactKeys(text: string): string {
  return text
    .replace(/sk-or-v1-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/xai-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, '[redacted]')
    .slice(0, 200);
}

export function explainModelError(
  provider: string,
  model: string,
  error: unknown,
): ModelErrorExplanation {
  const name = providerDisplayName(provider);
  const isCustom = (provider || '').toLowerCase() === 'custom';
  const safeModel = (model || '').slice(0, 80) || 'the selected model';
  const { status, message, code } = collectSignals(error);
  const hay = `${code} ${message}`.toLowerCase();

  if (/api[ _]key[^.]{0,40}missing|missing[^.]{0,40}api[ _]key|no api[ _]key|unconfigured/.test(hay)) {
    return {
      provider: name,
      title: 'No API key configured',
      cause: `No key is saved for ${name}.`,
      nextStep: isCustom
        ? 'Enter the key your endpoint expects in Settings → Models, or leave it blank if your local server needs no key — then test again.'
        : `Paste your ${name} key in Settings → Models and test again.`,
    };
  }
  if (status === 401 || /incorrect api key|invalid api key|unauthenticated|unauthorized|authentication failed/.test(hay)) {
    return {
      provider: name,
      title: 'Your API key was rejected',
      cause: `The provider refused the key — it is missing, mistyped, or revoked.`,
      nextStep: isCustom
        ? 'Check the key your endpoint expects in Settings → Models, or leave it blank if your local server needs no key — then test again.'
        : `Paste a fresh key from the ${name} dashboard into Settings → Models and test again.`,
    };
  }
  if (status === 402 || /payment required|insufficient|out of credits|billing/.test(hay)) {
    return {
      provider: name,
      title: 'Out of credits',
      cause: `The ${name} account has no usable balance for this call.`,
      nextStep: 'Top up credits on the provider dashboard, or switch to a free-tier model in Settings → Models.',
    };
  }
  if (status === 404 || /model not found|no endpoints|model .* not (available|found)|not found/.test(hay)) {
    return {
      provider: name,
      title: 'Model not available',
      cause: `The model ${safeModel} is not served for this provider and key.`,
      nextStep: 'Pick a model from the curated list in Settings → Models, or check the model ID spelling.',
    };
  }
  if (status === 429 || /rate limit|too many requests/.test(hay)) {
    return {
      provider: name,
      title: 'Rate-limited',
      cause: `The provider throttled requests for this key.`,
      nextStep: 'Wait a minute and test again; if it keeps happening, switch to a less busy model.',
    };
  }
  if (/enotfound|getaddrinfo|dns|name resolution|name or service not known/.test(hay)) {
    return {
      provider: name,
      title: `Can't resolve ${name}`,
      cause: `This machine could not look up the ${name} address — a DNS problem.`,
      nextStep: 'Check your internet connection and DNS settings, then test again.',
    };
  }
  if (/econnrefused|connection refused|fetch failed|failed to fetch|network error|socket hang up/.test(hay)) {
    if (isCustom) {
      return {
        provider: name,
        title: "Can't reach your local model server",
        cause: 'Nothing is listening at the custom base URL — Ollama (or your local server) is not running.',
        nextStep: 'Start Ollama (ollama serve) and check the base URL in Settings → Models, then test again.',
      };
    }
    return {
      provider: name,
      title: `Can't reach ${name}`,
      cause: `The request never reached ${name} — a network or DNS problem on this machine.`,
      nextStep: 'Check your internet connection and test again.',
    };
  }
  if (/timed out|timeout|aborterror|timedout/.test(hay)) {
    return {
      provider: name,
      title: 'The provider timed out',
      cause: `${name} did not answer within 15 seconds.`,
      nextStep: 'Test again — a slow provider or a busy model usually answers on retry.',
    };
  }
  if (/no reply|empty response|returned no/.test(hay)) {
    return {
      provider: name,
      title: 'The provider answered with nothing',
      cause: 'The model returned an empty reply.',
      nextStep: 'Try another model — some models need different settings to answer.',
    };
  }
  if (status === 400 || /bad request|invalid request/.test(hay)) {
    return {
      provider: name,
      title: 'The provider rejected the request',
      cause: `The model or request settings are not accepted by ${name}.`,
      nextStep: 'Try a different model from the curated list in Settings → Models.',
    };
  }
  if ((status !== undefined && status >= 500) || /internal server error|bad gateway|service unavailable|overloaded/.test(hay)) {
    return {
      provider: name,
      title: 'The provider had a problem',
      cause: `${name} returned a server error.`,
      nextStep: 'Wait a minute and test again.',
    };
  }
  return {
    provider: name,
    title: 'The connection test failed',
    cause: `The provider returned an error TideBot does not recognise yet.`,
    nextStep: 'Check the key and model in Settings → Models, then test again.',
    detail: redactKeys(message.trim()) || undefined,
  };
}

/** One-line UI string: "OpenRouter — <title>. Likely cause: <cause> Next step: <step>" */
export function formatModelError(provider: string, model: string, error: unknown): string {
  const e = explainModelError(provider, model, error);
  const detail = e.detail ? ` Detail: ${e.detail}` : '';
  return `${e.provider} — ${e.title}. Likely cause: ${e.cause} Next step: ${e.nextStep}${detail}`;
}
