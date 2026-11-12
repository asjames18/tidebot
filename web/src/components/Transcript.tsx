import { Fragment, memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Bot, LiveState, MessageBody, Row, ToolCallBody } from '@shared/types';
import { BotAvatar, BotAvatarFor } from '../avatar/BotAvatar';
import { clock, dividerLabel } from '../lib/time';
import { useStore } from '../store';
import { ActivityLine } from './ActivityLine';
import { CardRow } from './cards/Cards';
import { Icon } from './Icon';
import { Markdown } from './Markdown';
import { ShaderCanvas } from './ShaderCanvas';
import { useConfigUI } from '../configStore';
import { api } from '../lib/api';

type Item =
  | { kind: 'divider'; key: string; ts: number }
  | { kind: 'group'; key: string; side: 'left' | 'right'; from?: MessageBody['from']; rows: Row[] }
  | { kind: 'steps'; key: string; rows: Row[] }
  | { kind: 'row'; key: string; row: Row };

const DIVIDER_GAP = 60 * 60 * 1000;
const GROUP_GAP = 5 * 60 * 1000;

/** Turns rows into render items: date dividers, grouped bubbles, collapsed tool-call steps, cards, events. */
function buildItems(rows: Row[]): Item[] {
  const items: Item[] = [];
  let prevTs = 0;
  for (const row of rows) {
    if (!prevTs || row.createdAt - prevTs > DIVIDER_GAP) items.push({ kind: 'divider', key: `d${row.seq}`, ts: row.createdAt });
    prevTs = row.createdAt;
    const last = items[items.length - 1];
    const b = row.body;
    if (b.type === 'tool-call') {
      if (last?.kind === 'steps') last.rows.push(row);
      else items.push({ kind: 'steps', key: `s${row.seq}`, rows: [row] });
      continue;
    }
    if (b.type === 'message') {
      if (!b.text && !b.streaming) continue;
      const side = b.role === 'user' && (!b.from || b.from.kind === 'voice') ? 'right' : 'left';
      const sender = b.from ? `${b.from.kind}:${b.from.id}` : b.role;
      const lastRow = last?.kind === 'group' ? last.rows[last.rows.length - 1] : null;
      const lastBody = lastRow?.body as MessageBody | undefined;
      const lastSender = lastBody ? (lastBody.from ? `${lastBody.from.kind}:${lastBody.from.id}` : lastBody.role) : null;
      if (last?.kind === 'group' && lastSender === sender && row.createdAt - lastRow!.createdAt < GROUP_GAP) last.rows.push(row);
      else items.push({ kind: 'group', key: `g${row.seq}`, side, from: b.from, rows: [row] });
      continue;
    }
    items.push({ kind: 'row', key: `r${row.seq}`, row });
  }
  return items;
}

function cornerClass(i: number, n: number) {
  if (n < 2) return '';
  if (i === 0) return ' is-first';
  if (i === n - 1) return ' is-last';
  return ' is-mid';
}

