import { memo, useEffect, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { copyText } from '../lib/clipboard';
import { useStore } from '../store';

function PreBlock({ node: _n, children, ...props }: any) {
  const preRef = useRef<HTMLPreElement>(null);
  const timerRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);
  const copy = () => {
    const text = preRef.current?.innerText ?? '';
    if (!text) return;
    void copyText(text).then((ok) => {
      if (!ok) {
        useStore.getState().notify('Could not copy code');
        return;
      }
      setCopied(true);
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try { navigator.vibrate(12); } catch { /* ignore haptics unsupported */ }
      }
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => { setCopied(false); timerRef.current = null; }, 1600);
    });
  };
  return (
    <div className="md-pre-wrap" style={{ position: 'relative' }}>
      <pre ref={preRef} {...props}>{children}</pre>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied code' : 'Copy code'}
        className={`md-copy-btn${copied ? ' is-copied' : ''}`}
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
    </div>
  );
}

export type MarkdownLinkKind = 'blocked' | 'loopback' | 'native' | 'link';

function isLoopbackOrUnspecifiedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '0.0.0.0' || h === '::' || h === '::1' || h === '::ffff:0:0') return true;
  if (/^127\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)$/.test(h)) return true;
  if (/^::ffff:127\./.test(h) || /^::ffff:7f[\da-f]{2}:[\da-f]{1,4}$/.test(h)) return true;
  return false;
}

/**
 * Classify a Markdown link target so host-only loopback/unspecified links
 * (including `*.localhost`, `127.0.0.0/8`, `0.0.0.0`, `[::]`, IPv4-mapped IPv6,
 * and protocol-relative `//localhost`) are neutralized, and empty/non-HTTP
 * schemes never render broken `<a href="">` tags.
 */
export function classifyMarkdownHref(href: string | undefined): MarkdownLinkKind {
  const raw = (href ?? '').trim();
  if (!raw) return 'blocked';
  // Markdown percent-encodes IPv6 authority brackets before rendering.
  const normalized = raw.replace(/^((?:https?:)?\/\/)%5B([0-9a-f:.]+)%5D(?=[:/?#]|$)/i, '$1[$2]');
  if ((normalized.startsWith('/') && !normalized.startsWith('//')) || normalized.startsWith('#') || normalized.startsWith('./') || normalized.startsWith('../')) {
    return 'link';
  }
  try {
    const u = normalized.startsWith('//') ? new URL(`https:${normalized}`) : new URL(normalized);
    if (u.protocol === 'mailto:' || u.protocol === 'tel:') return 'native';
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'blocked';
    if (isLoopbackOrUnspecifiedHost(u.hostname)) return 'loopback';
    return 'link';
  } catch {
    return 'blocked';
  }
}

const components: Components = {
  a: ({ node: _n, href, children }) => {
    const kind = classifyMarkdownHref(href);
    if (kind === 'loopback') {
      return <span className="md-localhost" title="Localhost link from the agent — only reachable on the host machine">{children}</span>;
    }
    if (kind === 'blocked') {
      return <span>{children}</span>;
    }
    const isNativeScheme = kind === 'native';
    return (
      <a
        href={href}
        target={isNativeScheme ? undefined : '_blank'}
        rel={isNativeScheme ? undefined : 'noreferrer noopener'}
        onClick={() => {
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
            try { navigator.vibrate(8); } catch {}
          }
        }}
      >
        {children}
      </a>
    );
  },
  table: ({ node: _n, ...props }) => (
    <div className="md-table" role="region" aria-label="Scrollable table" tabIndex={0}><table {...props} /></div>
  ),
  pre: PreBlock,
};

/** Assistant message markdown: paragraphs, lists, blockquotes, inline code, code blocks (screen 02), tables. */
export const Markdown = memo(function Markdown({ text, allowImages = true }: { text: string; allowImages?: boolean }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} disallowedElements={allowImages ? undefined : ['img']}>{text}</ReactMarkdown>
    </div>
  );
});
