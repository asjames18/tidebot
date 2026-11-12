import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Bot } from '@shared/types';
import { api } from '../lib/api';
import { configApi } from '../lib/configApi';
import { displayName, useStore } from '../store';
import { useConfigUI } from '../configStore';
import { Icon } from './Icon';
import { Menu } from './Menu';
import { endCall, isCallActive, startCall, useVoice } from '../voice/call';
import { useDictation } from '../voice/dictation';

const MAX_H = 200;
const drafts = new Map<string, string>();
const EFFORT_CYCLE: Bot['effort'][] = ['low', 'medium', 'high', 'xhigh'];

const SLASH_COMMANDS: { cmd: string; desc: string; template?: string; action?: 'clear' | 'apps' | 'fast' | 'deep' | 'models' }[] = [
  { cmd: '/search', desc: 'Search the live web and summarize sources', template: 'Use web_search to research: ' },
  { cmd: '/fetch', desc: 'Fetch and extract clean text from a webpage URL', template: 'Use fetch_webpage to read and summarize: https://' },
  { cmd: '/file', desc: 'Save a markdown or code deliverable to the Library', template: 'Use save_file to create a detailed markdown report named report.md about: ' },
  { cmd: '/draft', desc: 'Create an interactive Email or Slack draft card', template: 'Use draft_message to draft an email to ' },
  { cmd: '/task', desc: 'Track a new task on the Tasks board', template: 'Use create_task to track: ' },
  { cmd: '/routine', desc: 'Schedule a recurring cron routine', template: 'Use create_routine to run every weekday at 9:00 AM: ' },
  { cmd: '/apps', desc: 'Open Composio App Marketplace (Gmail, GitHub, Slack, Notion…)', action: 'apps' },
  { cmd: '/models', desc: 'Open OpenRouter / BYOM Model Configuration', action: 'models' },
  { cmd: '/fast', desc: 'Switch operator to Low reasoning effort (Fastest)', action: 'fast' },
  { cmd: '/deep', desc: 'Switch operator to High reasoning effort (Deep CoT)', action: 'deep' },
  { cmd: '/clear', desc: 'Start a fresh conversation', action: 'clear' },
];

