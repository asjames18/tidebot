import { useEffect, useRef, useState } from 'react';
import type { Bot, ComputerState, Routine } from '@shared/types';
import { BotAvatarFor } from '../avatar/BotAvatar';
import { api, openPopup } from '../lib/api';
import { botVars } from '../lib/colors';
import { displayName, useSelectedBot, useStore } from '../store';
import { Icon } from './Icon';
import { ToolkitLogo } from './ToolkitLogo';
import { VoiceSettings } from './VoiceSettings';
import { MembersCard } from './MembersCard';
import { useConfigUI } from '../configStore';
import { Glyph } from './config/glyphs';
import { LibraryTab } from './config/LibraryTab';
import { RunHistory } from './config/RunHistory';
import { BotTasks } from './config/TasksView';

export function computerStatusText(c: ComputerState | null): string {
  switch (c?.status) {
    case 'running': return 'Awake';
    case 'starting': case 'resuming': return 'Waking up…';
    case 'creating': return 'Setting up…';
    case 'suspending': return 'Going to sleep…';
    case 'error': return 'Unreachable';
    case 'suspended': case 'stopped': case 'absent': case undefined: return 'Asleep';
    default: return 'Asleep';
  }
}

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`toggle${on ? ' is-on' : ''}`}
      onClick={() => {
        if (disabled) return;
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
        onChange(!on);
      }}
    >
      <span className="toggle__knob" />
    </button>
  );
}

function RoutineRow({ r }: { r: Routine }) {
  const [enabled, setEnabled] = useState(r.enabled);
  const [busy, setBusy] = useState(false);
  useEffect(() => setEnabled(r.enabled), [r.enabled]);
  const toggle = async (v: boolean) => {
    if (busy) return;
    setBusy(true);
    setEnabled(v);
    try { await api.setRoutine(r.id, v); } catch {
      setEnabled(!v);
      useStore.getState().notify('Could not update routine — check connection');
    }
    finally { setBusy(false); }
  };
  return (
    <div className="panel-row panel-row--routine" title={r.prompt}>
      <span className="panel-row__icon"><Icon name="clock" opacity={0.52} /></span>
      <span className="panel-row__text">
        <span className="panel-row__title">{r.name}</span>
        <span className="panel-row__sub">{enabled ? r.description || r.schedule : 'Paused'}</span>
      </span>
      <Toggle on={enabled} onChange={toggle} disabled={busy} label={`${r.name} ${enabled ? 'on' : 'off'}`} />
    </div>
  );
}

function ComputerCard({ bot }: { bot: Bot }) {
  const computer = useStore((s) => s.computer);
  const set = useStore((s) => s.set);
  const [shot, setShot] = useState<string | null>(null);
  const [waking, setWaking] = useState(false);
  const running = computer?.status === 'running';

  // Refresh the thumbnail every ~4s while visible and awake. 204 = no screen yet.
  useEffect(() => {
    setShot(null);
    if (!running) return;
    let alive = true;
    let url: string | null = null;
    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch(`/api/bots/${bot.id}/screenshot`, { credentials: 'include', cache: 'no-store' });
        if (!alive) return;
        if (res.status === 204) { setShot(null); return; }
        if (res.status === 200) {
          const blob = await res.blob();
          if (!alive) return;
          const next = URL.createObjectURL(blob);
          setShot(next);
          if (url) URL.revokeObjectURL(url);
          url = next;
        }
      } catch { /* keep last frame */ }
    };
    load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); if (url) URL.revokeObjectURL(url); };
  }, [bot.id, running]);

  const busy = computer?.status === 'starting' || computer?.status === 'resuming' || computer?.status === 'creating';
  useEffect(() => {
    if (running || busy) setWaking(false);
  }, [running, busy]);
  return (
    <div className="panel-card">
      <button
        className="panel-row panel-row--computer"
        type="button"
        onClick={() => {
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
          set(window.innerWidth <= 900 ? { viewerOpen: true, detailsOpen: false } : { viewerOpen: true });
        }}
      >
        <span className="panel-row__text">
          <span className="panel-row__title">Bot's computer</span>
          <span className="panel-row__meta">{computerStatusText(computer)}{computer?.error && computer.status === 'error' ? ` · ${computer.error}` : ''}</span>
        </span>
        <span className={`computer-thumb${shot ? ' has-shot' : ''}`}>
          {shot ? <img src={shot} alt="Bot's screen" /> : running || busy ? (
            <span className="computer-thumb__awake"><span className={`status-dot ${busy ? 'is-attention' : 'is-working'}`} /></span>
          ) : (
            <>
              <span className="computer-thumb__face"><i /><i /></span>
              <span className="computer-thumb__z1">z</span>
              <span className="computer-thumb__z2">z</span>
            </>
          )}
        </span>
      </button>
      {!running && !busy && (
        <button
          type="button"
          className="panel-row panel-row--action"
          disabled={waking}
          onClick={() => {
            if (waking) return;
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
            setWaking(true);
            api.ensureComputer().catch(() => {
              setWaking(false);
              useStore.getState().notify('Could not wake computer — check connection');
            });
          }}
        >
          <Icon name="monitor" size={14} opacity={0.56} /> {waking ? 'Waking…' : 'Wake computer'}
        </button>
      )}
    </div>
  );
}

