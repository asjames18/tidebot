import { useEffect, useRef, useState } from 'react';
import type { CardBody, Row } from '@shared/types';
import { api, openPopup } from '../../lib/api';
import { copyText } from '../../lib/clipboard';
import { useStore } from '../../store';
import { Icon } from '../Icon';
import { ToolkitLogo } from '../ToolkitLogo';

type Card<K extends CardBody['card']> = Extract<CardBody, { card: K }>;

function useBusy() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(10); } catch {}
    }
    setBusy(key); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message || 'Something went wrong'); }
    finally { busyRef.current = false; setBusy(null); }
  };
  return { busy, error, run };
}

const prettyTool = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const KNOWN: Record<string, string> = { github: 'GitHub', gitlab: 'GitLab', hubspot: 'HubSpot', linkedin: 'LinkedIn', youtube: 'YouTube', clickup: 'ClickUp', googledocs: 'Google Docs', googledrive: 'Google Drive', googlesheets: 'Google Sheets', googlecalendar: 'Google Calendar', googletasks: 'Google Tasks', googlemeet: 'Google Meet' };
/** "googlecalendar" → "Google Calendar", "slack" → "Slack". */
export const humanizeToolkit = (slug: string) => KNOWN[slug.toLowerCase()] ?? slug.replace(/^(google|microsoft)(?=\w)/i, '$1 ').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// ---------------- approval ----------------

const APPROVAL_OUTCOME: Record<string, string> = { allowed: 'Allowed once', always: 'Always allowed', denied: 'Not allowed', expired: 'Expired' };

export function ApprovalCard({ body }: { body: Card<'approval'> }) {
  const { busy, error, run } = useBusy();
  const pending = body.status === 'pending';
  const decide = (d: 'allow' | 'always' | 'deny') => run(d, () => api.approve(body.approvalId, d));
  const name = body.toolkit ? humanizeToolkit(body.toolkit) : prettyTool(body.tool);
  return (
    <div className={`card approval-card${pending ? '' : ' is-resolved'}`}>
      <div className="card__head">
        <ToolkitLogo name={name} logo={body.toolkit ? `https://logos.composio.dev/api/${body.toolkit.toLowerCase()}` : undefined} size={44} />
        <div className="card__titles">
          <div className="card__title">{body.title}</div>
          <div className="card__sub">{name}</div>
        </div>
      </div>
      {body.detail && <div className="card__body">{body.detail}</div>}
      {pending ? (
        <>
          <div className="card__actions">
            <button type="button" className="btn btn--secondary" disabled={!!busy} onClick={() => decide('deny')}>{busy === 'deny' ? 'Denying…' : "Don't allow"}</button>
            <button type="button" className="btn btn--secondary" disabled={!!busy} onClick={() => decide('always')}>{busy === 'always' ? 'Saving…' : 'Always allow'}</button>
            <button type="button" className="btn btn--primary" disabled={!!busy} onClick={() => decide('allow')}>{busy === 'allow' ? 'Allowing…' : 'Allow'}</button>
          </div>
          {error && <div className="card__error" role="alert">{error}</div>}
        </>
      ) : (
        <div className={`card__outcome is-${body.status}`}>
          <Icon name={body.status === 'denied' || body.status === 'expired' ? 'close' : 'check'} size={12} opacity={0.7} />
          {APPROVAL_OUTCOME[body.status] ?? body.status}
        </div>
      )}
    </div>
  );
}

// ---------------- question ----------------

export function QuestionCard({ row, body }: { row: Row; body: Card<'question'> }) {
  const { busy, error, run } = useBusy();
  const pending = body.status === 'pending';
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return (
    <div className={`card question-card${pending ? '' : ' is-resolved'}`}>
      <div className="question-card__head">
        <div className="question-card__q">{body.question}</div>
        <div className="question-card__hint">{pending ? 'Pick an option or reply in your own words' : body.status === 'dismissed' ? 'Skipped' : 'Answered'}</div>
      </div>
      <div className="question-card__options">
        {body.options.map((opt, i) => {
          const chosen = body.answer === opt;
          const isSending = busy === String(i);
          return (
            <button
              key={i}
              type="button"
              className={`question-option${chosen || isSending ? ' is-chosen' : ''}`}
              disabled={!pending || !!busy}
              onClick={() => run(String(i), () => api.answer(row.botId, row.seq, opt))}
            >
              <span className="question-option__key">{letters[i] ?? i + 1}</span>
              <span className="question-option__label">{isSending ? `${opt} · Sending…` : opt}</span>
              {chosen && <Icon name="check" size={12} opacity={0.6} style={{ marginLeft: 'auto', marginTop: 6 }} />}
            </button>
          );
        })}
      </div>
      {pending && (
        <div className="question-card__foot">
          <button type="button" className="link-btn" disabled={!!busy} onClick={() => run('dismiss', () => api.dismiss(row.botId, row.seq))}>{busy === 'dismiss' ? 'Skipping…' : 'Skip'}</button>
        </div>
      )}
      {error && <div className="card__error" role="alert">{error}</div>}
    </div>
  );
}

// ---------------- connect ----------------

