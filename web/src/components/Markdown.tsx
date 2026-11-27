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

const components: Components = {
  a: ({ node: _n, href, children }) => {
    let loopback = false;
    let isNativeScheme = false;
    try {
      // Markdown percent-encodes IPv6 authority brackets before rendering.
      const parsedHref = (href ?? '').replace(/^(https?:\/\/)%5B([0-9a-f:.]+)%5D(?=[:/?#]|$)/i, '$1[$2]');
      const u = new URL(parsedHref);
      const h = u.hostname;
      loopback = h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
      isNativeScheme = u.protocol === 'mailto:' || u.protocol === 'tel:';
    } catch { /* relative links stay links */ }
    if (loopback) return <span className="md-localhost" title="Localhost link from the agent — only reachable on the host machine">{children}</span>;
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