export function Composer({ bot, running }: { bot: Bot; running: boolean }) {
  const [text, setText] = useState(() => drafts.get(bot.id) ?? '');
  const [sending, setSending] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const setModal = useStore((s) => s.setModal);

  // Per-bot drafts.
  useEffect(() => { setText(drafts.get(bot.id) ?? ''); setError(null); ref.current?.focus(); }, [bot.id]);
  useEffect(() => { drafts.set(bot.id, text); }, [bot.id, text]);

  // Auto-grow.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, MAX_H)}px`;
    el.style.overflowY = el.scrollHeight > MAX_H ? 'auto' : 'hidden';
  }, [text]);

  // ⌘I focuses the prompt.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); ref.current?.focus(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(10); } catch {}
    }
    setSending(true); setError(null);
    try {
      await api.send(bot.id, t);
      setText('');
      drafts.delete(bot.id);
    } catch (e) {
      setError((e as Error).message || 'Message failed to send');
    } finally {
      setSending(false);
      ref.current?.focus();
    }
  };

  const stop = () => api.interrupt(bot.id).catch((e) => setError(e.message));
  const fresh = () => api.fresh(bot.id).catch((e) => setError(e.message));

  const enhance = async () => {
    const raw = text.trim();
    if (!raw || enhancing) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
    setEnhancing(true);
    setError(null);
    try {
      const res = await configApi.enhancePrompt(raw, bot.name, bot.label);
      if (res.ok && res.text) {
        setText(res.text);
        requestAnimationFrame(() => ref.current?.focus());
      }
    } catch (e) {
      setError((e as Error).message || 'Could not enhance prompt');
    } finally {
      setEnhancing(false);
    }
  };

  // Dictation: insert the transcript at the cursor.
  const insertText = (t: string) => {
    const el = ref.current;
    setText((cur) => {
      const start = el && document.activeElement === el ? el.selectionStart : cur.length;
      const end = el && document.activeElement === el ? el.selectionEnd : cur.length;
      const before = cur.slice(0, start);
      const after = cur.slice(end);
      const pre = before && !/\s$/.test(before) ? ' ' : '';
      const post = after && !/^\s/.test(after) ? ' ' : '';
      requestAnimationFrame(() => { if (el) { const pos = before.length + pre.length + t.length; el.focus(); el.setSelectionRange(pos, pos); } });
      return before + pre + t + post + after;
    });
  };
  const dictation = useDictation(insertText, setError, bot.voiceLanguage);
  const inCall = useVoice((s) => isCallActive(s) && s.botId === bot.id);
  const llmConfig = useConfigUI((s) => s.llmConfig);
  const activeModel = bot.model || llmConfig?.defaultModel || 'anthropic/claude-3.7-sonnet';

  const hasText = text.trim().length > 0;
  const multiline = text.includes('\n') || (ref.current?.scrollHeight ?? 0) > 30;
  const slashQuery = text.startsWith('/') && !text.includes(' ') && !text.includes('\n') ? text.toLowerCase() : null;
  const matchingSlash = slashQuery ? SLASH_COMMANDS.filter((c) => c.cmd.startsWith(slashQuery)) : [];

  const runSlash = (item: (typeof SLASH_COMMANDS)[number]) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
    if (item.template) {
      setText(item.template);
      requestAnimationFrame(() => ref.current?.focus());
      return;
    }
    setText('');
    drafts.delete(bot.id);
    if (item.action === 'clear') fresh();
    else if (item.action === 'apps') setModal('apps');
    else if (item.action === 'models') useConfigUI.getState().openAppSettings('models');
    else if (item.action === 'fast' || item.action === 'deep') {
      const effort = item.action === 'fast' ? 'low' : 'high';
      configApi.updateBot(bot.id, { effort }).then(({ bot: updated }) => {
        useStore.setState((s) => ({ bots: s.bots.map((x) => (x.id === updated.id ? updated : x)) }));
      }).catch(() => {});
    }
  };

  return (
    <div className="composer-area">
      {error && <div className="composer__error">{error} <button type="button" className="link-btn" onClick={() => setError(null)}>Dismiss</button></div>}
      {matchingSlash.length > 0 && (
        <div className="slash-palette" role="listbox" aria-label="Slash commands">
          {matchingSlash.map((item) => (
            <button
              key={item.cmd}
              type="button"
              className="slash-palette__item"
              onClick={() => runSlash(item)}
            >
              <code className="slash-palette__cmd">{item.cmd}</code>
              <span className="slash-palette__desc">{item.desc}</span>
            </button>
          ))}
        </div>
      )}
      {!hasText && !matchingSlash.length && (
        <div className="composer-quick-bar" role="toolbar" aria-label="Quick mobile shortcuts">
          <button
            type="button"
            className={`composer-quick-chip${bot.effort === 'low' ? ' is-active' : ''}`}
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
              configApi.updateBot(bot.id, { effort: 'low' }).then(({ bot: updated }) => {
                useStore.setState((s) => ({ bots: s.bots.map((x) => (x.id === updated.id ? updated : x)) }));
              }).catch(() => {});
            }}
            title="Fast Mode: Low reasoning latency"
          >
            <span>⚡ Fast</span>
          </button>
          <button
            type="button"
            className={`composer-quick-chip${bot.effort === 'high' ? ' is-active' : ''}`}
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
              configApi.updateBot(bot.id, { effort: 'high' }).then(({ bot: updated }) => {
                useStore.setState((s) => ({ bots: s.bots.map((x) => (x.id === updated.id ? updated : x)) }));
              }).catch(() => {});
            }}
            title="Deep Reasoning Mode"
          >
            <span>🧠 Deep CoT</span>
          </button>
          <button
            type="button"
            className="composer-quick-chip composer-quick-chip--free"
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
              useConfigUI.getState().openAppSettings('models');
            }}
            title="OpenRouter Free Models Catalog"
          >
            <span>🎁 Free Models</span>
          </button>
          <button
            type="button"
            className="composer-quick-chip"
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
              useConfigUI.getState().setView('tasks');
            }}
            title="Switch to Tasks View"
          >
            <span>📋 Tasks</span>
          </button>
          <button
            type="button"
            className="composer-quick-chip"
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
              setModal('apps');
            }}
            title="Open Apps Marketplace"
          >
            <span>🔌 Apps</span>
          </button>
        </div>
      )}
      <div className={`composer${multiline ? ' is-multiline' : ''}`}>
        <div className="composer__left">
          <span className="composer__plus-anchor">
            <button
              type="button"
              className="composer__btn"
              onClick={() => {
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                setMenu(!menu);
              }}
              aria-label="More actions"
              aria-expanded={menu}
            >
              <Icon name="composer_plus" opacity={0.56} />
            </button>
            {menu && (
              <Menu
                placement="above"
                onClose={() => setMenu(false)}
                items={[
                  { label: 'New conversation', onSelect: fresh },
                  { label: 'Connect apps', onSelect: () => setModal('apps') },
                ]}
              />
            )}
          </span>
          <textarea
            ref={ref}
            className="composer__input"
            rows={1}
            value={text}
            placeholder={`Message ${displayName(bot)} (type / for commands)`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Tab' && matchingSlash.length > 0) {
                e.preventDefault();
                runSlash(matchingSlash[0]);
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (matchingSlash.length === 1 && text.trim() === matchingSlash[0].cmd) {
                  runSlash(matchingSlash[0]);
                } else {
                  send();
                }
              }
            }}
            aria-label={`Message ${bot.name}`}
          />
        </div>
        <div className="composer__right">
          {hasText && !slashQuery && (
            <button
              type="button"
              className="composer__btn"
              onClick={enhance}
              disabled={enhancing}
              title="Enhance prompt with AI for clearer tool & deliverable instructions"
              style={{ width: 'auto', padding: '0 8px', fontSize: 11.5, fontWeight: 600, color: '#38BDF8', gap: 4 }}
            >
              <span>{enhancing ? 'Enhancing…' : '✨ Enhance'}</span>
            </button>
          )}
          <button
            type="button"
            className={`composer__btn${dictation.state === 'recording' ? ' is-recording' : dictation.state === 'transcribing' ? ' is-transcribing' : ''}`}
            aria-label={dictation.state === 'recording' ? 'Stop dictation' : 'Dictate'}
            aria-pressed={dictation.state === 'recording'}
            title={dictation.state === 'recording' ? 'Release or click to stop · Esc cancels' : dictation.state === 'transcribing' ? 'Transcribing…' : 'Hold to dictate, or click to start'}
            disabled={dictation.state === 'transcribing'}
            onPointerDown={dictation.onPointerDown}
            onPointerUp={dictation.onPointerUp}
            onKeyDown={dictation.onKeyDown}
            onContextMenu={(e) => e.preventDefault()}
          >
            <Icon name="mic" opacity={0.56} />
          </button>
          {inCall && !hasText ? (
            <button type="button" className="composer__cta is-in-call" onClick={endCall} aria-label="End voice call" title="End voice call">
              <Icon name="voice_a" size={16} />
            </button>
          ) : running && !hasText ? (
            <button type="button" className="composer__cta" onClick={stop} aria-label="Stop" title="Stop">
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <button
              type="button"
              className="composer__cta"
              onClick={hasText ? send : () => {
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
                startCall(bot.id);
              }}
              disabled={hasText && sending}
              aria-label={hasText ? 'Send' : `Start voice chat with ${bot.name}`}
              title={hasText ? 'Send (Enter)' : 'Start voice chat'}
            >
              <Icon name={hasText ? 'arrow_up' : 'voice_a'} size={16} />
            </button>
          )}
        </div>
      </div>
      <footer className="composer-telemetry" aria-label="Workspace telemetry">
        <div className="composer-telemetry__left">
          <button
            type="button"
            className="composer-telemetry__chip"
            onClick={() => useConfigUI.getState().openAppSettings('models')}
            title="Configure OpenRouter / Bring Your Own Model"
          >
            <span className={`composer-telemetry__dot${llmConfig?.isConfigured ? ' is-ok' : ''}`} />
            <span>{llmConfig?.provider?.toUpperCase() ?? 'OPENROUTER'}</span>
            <span className="composer-telemetry__sep">·</span>
            <span className="composer-telemetry__mono">{activeModel}</span>
          </button>
          <button
            type="button"
            className="composer-telemetry__chip"
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
              const cur = bot.effort ?? 'low';
              const next = EFFORT_CYCLE[(EFFORT_CYCLE.indexOf(cur) + 1) % EFFORT_CYCLE.length];
              configApi.updateBot(bot.id, { effort: next }).then(({ bot: updated }) => {
                useStore.setState((s) => ({ bots: s.bots.map((x) => (x.id === updated.id ? updated : x)) }));
              }).catch(() => {});
            }}
            title="Click to cycle reasoning effort (Low = Fastest)"
          >
            <span>EFFORT: {(bot.effort ?? 'medium').toUpperCase()}</span>
          </button>
          <button
            type="button"
            className="composer-telemetry__chip"
            onClick={() => setModal('apps')}
            title="Open Composio Connected Apps Marketplace"
          >
            <span className={`composer-telemetry__dot${llmConfig?.hasComposioKey ? ' is-ok' : ''}`} />
            <span>COMPOSIO {llmConfig?.hasComposioKey ? 'READY' : 'APPS'}</span>
          </button>
        </div>
        <div className="composer-telemetry__right">
          <span><kbd>/</kbd> Commands</span>
          <span><kbd>⌘K</kbd> Search</span>
          <span><kbd>⌘,</kbd> BYOM</span>
        </div>
      </footer>
    </div>
  );
}
