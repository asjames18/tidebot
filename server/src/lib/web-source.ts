import { safeFetch } from './ssrf.js';

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  mdash: '—',
  ndash: '–',
  hellip: '…',
};

/**
 * Decode common named and numeric HTML entities in a single pass so
 * double-encoded entities like `&amp;lt;` stay `&lt;` instead of becoming `<`.
 */
export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const cp = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
        return match;
      }
      return String.fromCodePoint(cp);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

export function parseWebResponse(url: string, contentType: string, raw: string) {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  if (mime === 'application/json' || mime.endsWith('+json')) {
    return { title: url, content: raw.slice(0, 16000), format: 'json' as const };
  }
  if ((mime.startsWith('text/') && !mime.includes('html')) || mime === 'application/xml' || (mime.endsWith('+xml') && !mime.includes('xhtml'))) {
    return { title: url, content: raw.trim().slice(0, 15000), format: 'text' as const };
  }
  if (!mime.includes('html')) throw new Error('This source is not a readable web page or text file.');

  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeHtmlEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() || url : url;
  const stripped = raw
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<title[\s\S]*?<\/title>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<template[\s\S]*?<\/template>/gi, ' ')
    .replace(/<\/(p|div|h1|h2|h3|h4|li|tr|br|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const content = decodeHtmlEntities(stripped)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
    .slice(0, 15000);
  return { title, content, format: 'text' as const };
}

export async function readWebSource(url: string, signal?: AbortSignal) {
  const { status, contentType, text: raw } = await safeFetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,text/plain,text/markdown,application/json',
    },
    timeoutMs: 12_000,
    maxBytes: 1_000_000,
    signal,
  });
  if (status < 200 || status >= 300) throw new Error(`The source returned HTTP ${status}.`);
  return parseWebResponse(url, contentType, raw);
}