const Bubble = memo(function Bubble({ row, side, pos }: { row: Row; side: 'left' | 'right'; pos: string }) {
  const b = row.body as MessageBody;
  const [showReasoning, setShowReasoning] = useState(false);
  const [copied, setCopied] = useState(false);
  const isThinkingNow = Boolean(b.streaming && b.reasoning && !b.text);
  const reasoningOpen = showReasoning || isThinkingNow;

  const copyMsg = () => {
    if (!b.text) return;
    navigator.clipboard.writeText(b.text).then(() => {
      setCopied(true);
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try { navigator.vibrate(12); } catch {}
      }
      setTimeout(() => setCopied(false), 1600);
    }).catch(() => {});
  };

  const shortModel = b.model ? (b.model.includes('/') ? b.model.split('/').pop()! : b.model) : null;

  return (
    <div className={`bubble-wrap is-${side}`}>
      <div className={`bubble is-${side === 'right' ? 'user' : 'agent'}${pos}${b.streaming ? ' is-streaming' : ''}`}>
        {side === 'left' && b.reasoning && (
          <div className={`bubble__reasoning${reasoningOpen ? ' is-open' : ''}`}>
            <button
              type="button"
              className="bubble__reasoning-toggle"
              onClick={() => setShowReasoning(!showReasoning)}
              aria-expanded={reasoningOpen}
            >
              <span className={`bubble__reasoning-dot${isThinkingNow ? ' is-pulsing' : ''}`} />
              <span>{isThinkingNow ? 'Reasoning in progress…' : 'Thought process'}</span>
              <Icon name="chev_down" size={10} opacity={0.65} className="steps__chev" />
            </button>
            {reasoningOpen && (
              <div className="bubble__reasoning-body">
                {b.reasoning}
              </div>
            )}
          </div>
        )}
        {side === 'right' ? (
          <>
            <div className="bubble__plain">{b.text}</div>
            <div className="bubble__meta-bar bubble__meta-bar--user">
              <button
                type="button"
                className={`bubble__copy-btn${copied ? ' is-copied' : ''}`}
                onClick={copyMsg}
                title="Copy prompt"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </>
        ) : b.text && b.streaming ? (
          <div className="bubble__plain">{b.text}</div>
        ) : b.text ? (
          <Markdown text={b.text} />
        ) : isThinkingNow ? null : (
          <Markdown text=" " />
        )}
        {b.citations && b.citations.length > 0 && (
          <div className="bubble__cites">
            {b.citations.slice(0, 6).map((c, i) => {
              let host = c.url;
              let safe = false;
              try { const u = new URL(c.url); host = u.hostname.replace(/^www\./, ''); safe = u.protocol === 'http:' || u.protocol === 'https:'; } catch { /* keep */ }
              if (!safe) return <span key={i} className="cite-chip" title={c.title ?? c.url}>{host}</span>;
              return <a key={i} className="cite-chip" href={c.url} target="_blank" rel="noreferrer noopener" title={c.title ?? c.url}>{host}</a>;
            })}
          </div>
        )}
        {side === 'left' && !b.streaming && b.text && (
          <div className="bubble__meta-bar">
            {shortModel && <span className="bubble__meta-tag">{shortModel}</span>}
            {b.durationMs && <span className="bubble__meta-tag">{(b.durationMs / 1000).toFixed(1)}s</span>}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
              <button
                type="button"
                className="bubble__copy-btn"
                onClick={() => api.retry(row.botId).catch(() => {})}
                title="Re-run with current model"
              >
                Retry
              </button>
              <button
                type="button"
                className={`bubble__copy-btn${copied ? ' is-copied' : ''}`}
                onClick={copyMsg}
                title="Copy message"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </span>
          </div>
        )}
      </div>
      <span className="bubble__time">{clock(row.createdAt)}</span>
    </div>
  );
});

function SenderLabel({ from }: { from: NonNullable<MessageBody['from']> }) {
  const bot = useStore((s) => (from.kind === 'bot' ? s.bots.find((b) => b.id === from.id) : undefined));
  return (
    <div className="sender-label">
      {bot ? <BotAvatarFor bot={bot} size={16} /> : from.kind === 'routine' ? <Icon name="clock" size={12} opacity={0.56} /> : from.kind === 'voice' ? <Icon name="voice_a" size={12} opacity={0.56} /> : <BotAvatar shape="blob" color="gray" size={16} />}
      <span>{from.kind === 'routine' ? `Routine · ${from.name}` : from.kind === 'voice' ? 'Asked on a voice call' : `From ${from.name}`}</span>
    </div>
  );
}