export function DetailsPanel() {
  const bot = useSelectedBot();
  const routines = useStore((s) => (bot ? s.routines[bot.id] : undefined));
  const set = useStore((s) => s.set);
  const llmConfig = useConfigUI((s) => s.llmConfig);
  const tab = useStore((s) => bot?.kind === 'room' && s.detailsTab === 'runs' ? 'activity' : s.detailsTab);
  const setTab = (detailsTab: typeof tab) => set({ detailsTab });
  const [slackBusy, setSlackBusy] = useState(false);
  const [hideSuggested, setHideSuggested] = useState(() => { try { return localStorage.getItem('grokbot.hideSuggested') === '1'; } catch { return false; } });
  const closeRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const swipeLocked = useRef<'x' | 'y' | null>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [tab, bot?.id]);

  useEffect(() => {
    if (window.innerWidth <= 900) closeRef.current?.focus();
  }, []);

  if (!bot) return null;

  const activeModel = bot.model || llmConfig?.defaultModel || 'anthropic/claude-3.7-sonnet';

  const blurActiveOnMobile = () => {
    if (window.innerWidth <= 900) {
      const ae = document.activeElement;
      if (ae instanceof HTMLElement && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) {
        ae.blur();
      }
    }
  };

  const addSlack = async () => {
    if (slackBusy) return;
    setSlackBusy(true);
    const popup = openPopup('about:blank');
    try {
      const { redirectUrl } = await api.connect('slack');
      if (popup && !popup.closed) {
        popup.location.href = redirectUrl;
      } else {
        window.open(redirectUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (e: any) {
      popup?.close();
      useStore.getState().notify(e?.message ?? 'Could not connect Slack');
    } finally {
      setSlackBusy(false);
    }
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (window.innerWidth > 900 || e.touches.length !== 1) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    swipeLocked.current = null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (!swipeLocked.current) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      swipeLocked.current = Math.abs(dx) > Math.abs(dy) * 1.2 && dx > 0 ? 'x' : 'y';
      if (swipeLocked.current === 'x') {
        blurActiveOnMobile();
        setDragging(true);
      }
    }
    if (swipeLocked.current === 'x') {
      setDragX(Math.max(0, dx));
    } else if (swipeLocked.current === 'y' && Math.abs(dy) > 14 && window.innerWidth <= 900) {
      const ae = document.activeElement;
      if (ae instanceof HTMLElement && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA') && scrollRef.current?.contains(ae)) {
        ae.blur();
      }
    }
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    const wasHorizontal = swipeLocked.current === 'x';
    touchStartX.current = null;
    touchStartY.current = null;
    swipeLocked.current = null;
    setDragging(false);
    setDragX(0);
    if (wasHorizontal && deltaX > 56 && window.innerWidth <= 900) {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
      set({ detailsOpen: false });
    }
  };
  const onTouchCancel = () => {
    touchStartX.current = null;
    touchStartY.current = null;
    swipeLocked.current = null;
    setDragging(false);
    setDragX(0);
  };

  return (
    <aside
      className="details"
      style={{
        ...botVars(bot.avatarColor),
        ...(dragX > 0 ? { transform: `translateX(${dragX}px)`, transition: dragging ? 'none' : 'transform 180ms ease-out' } : undefined),
      }}
      id="conversation-details"
      aria-label="Conversation details"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
    >
      <div className="details__top">
        <button
          type="button"
          className="icon-btn icon-btn--bordered details__gear"
          onClick={() => {
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
            if (window.innerWidth <= 900) set({ detailsOpen: false });
            useConfigUI.getState().openBotSettings(bot.id);
          }}
          aria-label="Bot settings"
          title="Bot settings"
        >
          <Glyph name="gear" size={16} opacity={0.7} />
        </button>
        <button
          ref={closeRef}
          type="button"
          className="icon-btn icon-btn--bordered"
          onClick={() => {
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
            set({ detailsOpen: false });
            document.querySelector<HTMLButtonElement>('[aria-controls="conversation-details"]')?.focus();
          }}
          aria-label="Close details"
        >
          <Icon name="close" opacity={0.92} />
        </button>
      </div>
      <div ref={scrollRef} className="details__scroll">
        <div className="details__identity">
          <BotAvatarFor bot={bot} size={64} />
          <div className="details__name" title={displayName(bot)}>{displayName(bot)}</div>
        </div>
        <div className="details__tabs">
          <div className="segmented" role="tablist" aria-label="Details sections">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'activity'}
              className={tab === 'activity' ? 'is-active' : ''}
              onClick={() => {
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                blurActiveOnMobile();
                setTab('activity');
              }}
            >
              Activity
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'tasks'}
              className={tab === 'tasks' ? 'is-active' : ''}
              onClick={() => {
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                blurActiveOnMobile();
                setTab('tasks');
              }}
            >
              Tasks
            </button>
            {bot.kind !== 'room' && <button
              type="button"
              role="tab"
              aria-selected={tab === 'runs'}
              className={tab === 'runs' ? 'is-active' : ''}
              onClick={() => { blurActiveOnMobile(); setTab('runs'); }}
            >
              Runs
            </button>}
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'library'}
              className={tab === 'library' ? 'is-active' : ''}
              onClick={() => {
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                blurActiveOnMobile();
                setTab('library');
              }}
            >
              Library
            </button>
          </div>
        </div>
        {tab === 'activity' ? (
          <div className="details__sections">
            {bot.kind !== 'room' && (
              <section>
                <div className="section-label section-label--row">
                  <span>Model & Engine</span>
                  <button
                    type="button"
                    className="link-btn link-btn--small"
                    onClick={() => {
                      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                      if (window.innerWidth <= 900) set({ detailsOpen: false });
                      useConfigUI.getState().openAppSettings('models');
                    }}
                  >
                    BYOM
                  </button>
                </div>
                <div className="panel-card">
                  <button
                    type="button"
                    className="panel-row panel-row--link"
                    onClick={() => {
                      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                      if (window.innerWidth <= 900) set({ detailsOpen: false });
                      useConfigUI.getState().openBotSettings(bot.id, 'general');
                    }}
                  >
                    <span className="panel-row__text">
                      <span className="panel-row__title" style={{ fontFamily: 'var(--font-mono-stack)', fontSize: 12 }}>{activeModel}</span>
                      <span className="panel-row__sub">
                        {llmConfig?.provider?.toUpperCase() ?? 'OPENROUTER'} · Effort: {(bot.effort ?? 'medium').toUpperCase()}
                      </span>
                    </span>
                    <Icon name="chev_right" size={12} opacity={0.56} />
                  </button>
                </div>
              </section>
            )}
            <section>
              <div className="section-label section-label--row">
                <span>Upcoming</span>
                <button
                  type="button"
                  className="link-btn link-btn--small"
                  onClick={() => {
                    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                    if (window.innerWidth <= 900) set({ detailsOpen: false });
                    useConfigUI.getState().openBotSettings(bot.id, 'routines');
                  }}
                >
                  Manage
                </button>
              </div>
              <div className="panel-card">
                {routines?.length ? routines.map((r) => <RoutineRow key={r.id} r={r} />) : (
                  <div className="panel-empty">Nothing scheduled. Try asking in chat, for example “send me a summary every weekday at 8am”.</div>
                )}
              </div>
            </section>
            {bot.kind === 'room' && (
              <section>
                <div className="section-label">Members</div>
                <MembersCard room={bot} />
              </section>
            )}
            {bot.kind !== 'room' && !hideSuggested && (
              <section>
                <div className="section-label section-label--row">
                  <span>Suggested</span>
                  <button
                    type="button"
                    className="link-btn link-btn--small"
                    onClick={() => {
                      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                      setHideSuggested(true);
                      try { localStorage.setItem('grokbot.hideSuggested', '1'); } catch { /* ignore */ }
                    }}
                  >
                    Hide
                  </button>
                </div>
                <div className="panel-card">
                  <button
                    type="button"
                    className="panel-row panel-row--link"
                    disabled={slackBusy}
                    onClick={() => {
                      if (slackBusy) return;
                      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                      if (window.innerWidth <= 900) set({ detailsOpen: false });
                      void addSlack();
                    }}
                  >
                    <span className="panel-row__glyph"><ToolkitLogo name="Slack" logo="/assets/icons/slack.svg" size={16} radius={4} /></span>
                    <span className="panel-row__title" style={{ flex: 1 }}>{slackBusy ? 'Connecting Slack…' : 'Add to Slack'}</span>
                    <Icon name="chev_right" size={12} opacity={0.56} />
                  </button>
                </div>
              </section>
            )}
            {bot.kind !== 'room' && (
              <>
                <section>
                  <div className="section-label">Computer</div>
                  <ComputerCard bot={bot} />
                </section>
                <section>
                  <div className="section-label">Voice chat</div>
                  <VoiceSettings bot={bot} />
                </section>
              </>
            )}
          </div>
        ) : tab === 'tasks' ? <BotTasks bot={bot} />
          : tab === 'runs' && bot.kind !== 'room' ? <RunHistory key={bot.id} botId={bot.id} openLibrary={() => setTab('library')} />
          : <LibraryTab bot={bot} />}
      </div>
    </aside>
  );
}
