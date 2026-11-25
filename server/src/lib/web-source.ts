import { safeFetch } from './ssrf.js';

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
  if (contentType.includes('application/json')) {
    return { title: url, content: raw.slice(0, 16000), format: 'json' as const };
  }
  if (contentType.startsWith('text/') && !contentType.includes('html')) {
    return { title: url, content: raw.trim().slice(0, 15000), format: 'text' as const };
  }
  if (!/html|xhtml/i.test(contentType)) throw new Error('This source is not a readable web page or text file.');

  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() || url : url;
  const content = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<\/(p|div|h1|h2|h3|h4|li|tr|br|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
    .slice(0, 15000);
  return { title, content, format: 'text' as const };
}
