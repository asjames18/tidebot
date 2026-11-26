// Central log redaction (Phase 5.2, issue #35): no secret value may reach a log
// line. Call sites pass the raw text (or Error) and get back a string with
// every known key replaced by [redacted].
//
// Known keys are the API keys in the environment (.env / process.env) plus any
// extra values the caller holds — e.g. a key decrypted from the DB, which may
// differ from the env value when the operator set it in the studio UI. The
// helper never reads the DB itself, so it stays importable from anywhere
// without a db/llm import cycle.
import { env } from '../env.js';

/** Values shorter than this are never treated as secrets (avoids redacting
 *  common short words that happen to equal a test/placeholder value). */
const MIN_SECRET_LEN = 8;

function collectSecrets(extraSecrets: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [
    env.openrouterKey,
    env.xaiKey,
    env.customApiKey,
    env.composioKey,
    env.orgoKey,
    ...extraSecrets,
  ]) {
    const secret = (value ?? '').trim();
    if (secret.length < MIN_SECRET_LEN || seen.has(secret)) continue;
    seen.add(secret);
    out.push(secret);
  }
  // Longest first: a key that contains another key as a substring is replaced
  // whole instead of leaving a partial value behind.
  return out.sort((a, b) => b.length - a.length);
}

/**
 * Return `value` as a string with every known secret replaced by `[redacted]`.
 * Accepts strings, Errors (message + stack are both redacted), and anything
 * else String()-able. Never throws: on any failure it returns a safe
 * placeholder instead of leaking the raw value.
 */
export function redactSecrets(value: unknown, extraSecrets: string[] = []): string {
  try {
    const text =
      value instanceof Error
        ? `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`
        : String(value ?? '');
    let out = text;
    for (const secret of collectSecrets(extraSecrets)) {
      out = out.split(secret).join('[redacted]');
    }
    return out;
  } catch {
    return '[redacted]';
  }
}