function Steps({ rows, hideRunning }: { rows: Row[]; hideRunning: boolean }) {
  const [open, setOpen] = useState(false);
  const calls = rows.map((r) => r.body as ToolCallBody);
  const visible = hideRunning ? calls.filter((c) => c.status !== 'running') : calls;
  if (!visible.length) return null;
  const n = visible.length;
  return (
    <div className={`steps${open ? ' is-open' : ''}`}>
      <button type="button" className="steps__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {n} {n === 1 ? 'step' : 'steps'}
        <Icon name="chev_down" size={10} opacity={0.66} className="steps__chev" />
      </button>
      {open && (
        <ul className="steps__list">
          {visible.map((c) => (
            <li key={c.callId} className={`step is-${c.status}`}>
              <span className="step__dot" />
              <span className="step__label">{c.label}</span>
              {c.summary && <span className="step__summary">{c.summary}</span>}
              {c.status === 'error' && <span className="step__summary">Failed</span>}
              {c.status === 'denied' && <span className="step__summary">Not allowed</span>}
              {c.screenshot && <img className="step__shot" src={c.screenshot} alt="" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SystemRow({ row }: { row: Row }) {
  const b = row.body;
  if (b.type === 'event') return <div className="system-event">{b.text}</div>;
  if (b.type === 'notice') return <div className={`notice is-${b.tone ?? 'info'}`}>{b.text}</div>;
  if (b.type === 'card') return <CardRow row={row} />;
  return null;
}

interface Props { bot: Bot; rows: Row[]; live: LiveState | undefined; loaded: boolean }

const RENDER_WINDOW = 80;

export function Transcript({ bot, rows, live, loaded }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const visibleRows = expanded ? rows : rows.slice(-RENDER_WINDOW);
  const hiddenCount = rows.length - visibleRows.length;
  const items = useMemo(() => buildItems(visibleRows), [visibleRows]);

  const running = !!live?.isRunning;
  const waiting = !running && (!!live?.awaiting || live?.activity?.kind === 'waiting_for_you');
  const last = rows[rows.length - 1];
  const streamingNow = last?.body.type === 'message' && last.body.role === 'assistant' && !!last.body.streaming;
  const showActivity = (running && !streamingNow) || waiting;

  // Keep pinned to the bottom while new content arrives, unless the user scrolled up.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });
  // Jump to bottom when switching bots.
  useLayoutEffect(() => {
    stick.current = true;
    setExpanded(false);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [bot.id]);

  const onScroll = () => {
    const el = scrollRef.current!;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stick.current = dist < 40;
    setShowJump(dist > 200);
  };

  const jump = () => {
    const el = scrollRef.current!;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(10); } catch {}
    }
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  return (
    <div className="transcript-wrap">
    <div className="transcript" ref={scrollRef} onScroll={onScroll}>
      <div className="transcript__col">
        {!loaded && rows.length === 0 && (
          <div className="transcript-skeleton" aria-hidden="true">
            <div className="skel-bubble is-left" style={{ width: '58%' }} />
            <div className="skel-bubble is-right" style={{ width: '38%' }} />
            <div className="skel-bubble is-left" style={{ width: '72%' }} />
            <div className="skel-bubble is-left" style={{ width: '46%' }} />
          </div>
        )}
        {hiddenCount > 0 && (
          <button type="button" className="earlier-btn" onClick={() => setExpanded(true)}>
            Show earlier messages ({hiddenCount} more)
          </button>
        )}
        {loaded && rows.length === 0 && <EmptyChat bot={bot} />}
        {items.map((it) => {
          switch (it.kind) {
            case 'divider':
              return <div key={it.key} className="divider">{dividerLabel(it.ts)}</div>;
            case 'steps':
              return <Steps key={it.key} rows={it.rows} hideRunning={running} />;
            case 'row':
              return <SystemRow key={it.key} row={it.row} />;
            case 'group':
              return (
                <div key={it.key} className={`group is-${it.side}`}>
                  {it.from && <SenderLabel from={it.from} />}
                  {it.rows.map((r, i) => (
                    <Fragment key={r.seq}><Bubble row={r} side={it.side} pos={cornerClass(i, it.rows.length)} /></Fragment>
                  ))}
                </div>
              );
          }
        })}
        {showActivity && live && <ActivityLine bot={bot} live={live} rows={rows} />}
      </div>
    </div>
      {showJump && (
        <button type="button" className="jump-btn" onClick={jump} aria-label="Scroll to bottom">
          <Icon name="arrow_down" size={16} />
        </button>
      )}
    </div>
  );
}

function EmptyChat({ bot }: { bot: Bot }) {
  const llmConfig = useConfigUI((s) => s.llmConfig);
  const activeModel = bot.model || llmConfig?.defaultModel || 'anthropic/claude-3.7-sonnet';
  const shaderStyle = llmConfig?.shaderStyle || 'aurora';

  const quickPrompts = [
    `Search the web for the latest AI engineering news and summarize top 3 items`,
    `Set up a weekday 8:30 AM routine to brief me on my priorities`,
    `Create a task checklist for launching a new product feature`,
  ];

  return (
    <div className="empty-chat">
      <div className="empty-chat__stage">
        <ShaderCanvas style={shaderStyle} className="empty-chat__shader" opacity={0.78} />
        <div className="empty-chat__stage-inner">
          <div className="empty-chat__badges">
            <span className="tidebot-pill tideos-pill tideos-pill--glow">
              {llmConfig?.provider === 'custom' ? 'CUSTOM BYOM' : llmConfig?.provider === 'xai' ? 'XAI ENGINE' : 'OPENROUTER'}
            </span>
            <button
              type="button"
              className="tidebot-pill tideos-pill tideos-pill--interactive"
              onClick={() => useConfigUI.getState().openAppSettings('models')}
              title="Click to configure OpenRouter key or switch default model"
            >
              {activeModel} · {llmConfig?.isConfigured ? 'Connected' : 'Configure Key →'}
            </button>
          </div>
          <BotAvatarFor bot={bot} size={76} />
          <div className="empty-chat__title">{bot.name}</div>
          {bot.label && <div className="empty-chat__role">{bot.label}</div>}
          <div className="empty-chat__sub">
            {bot.description ||
              (bot.mode === 'teammate'
                ? 'Shared autonomous operator with its own Linux sandbox, web search, and persistent memory.'
                : 'Personal autonomous operator with its own Linux sandbox, web search, and persistent memory.')}
          </div>
          <div className="empty-chat__prompts">
            {quickPrompts.map((p, i) => (
              <button
                key={i}
                type="button"
                className="empty-chat__prompt-chip"
                onClick={() => api.send(bot.id, p).catch(() => useStore.getState().notify('Message failed to send'))}
              >
                <span>{p}</span>
                <span className="empty-chat__prompt-arrow">↗</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