export function ConnectCard({ row, body }: { row: Row; body: Card<'connect'> }) {
  const { busy, error, run } = useBusy();
  const [waiting, setWaiting] = useState(false);
  const connectionsVersion = useStore((s) => s.connectionsVersion);
  const pending = body.status === 'pending';

  // Leave the "waiting" state once the server reports a connection change or the card resolves.
  useEffect(() => { setWaiting(false); }, [connectionsVersion, body.status]);

  const connect = () => run('connect', async () => {
    const popup = openPopup('about:blank');
    try {
      const { redirectUrl } = await api.connect(body.toolkit, row.botId, row.seq);
      if (popup) popup.location.href = redirectUrl; else window.open(redirectUrl, '_blank');
      setWaiting(true);
    } catch (e) { popup?.close(); throw e; }
  });

  return (
    <div className={`card connect-card${pending ? '' : ' is-resolved'}`}>
      <div className="card__head">
        <ToolkitLogo name={body.toolkitName} logo={body.logo} size={44} />
        <div className="card__titles">
          <div className="card__title">Connect {body.toolkitName}</div>
          <div className="card__sub">{body.reason}</div>
        </div>
      </div>
      {pending ? (
        <>
          <div className="card__actions">
            <button type="button" className="btn btn--secondary" disabled={!!busy} onClick={() => run('skip', () => api.dismiss(row.botId, row.seq))}>{busy === 'skip' ? 'Skipping…' : 'Skip'}</button>
            <button type="button" className="btn btn--primary" disabled={!!busy} onClick={connect}>{busy === 'connect' ? 'Opening…' : waiting ? 'Waiting for sign-in…' : 'Connect'}</button>
          </div>
          {error && <div className="card__error" role="alert">{error}</div>}
        </>
      ) : (
        <div className={`card__outcome is-${body.status}`}>
          <Icon name={body.status === 'connected' ? 'check' : 'close'} size={12} opacity={0.7} />
          {body.status === 'connected' ? `${body.toolkitName} connected` : 'Skipped'}
        </div>
      )}
    </div>
  );
}

// ---------------- draft (screen 02) ----------------

const CHANNEL_LABEL: Record<string, string> = { email: 'Email', slack: 'Slack', message: 'Chat' };

export function DraftCard({ body }: { body: Card<'draft'> }) {
  const { busy, error, run } = useBusy();
  const user = useStore((s) => s.user);
  const pending = body.status === 'pending';
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | null>(null);
  useEffect(() => () => { if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current); }, []);
  const copy = async () => {
    const ok = await copyText(body.text);
    if (!ok) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(12); } catch {}
    }
    setCopied(true);
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => { setCopied(false); copyTimerRef.current = null; }, 1200);
  };
  const handle = user?.email ? `@${user.email.split('@')[0]}` : '';
  return (
    <div className={`card draft-card${pending ? '' : ' is-resolved'}`}>
      <div className="draft-card__head">
        <span className="draft-card__tile"><Icon name="chat_filled" size={18} color="#FFFFFF" /></span>
        <div className="draft-card__titles">
          <div className="draft-card__channel">{CHANNEL_LABEL[body.channel] ?? 'Message'}</div>
          <div className="draft-card__from">{handle}</div>
        </div>
        <button type="button" className="draft-card__copy" onClick={copy} aria-label="Copy draft" title={copied ? 'Copied' : 'Copy'}>
          <Icon name={copied ? 'check' : 'copy'} size={12} opacity={0.66} />
        </button>
      </div>
      <div className="draft-card__content">
        <div className="draft-card__to">
          <span className="draft-card__to-label">To</span>
          <span className="draft-card__to-avatar">{(body.to.trim()[0] ?? '?').toUpperCase()}</span>
          <span className="draft-card__to-name">{body.to}</span>
        </div>
        {body.subject && <div className="draft-card__subject">{body.subject}</div>}
        <div className="draft-card__text">{body.text}</div>
      </div>
      {pending ? (
        <div className="draft-card__actions">
          <button type="button" className="btn btn--secondary btn--grow" disabled={!!busy} onClick={() => run('discard', () => api.approve(body.approvalId, 'deny'))}>{busy === 'discard' ? 'Discarding…' : 'Discard'}</button>
          <button type="button" className="btn btn--primary btn--grow" disabled={!!busy} onClick={() => run('send', () => api.approve(body.approvalId, 'allow'))}>{busy === 'send' ? 'Sending…' : 'Send'}</button>
        </div>
      ) : (
        <div className={`card__outcome is-${body.status}`} style={{ padding: '0 16px 16px' }}>
          <Icon name={body.status === 'sent' ? 'check' : 'close'} size={12} opacity={0.7} />
          {body.status === 'sent' ? 'Sent' : 'Discarded'}
        </div>
      )}
      {error && <div className="card__error" role="alert" style={{ padding: '0 16px 12px' }}>{error}</div>}
    </div>
  );
}

export function CardRow({ row }: { row: Row }) {
  const b = row.body;
  if (b.type !== 'card') return null;
  switch (b.card) {
    case 'approval': return <ApprovalCard body={b} />;
    case 'question': return <QuestionCard row={row} body={b} />;
    case 'connect': return <ConnectCard row={row} body={b} />;
    case 'draft': return <DraftCard body={b} />;
    default: return null;
  }
}
