import { memo, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

function PreBlock({ node: _n, children, ...props }: any) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const text = preRef.current?.innerText ?? '';
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }).catch(() => {});
  };
  return (
    <div className="md-pre-wrap" style={{ position: 'relative' }}>
      <pre ref={preRef} {...props}>{children}</pre>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy code"
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          padding: '3px 8px',
          fontSize: 11,
          borderRadius: 6,
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface)',
          color: 'var(--fg-secondary)',
          cursor: 'pointer',
          opacity: copied ? 1 : 0.78,
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

const components: Components = {
  a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
  table: ({ node: _n, ...props }) => (
    <div className="md-table"><table {...props} /></div>
  ),
  pre: PreBlock,
};

/** Assistant message markdown: paragraphs, lists, blockquotes, inline code, code blocks (screen 02), tables. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{text}</ReactMarkdown>
    </div>
  );
});
