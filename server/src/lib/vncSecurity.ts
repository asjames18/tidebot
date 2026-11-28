import { redactSecrets } from './redact.js';

/**
 * Validates the HTTP `Origin` header on a VNC WebSocket upgrade request to
 * prevent Cross-Site WebSocket Hijacking (CSWSH) from other localhost ports,
 * sibling subdomains, or third-party pages.
 *
 * Non-browser clients that omit `Origin` are permitted (they still require a
 * valid session cookie and bot ownership). Any present `Origin` must be an
 * http(s) URL matching either the request `Host` header or one of the
 * configured TideBot app/server origins.
 */
export function isAllowedVncOrigin(
  originHeader: string | undefined,
  hostHeader: string | undefined,
  allowedUrls: readonly (string | undefined)[] = [],
): boolean {
  if (!originHeader) return true;
  if (originHeader === 'null') return false;
  let originUrl: URL;
  try { originUrl = new URL(originHeader); }
  catch { return false; }
  if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') return false;

  const host = (hostHeader ?? '').trim().toLowerCase();
  if (host && originUrl.host.toLowerCase() === host) return true;

  for (const raw of allowedUrls) {
    if (!raw) continue;
    try {
      const allowed = new URL(raw);
      if (originUrl.origin === allowed.origin) return true;
    } catch {
      // ignore malformed configured URL
    }
  }
  return false;
}

/**
 * Redacts the root-equivalent VNC password (raw or URI-encoded, even if < 8
 * chars as in classic RFB DES), any `token=` query parameter, and all known
 * provider API keys from an error or close reason before logging or sending
 * to the browser.
 */
export function sanitizeVncError(err: unknown, password = '', includeStack = false): string {
  const raw = includeStack
    ? redactSecrets(err, password ? [password, encodeURIComponent(password)] : [])
    : redactSecrets(err instanceof Error ? err.message : String(err ?? ''), password ? [password, encodeURIComponent(password)] : []);

  let out = raw.replace(/([?&]token=)[^&\s'"`)]+/gi, '$1[redacted]');
  if (password) {
    for (const variant of new Set([encodeURIComponent(password), password])) {
      if (variant) out = out.split(variant).join('[redacted]');
    }
  }
  return out;
}

/**
 * Truncates a WebSocket close reason to stay strictly within the RFC 6455
 * 123-byte UTF-8 limit without splitting multi-byte code points.
 */
export function truncateWsCloseReason(reason: string, maxBytes = 120): string {
  if (Buffer.byteLength(reason, 'utf8') <= maxBytes) return reason;
  let out = '';
  let used = 0;
  for (const ch of reason) {
    const bytes = Buffer.byteLength(ch, 'utf8');
    if (used + bytes > maxBytes) break;
    out += ch;
    used += bytes;
  }
  return out;
}
