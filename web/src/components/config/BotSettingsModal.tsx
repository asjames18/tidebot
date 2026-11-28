import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentRun, AvatarColor, AvatarShape, Bot, Memory, Routine, RoutineDryRunResult, Skill } from '@shared/types';
import { BotAvatar, BotAvatarFor, PICKER_SHAPES } from '../../avatar/BotAvatar';
import { COLOR_ORDER, botVars, palette } from '../../lib/colors';
import { configApi, type BotSettingsBundle } from '../../lib/configApi';
import { useConfigUI, useVersion, type BotSettingsTab } from '../../configStore';
import { useStore } from '../../store';
import { Icon } from '../Icon';
import { Modal } from '../modals/Modal';
import { Glyph } from './glyphs';
import { ConfirmButton, Field, Segmented, Switch, nextRunLabel, shortDate } from './ui';

const EFFORTS: { value: Bot['effort']; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Max' },
];

const EFFORT_HINT: Record<Bot['effort'], string> = {
  low: 'Fastest replies. Good for quick lookups and chit-chat.',
  medium: 'A good balance for most work.',
  high: 'Thinks longer before acting. Better for tricky, multi-step work.',
  xhigh: 'Thinks the longest. Slowest, for the hardest problems.',
};

export function BotSettingsModal() {
  const target = useConfigUI((s) => s.botSettings);
  const close = useConfigUI((s) => s.closeBotSettings);
  const setTab = (tab: BotSettingsTab) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(8); } catch {}
    }
    if (typeof window !== 'undefined' && window.innerWidth <= 900) {
      const ae = document.activeElement;
      if (ae instanceof HTMLElement && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) ae.blur();
    }
    if (target) useConfigUI.setState({ botSettings: { ...target, tab, routineDraft: undefined } });
  };
  const bot = useStore((s) => s.bots.find((b) => b.id === target?.botId));
  const routines = useStore((s) => (target ? s.routines[target.botId] : undefined));
  const memVersion = useVersion(`memories:${target?.botId ?? ''}`);
  const [data, setData] = useState<BotSettingsBundle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const contentTouchStartYRef = useRef<number | null>(null);
  const onClose = useCallback(() => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(8); } catch {}
    }
    if (typeof window !== 'undefined' && window.innerWidth <= 900) {
      const ae = document.activeElement;
      if (ae instanceof HTMLElement && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) ae.blur();
    }
    close();
  }, [close]);

  const reload = useCallback(() => {
    if (!target) return;
    configApi.settings(target.botId).then((d) => { setData(d); setLoadError(null); }).catch((e) => setLoadError(e.message));
  }, [target?.botId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setData(null);
    setLoadError(null);
  }, [target?.botId]);
  useEffect(() => { reload(); }, [reload, memVersion]);
  useEffect(() => { if (target) useStore.getState().loadRoutines(target.botId).catch(() => {}); }, [target?.botId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bot deleted while open (or bad id): close.
  useEffect(() => { if (target && !bot && useStore.getState().bots.length) close(); }, [bot, target, close]);
  useEffect(() => {
    if (!target) return;
    const activeBtn = navRef.current?.querySelector<HTMLElement>('.cfg-nav__item.is-active');
    activeBtn?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [target?.tab, target?.botId]);
  if (!target || !bot) return null;

  const tabs: { id: BotSettingsTab; label: string; count?: number }[] = [
    { id: 'general', label: 'General' },
    { id: 'skills', label: 'Skills', count: data?.skills.length },
    { id: 'memories', label: 'Memories', count: data?.memories.length },
    { id: 'routines', label: 'Routines', count: (routines ?? data?.routines)?.length },
  ];

  return (
    <Modal onClose={onClose} className="bot-settings" label={`${bot.name} settings`}>
      <div className="modal__header">
        <div className="bot-settings__title">
          <BotAvatarFor bot={bot} size={24} />
          <span className="modal__title">{bot.name}</span>
        </div>
        <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={14} opacity={0.68} />
        </button>
      </div>
      <div className="bot-settings__body" style={botVars(bot.avatarColor)}>
        <nav ref={navRef} className="cfg-nav" aria-label="Bot settings sections">
          {tabs.map((t) => (
            <button key={t.id} type="button" className={`cfg-nav__item${target.tab === t.id ? ' is-active' : ''}`} onClick={() => setTab(t.id)} aria-current={target.tab === t.id || undefined}>
              <span>{t.label}</span>
              {t.count ? <span className="cfg-nav__count">{t.count}</span> : null}
            </button>
          ))}
        </nav>
        <div
          ref={contentRef}
          className="cfg-content"
          onTouchStart={(e) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest('textarea')) { contentTouchStartYRef.current = null; return; }
            contentTouchStartYRef.current = e.touches[0]?.clientY ?? null;
          }}
          onTouchMove={(e) => {
            if (contentTouchStartYRef.current === null || window.innerWidth > 900) return;
            const y = e.touches[0]?.clientY;
            if (y !== undefined && Math.abs(y - contentTouchStartYRef.current) > 18) {
              contentTouchStartYRef.current = null;
              const active = document.activeElement;
              if (active instanceof HTMLElement && contentRef.current?.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
                active.blur();
              }
            }
          }}
          onTouchEnd={() => { contentTouchStartYRef.current = null; }}
          onTouchCancel={() => { contentTouchStartYRef.current = null; }}
        >
          {loadError && (
            <div className="cfg-error" role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <span>Couldn’t load settings: {loadError}</span>
              <button
                type="button"
                className="cfg-btn cfg-btn--secondary"
                onClick={() => {
                  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                  reload();
                }}
              >
                Retry
              </button>
            </div>
          )}
          {target.tab === 'general' && <GeneralTab bot={bot} onClose={onClose} />}
          {target.tab === 'skills' && <SkillsTab bot={bot} skills={data?.skills} onChange={reload} />}
          {target.tab === 'memories' && <MemoriesTab bot={bot} data={data} onChange={reload} />}
          {target.tab === 'routines' && <RoutinesTab bot={bot} routines={routines ?? data?.routines} onChange={reload} draft={target.routineDraft} />}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

type Draft = Pick<Bot, 'name' | 'label' | 'description' | 'instructions' | 'avatarShape' | 'avatarColor' | 'effort' | 'mode'> & { model: string };
const draftOf = (b: Bot): Draft => ({
  name: b.name,
  label: b.label,
  description: b.description,
  instructions: b.instructions,
  avatarShape: b.avatarShape,
  avatarColor: b.avatarColor,
  effort: b.effort,
  mode: b.mode,
  model: b.model ?? '',
});

function GeneralTab({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(bot));
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const noteTimerRef = useRef<number | null>(null);
  const llmConfig = useConfigUI((s) => s.llmConfig);
  const curatedModels = useConfigUI((s) => s.curatedModels);
  useEffect(() => { setDraft(draftOf(bot)); }, [bot.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (noteTimerRef.current) window.clearTimeout(noteTimerRef.current); }, []);

  const base = draftOf(bot);
  const changed = (Object.keys(draft) as (keyof Draft)[]).filter((k) => draft[k] !== base[k]);
  const dirty = changed.length > 0;
  const nameOk = draft.name.trim().length > 0;
  const put = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const flash = (text: string, tone: 'ok' | 'error' = 'ok') => {
    setNote({ text, tone });
    if (noteTimerRef.current) window.clearTimeout(noteTimerRef.current);
    noteTimerRef.current = window.setTimeout(() => { setNote(null); noteTimerRef.current = null; }, 2400);
  };

  const save = async () => {
    if (!dirty || !nameOk || saving) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(12); } catch {}
    }
    setSaving(true);
    try {
      const patch: Partial<Draft> = {};
      for (const k of changed) (patch as Record<string, unknown>)[k] = k === 'name' ? draft.name.trim() : draft[k];
      const { bot: next } = await configApi.updateBot(bot.id, patch);
      useStore.setState((s) => ({ bots: s.bots.map((b) => (b.id === next.id ? next : b)) }));
      if (window.innerWidth <= 900 && document.activeElement instanceof HTMLElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
        document.activeElement.blur();
      }
      flash('Saved');
    } catch (e) {
      flash((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cfg-page">
      <section className="cfg-section">
        <div className="cfg-look">
          <BotAvatar shape={draft.avatarShape} color={draft.avatarColor} size={72} />
          <div className="cfg-look__text">
            <div className="cfg-look__name">{draft.name || 'New Bot'}</div>
            <button
              type="button"
              className="cfg-btn cfg-btn--secondary"
              onClick={() => {
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                if (window.innerWidth <= 900 && document.activeElement instanceof HTMLElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
                  document.activeElement.blur();
                }
                setPicker(!picker);
              }}
              aria-expanded={picker}
            >
              {picker ? 'Done' : 'Change look'}
            </button>
          </div>
        </div>
        {picker && <LookPicker shape={draft.avatarShape} color={draft.avatarColor} onShape={(s) => put('avatarShape', s)} onColor={(c) => put('avatarColor', c)} />}
      </section>

      <section className="cfg-section cfg-grid">
        <Field label="Name" htmlFor="cfg-name">
          <input
            id="cfg-name"
            className="text-input"
            enterKeyHint="next"
            autoCapitalize="words"
            value={draft.name}
            maxLength={60}
            onChange={(e) => put('name', e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('cfg-label')?.focus();
              }
            }}
            aria-invalid={!nameOk}
          />
        </Field>
        <Field label="Label" htmlFor="cfg-label" hint="Shown next to the name, like “Research” or “Inbox”.">
          <input
            id="cfg-label"
            className="text-input"
            enterKeyHint="next"
            autoCapitalize="sentences"
            value={draft.label}
            maxLength={60}
            placeholder="Add a label"
            onChange={(e) => put('label', e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('cfg-about')?.focus();
              }
            }}
          />
        </Field>
      </section>

      <section className="cfg-section">
        <Field label="About" htmlFor="cfg-about">
          <textarea id="cfg-about" className="text-input cfg-textarea" rows={2} value={draft.description} maxLength={500} placeholder="What is this Bot for?" onChange={(e) => put('description', e.target.value)} />
        </Field>
        <Field label="Instructions" htmlFor="cfg-instructions" hint={`Standing guidance ${draft.name || 'this Bot'} always follows, like tone, priorities or things to avoid. It also learns from chat, skills and memories.`}>
          <textarea id="cfg-instructions" className="text-input cfg-textarea cfg-textarea--tall" rows={7} value={draft.instructions} maxLength={8000} placeholder="e.g. Keep updates to three bullets. Never email anyone outside the team without asking." onChange={(e) => put('instructions', e.target.value)} />
        </Field>
        <Field label="Model (OpenRouter / BYOM)" htmlFor="cfg-model" hint={`Leave empty to use the studio default (${llmConfig?.defaultModel ?? 'anthropic/claude-3.7-sonnet'}), or pick a specific model for this operator.`}>
          <div className="cfg-model-picker">
            <input
              id="cfg-model"
              className="text-input"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              value={draft.model}
              placeholder={`Default (${llmConfig?.defaultModel ?? 'anthropic/claude-3.7-sonnet'})`}
              onChange={(e) => put('model', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && window.innerWidth <= 900) {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />
            <select
              className="text-input"
              value={curatedModels.some((m) => m.id === draft.model) ? draft.model : ''}
              onChange={(e) => put('model', e.target.value)}
              aria-label="Quick model preset"
            >
              <option value="">Use Default Model</option>
              {curatedModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name} ({m.provider})</option>
              ))}
            </select>
          </div>
        </Field>
        <Field label="Thinking effort" hint={EFFORT_HINT[draft.effort]}>
          <Segmented label="Thinking effort" value={draft.effort} options={EFFORTS} onChange={(v) => put('effort', v)} />
        </Field>
        <Field label="Used as">
          <Segmented label="Bot type" value={draft.mode} options={[{ value: 'personal', label: 'Personal assistant' }, { value: 'teammate', label: 'Teammate' }]} onChange={(v) => put('mode', v)} />
        </Field>
      </section>

      <div className={`cfg-savebar${dirty ? ' is-dirty' : ''}`}>
        <span className={`cfg-savebar__note${note?.tone === 'error' ? ' is-error' : ''}`} role="status">{note?.text ?? (dirty ? 'Unsaved changes' : '')}</span>
        <button
          type="button"
          className="cfg-btn cfg-btn--secondary"
          disabled={!dirty || saving}
          onClick={() => {
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
              try { navigator.vibrate(8); } catch {}
            }
            if (window.innerWidth <= 900 && document.activeElement instanceof HTMLElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
              document.activeElement.blur();
            }
            setDraft(draftOf(bot));
          }}
        >
          Discard
        </button>
        <button type="button" className="cfg-btn cfg-btn--primary" disabled={!dirty || saving || !nameOk} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>

      {bot.isPrimary && <CheckinsSection botName={bot.name} onFlash={flash} />}

      <section className="cfg-section">
        <div className="cfg-section__label">Conversation</div>
        <div className="cfg-card">
          <div className="cfg-row">
            <div className="cfg-row__text">
              <div className="cfg-row__title">New conversation</div>
              <div className="cfg-row__sub">Clears the chat. Memories, skills and routines stay.</div>
            </div>
            <ConfirmButton
              className="cfg-btn cfg-btn--secondary"
              confirmLabel="Start fresh"
              onConfirm={async () => {
                try {
                  await configApi.fresh(bot.id);
                  flash('Started a new conversation');
                } catch (e) {
                  flash((e as Error).message, 'error');
                }
              }}
            >
              Start new
            </ConfirmButton>
          </div>
          {!bot.isPrimary && (
            <div className="cfg-row">
              <div className="cfg-row__text">
                <div className="cfg-row__title">Make primary</div>
                <div className="cfg-row__sub">Your go-to Bot. It reaches out first and keeps the others on track.</div>
              </div>
              <button
                type="button"
                className="cfg-btn cfg-btn--secondary"
                disabled={promoting}
                onClick={() => {
                  if (promoting) return;
                  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                    try { navigator.vibrate(10); } catch {}
                  }
                  setPromoting(true);
                  configApi.makePrimary(bot.id)
                    .then(() => {
                      useStore.setState((s) => ({ bots: s.bots.map((b) => ({ ...b, isPrimary: b.id === bot.id })) }));
                      flash(`${bot.name} is now your primary Bot`);
                    })
                    .catch((e) => flash(e.message, 'error'))
                    .finally(() => setPromoting(false));
                }}
              >
                {promoting ? 'Updating…' : 'Make primary'}
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="cfg-section">
        <div className="cfg-section__label">Danger zone</div>
        <div className="cfg-card">
          <div className="cfg-row">
            <div className="cfg-row__text">
              <div className="cfg-row__title">Delete {bot.name}</div>
              <div className="cfg-row__sub">{bot.isPrimary ? 'Make another Bot primary first.' : 'Removes its chat, memories, skills and routines for good.'}</div>
            </div>
            <ConfirmButton
              disabled={bot.isPrimary}
              confirmLabel={`Delete ${bot.name}`}
              onConfirm={async () => {
                try {
                  await configApi.deleteBot(bot.id);
                  onClose();
                  const st = useStore.getState();
                  st.set({ bots: st.bots.filter((b) => b.id !== bot.id) });
                  st.loadBots().catch(() => {});
                } catch (e) { flash((e as Error).message, 'error'); }
              }}
            >
              Delete…
            </ConfirmButton>
          </div>
        </div>
      </section>
    </div>
  );
}

const SHAPE_ROWS = [PICKER_SHAPES.slice(0, 5), PICKER_SHAPES.slice(5, 10), PICKER_SHAPES.slice(10)];
const COLOR_ROWS = [COLOR_ORDER.slice(0, 6), COLOR_ORDER.slice(6)];

function CheckinsSection({ botName, onFlash }: { botName: string; onFlash: (t: string, tone?: 'ok' | 'error') => void }) {
  const [enabled, setEnabled] = useState(false);
  const [timesStr, setTimesStr] = useState('09:00, 16:30');
  const [timezone, setTimezone] = useState('UTC');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    configApi.checkins().then((c) => {
      setEnabled(c.enabled);
      setTimesStr(c.times.join(', '));
      setTimezone(c.timezone || 'UTC');
      setLoaded(true);
    }).catch(() => {});
  }, []);

  if (!loaded) return null;

  const saveCheckins = async (nextEnabled = enabled, nextTimesStr = timesStr, nextTz = timezone) => {
    if (saving) return;
    setSaving(true);
    try {
      const times = nextTimesStr.split(',').map((t) => t.trim()).filter(Boolean);
      const res = await configApi.setCheckins({ enabled: nextEnabled, times, timezone: nextTz.trim() || 'UTC' });
      setEnabled(res.enabled);
      setTimesStr(res.times.join(', '));
      setTimezone(res.timezone);
      onFlash(res.enabled ? `Check-ins scheduled (${res.times.join(', ')} ${res.timezone})` : 'Check-ins paused');
    } catch (e) {
      onFlash((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const triggerNow = async () => {
    if (running) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(10); } catch {}
    }
    setRunning(true);
    try {
      await configApi.checkinNow();
      onFlash(`${botName} is checking in now`);
    } catch (e) {
      onFlash((e as Error).message, 'error');
    } finally {
      setRunning(false);
    }
  };

  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  return (
    <section className="cfg-section">
      <div className="cfg-section__label">Proactive check-ins</div>
      <div className="cfg-card">
        <div className="cfg-row">
          <div className="cfg-row__text">
            <div className="cfg-row__title">Scheduled check-ins</div>
            <div className="cfg-row__sub">{botName} reviews tasks, approvals, and routines at set times and messages you only when there’s something worth sharing.</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              className="cfg-btn cfg-btn--secondary"
              disabled={running}
              onClick={() => void triggerNow()}
            >
              {running ? 'Checking…' : 'Check in now'}
            </button>
            <Switch
              on={enabled}
              disabled={saving}
              onChange={(v) => {
                setEnabled(v);
                void saveCheckins(v, timesStr, timezone);
              }}
              label="Proactive check-ins"
            />
          </div>
        </div>
        {enabled && (
          <div className="cfg-row" style={{ flexWrap: 'wrap', gap: 10 }}>
            <div style={{ flex: '1 1 180px' }}>
              <div className="cfg-field__label" style={{ marginBottom: 4 }}>Times (24h HH:MM)</div>
              <input className="text-input" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" value={timesStr} onChange={(e) => setTimesStr(e.target.value)} placeholder="09:00, 16:30" aria-label="Check-in times" />
            </div>
            <div style={{ flex: '1 1 180px' }}>
              <div className="cfg-field__label" style={{ marginBottom: 4 }}>Timezone</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="text-input" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="done" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/New_York" aria-label="Check-in timezone" />
                {timezone !== localTz && (
                  <button
                    type="button"
                    className="cfg-btn cfg-btn--secondary"
                    title={`Use ${localTz}`}
                    onClick={() => {
                      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                      setTimezone(localTz);
                    }}
                  >
                    Local
                  </button>
                )}
              </div>
            </div>
            <div style={{ alignSelf: 'flex-end' }}>
              <button
                type="button"
                className="cfg-btn cfg-btn--primary"
                disabled={saving}
                onClick={() => {
                  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(12); } catch {} }
                  void saveCheckins();
                }}
              >
                {saving ? 'Saving…' : 'Update schedule'}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function LookPicker({ shape, color, onShape, onColor }: { shape: AvatarShape; color: AvatarColor; onShape: (s: AvatarShape) => void; onColor: (c: AvatarColor) => void }) {
  const blurOnMobile = () => {
    if (typeof window !== 'undefined' && window.innerWidth <= 900 && document.activeElement instanceof HTMLInputElement) {
      document.activeElement.blur();
    }
  };
  return (
    <div className="cfg-picker">
      <div className="shape-grid" role="radiogroup" aria-label="Character shape">
        {SHAPE_ROWS.map((row, i) => (
          <div key={i} className="shape-grid__row">
            {row.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={shape === s}
                aria-label={s}
                className="shape-cell"
                onClick={() => {
                  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                    try { navigator.vibrate(8); } catch {}
                  }
                  blurOnMobile();
                  onShape(s);
                }}
              >
                <BotAvatar shape={s} color={color} size={34} ring={shape === s} />
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="swatches" role="radiogroup" aria-label="Character color">
        {COLOR_ROWS.map((row, i) => (
          <div key={i} className="swatches__row">
            {row.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                className="swatch-cell"
                onClick={() => {
                  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                    try { navigator.vibrate(8); } catch {}
                  }
                  blurOnMobile();
                  onColor(c);
                }}
              >
                <span className={`swatch${color === c ? ' is-selected' : ''}`} style={{ background: palette(c).fill }} />
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const SKILL_TEMPLATES: { name: string; description: string; body: string }[] = [
  {
    name: 'Deep Web Researcher',
    description: 'Multi-source web research with citations and structured Markdown briefing',
    body: '1. Use `web_search` with 2-3 targeted queries to gather authoritative sources.\n2. Use `fetch_webpage` on the top 2-3 URLs to read full articles or documentation.\n3. Synthesize findings with inline links and save a clean deliverable to the Library using `save_file`.',
  },
  {
    name: 'GitHub PR & Code Reviewer',
    description: 'Review pull requests, check diffs, and summarize security or logic issues',
    body: '1. Search for GitHub tools via `COMPOSIO_SEARCH_TOOLS` (or use `shell` / `fetch_webpage`).\n2. Inspect the PR diff, changed files, and commit messages.\n3. Report high-severity bugs, edge cases, and actionable suggestions concisely.',
  },
  {
    name: 'Executive Daily Briefing',
    description: 'Morning synthesis of open tasks, calendar events, and key priorities',
    body: '1. Check open tasks and recent memories using `recall`.\n2. If Google Calendar or Gmail is connected, check today’s schedule and urgent threads.\n3. Deliver a crisp 5-bullet executive summary and save `daily-briefing.md` via `save_file`.',
  },
  {
    name: 'Email & Slack Triage',
    description: 'Draft polished responses using interactive Draft Cards for user approval',
    body: '1. Identify the recipient, channel (`email` or `slack`), and key message points.\n2. Call `draft_message` so the user gets an interactive Draft Card in chat to review, copy, or approve sending.',
  },
];

function SkillsTab({ bot, skills, onChange }: { bot: Bot; skills: Skill[] | undefined; onChange: () => void }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const existingNames = new Set((skills ?? []).map((s) => s.name.toLowerCase()));

  const installTemplate = async (tpl: (typeof SKILL_TEMPLATES)[number]) => {
    if (installing !== null) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(10); } catch {}
    }
    setInstalling(tpl.name);
    try {
      await configApi.createSkill(bot.id, tpl);
      onChange();
      useStore.getState().notify(`Installed "${tpl.name}"`);
    } catch {
      useStore.getState().notify(`Could not install "${tpl.name}"`);
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div className="cfg-page">
      <div className="cfg-page__head">
        <div>
          <div className="cfg-page__title">Operator Skills</div>
          <div className="cfg-page__sub">Step-by-step playbooks {bot.name} follows for specific workflows.</div>
        </div>
        {editing !== 'new' && (
          <button
            type="button"
            className="cfg-btn cfg-btn--primary"
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                try { navigator.vibrate(8); } catch {}
              }
              setEditing('new');
            }}
          >
            <Icon name="plus" size={12} /> New skill
          </button>
        )}
      </div>
      {editing === 'new' && <SkillEditor botId={bot.id} onDone={() => { setEditing(null); onChange(); }} />}
      {!skills ? <div className="cfg-empty">Loading…</div> : skills.length === 0 && editing !== 'new' ? (
        <div className="cfg-empty">
          No custom skills installed yet. Add a custom playbook above or install a 1-click template below.
        </div>
      ) : (
        <div className="cfg-list">
          {skills.map((s) => editing === s.id ? (
            <SkillEditor key={s.id} botId={bot.id} skill={s} onDone={() => { setEditing(null); onChange(); }} />
          ) : (
            <div key={s.id} className="cfg-item">
              <span className="cfg-item__icon"><Glyph name="spark" size={14} /></span>
              <div className="cfg-item__text">
                <div className="cfg-item__title">{s.name}</div>
                <div className="cfg-item__sub">{s.description || s.body.split('\n')[0]}</div>
              </div>
              <div className="cfg-item__actions">
                <button
                  type="button"
                  className="cfg-icon-btn"
                  onClick={() => {
                    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                      try { navigator.vibrate(8); } catch {}
                    }
                    setEditing(s.id);
                  }}
                  aria-label={`Edit ${s.name}`}
                  title="Edit"
                >
                  <Icon name="edit" size={14} />
                </button>
                <ConfirmButton
                  className="cfg-icon-btn"
                  title="Delete"
                  ariaLabel={`Delete ${s.name}`}
                  onConfirm={async () => {
                    await configApi.deleteSkill(s.id);
                    onChange();
                  }}
                >
                  <Glyph name="trash" size={14} />
                </ConfirmButton>
              </div>
            </div>
          ))}
        </div>
      )}

      <section className="cfg-section" style={{ marginTop: 18 }}>
        <div className="cfg-section__label">1-Click Skill Templates</div>
        <div className="cfg-card">
          {SKILL_TEMPLATES.map((tpl) => {
            const installed = existingNames.has(tpl.name.toLowerCase());
            return (
              <div key={tpl.name} className="cfg-row">
                <div className="cfg-row__text">
                  <div className="cfg-row__title">{tpl.name}</div>
                  <div className="cfg-row__sub">{tpl.description}</div>
                </div>
                <button
                  type="button"
                  className="cfg-btn cfg-btn--secondary"
                  disabled={installed || installing !== null}
                  onClick={() => void installTemplate(tpl)}
                >
                  {installed ? '✓ Installed' : installing === tpl.name ? 'Installing…' : '+ Install'}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function SkillEditor({ botId, skill, onDone }: { botId: string; skill?: Skill; onDone: () => void }) {
  const [name, setName] = useState(skill?.name ?? '');
  const [description, setDescription] = useState(skill?.description ?? '');
  const [body, setBody] = useState(skill?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const descRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const can = name.trim() && body.trim() && !busy;
  const save = async () => {
    if (!can) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(12); } catch {}
    }
    setBusy(true); setError(null);
    try {
      if (skill) await configApi.updateSkill(skill.id, { name, description, body });
      else await configApi.createSkill(botId, { name, description, body });
      if (window.innerWidth <= 900 && document.activeElement instanceof HTMLElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
        document.activeElement.blur();
      }
      onDone();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return (
    <form className="cfg-editor" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <input
        className="text-input"
        enterKeyHint="next"
        placeholder="Skill name, e.g. Weekly report"
        value={name}
        maxLength={80}
        onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !body.trim()) {
            e.preventDefault();
            descRef.current?.focus();
          }
        }}
        autoFocus={typeof window === 'undefined' || window.innerWidth > 900}
        aria-label="Skill name"
      />
      <input
        ref={descRef}
        className="text-input"
        enterKeyHint="next"
        placeholder="When to use it (optional)"
        value={description}
        maxLength={300}
        onChange={(e) => { setDescription(e.target.value); if (error) setError(null); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !body.trim()) {
            e.preventDefault();
            bodyRef.current?.focus();
          }
        }}
        aria-label="Skill description"
      />
      <textarea
        ref={bodyRef}
        className="text-input cfg-textarea cfg-textarea--tall"
        rows={8}
        placeholder={'Write the steps to follow:\n1. …\n2. …'}
        value={body}
        onChange={(e) => { setBody(e.target.value); if (error) setError(null); }}
        aria-label="Skill steps"
      />
      {error && <div className="cfg-error" role="alert">{error}</div>}
      <div className="cfg-editor__actions">
        <button
          type="button"
          className="cfg-btn cfg-btn--secondary"
          onClick={() => {
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
            onDone();
          }}
        >
          Cancel
        </button>
        <button type="submit" className="cfg-btn cfg-btn--primary" disabled={!can}>{busy ? 'Saving…' : skill ? 'Save skill' : 'Add skill'}</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

function MemoriesTab({ bot, data, onChange }: { bot: Bot; data: BotSettingsBundle | null; onChange: () => void }) {
  const [q, setQ] = useState('');
  const [newText, setNewText] = useState('');
  const [adding, setAdding] = useState(false);
  const [maintBusy, setMaintBusy] = useState<'consolidate' | 'compact' | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => () => { if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current); }, []);
  const say = (t: string) => {
    setFlash(t);
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => { setFlash(null); flashTimerRef.current = null; }, 2600);
  };
  const memories = useMemo(() => (data?.memories ?? []).filter((m) => !hidden.has(m.id) && (!q || m.text.toLowerCase().includes(q.toLowerCase()))), [data, hidden, q]);
  const remove = async (m: Memory) => {
    setHidden((h) => new Set(h).add(m.id));
    try {
      await configApi.deleteMemory(m.id);
      onChange();
    } catch {
      setHidden((h) => { const n = new Set(h); n.delete(m.id); return n; });
      say('Could not delete memory');
    }
  };
  const addMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newText.trim();
    if (!clean || adding) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(10); } catch {}
    }
    setAdding(true);
    try {
      await configApi.addMemory(bot.id, clean);
      setNewText('');
      if (window.innerWidth <= 900 && document.activeElement instanceof HTMLElement && document.activeElement.tagName === 'INPUT') {
        document.activeElement.blur();
      }
      onChange();
      say('Memory saved');
    } catch (err) {
      say((err as Error).message);
    } finally {
      setAdding(false);
    }
  };
  const runConsolidate = async () => {
    if (maintBusy) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(10); } catch {}
    }
    setMaintBusy('consolidate');
    try {
      const r = await configApi.consolidateMemories(bot.id);
      onChange();
      say(r.added.length ? `Learned ${r.added.length} new memor${r.added.length === 1 ? 'y' : 'ies'}` : 'Up to date (no new memories found)');
    } catch (err) {
      say((err as Error).message);
    } finally {
      setMaintBusy(null);
    }
  };
  const runCompact = async () => {
    if (maintBusy) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(10); } catch {}
    }
    setMaintBusy('compact');
    try {
      const r = await configApi.compactHistory(bot.id, true);
      onChange();
      say(r.compacted ? `Compacted (${r.itemsBefore} → ${r.itemsAfter} items)` : 'Context is already compact');
    } catch (err) {
      say((err as Error).message);
    } finally {
      setMaintBusy(null);
    }
  };
  const fill = data ? Math.min(100, Math.round((data.memory.historyChars / data.memory.compactAtChars) * 100)) : 0;
  return (
    <div className="cfg-page">
      <div className="cfg-page__head">
        <div>
          <div className="cfg-page__title">Memories</div>
          <div className="cfg-page__sub">What {bot.name} remembers about you. It saves things when you share them, and picks up more on its own once a chat goes quiet.</div>
        </div>
        {flash && <span className="cfg-savebar__note" role="status">{flash}</span>}
      </div>
      <form className="cfg-inline-form" onSubmit={addMemory}>
        <input
          className="text-input"
          enterKeyHint="done"
          placeholder={`Add a fact or preference for ${bot.name} to remember…`}
          value={newText}
          maxLength={400}
          onChange={(e) => setNewText(e.target.value)}
          aria-label="New memory"
        />
        <button type="submit" className="cfg-btn cfg-btn--primary" disabled={!newText.trim() || adding} style={{ flexShrink: 0 }}>
          <Icon name="plus" size={12} /> {adding ? 'Saving…' : 'Add'}
        </button>
      </form>
      {(data?.memories.length ?? 0) > 6 && (
        <input
          type="search"
          enterKeyHint="search"
          className="text-input"
          placeholder="Search memories"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && window.innerWidth <= 900) {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          aria-label="Search memories"
        />
      )}
      {!data ? <div className="cfg-empty">Loading…</div> : memories.length === 0 ? (
        <div className="cfg-empty">{q ? 'No memories match.' : `Nothing yet. Add a note above or tell ${bot.name} about yourself in chat.`}</div>
      ) : (
        <div className="cfg-list">
          {memories.map((m) => (
            <div key={m.id} className="cfg-item">
              <div className="cfg-item__text">
                <div className="cfg-item__body">{m.text}</div>
                <div className="cfg-item__meta">
                  {m.source === 'learned' ? <span className="cfg-chip">Picked up</span> : <span className="cfg-chip cfg-chip--muted">Saved in chat</span>}
                  <span>{shortDate(m.createdAt)}</span>
                </div>
              </div>
              <div className="cfg-item__actions">
                <ConfirmButton className="cfg-icon-btn" confirmLabel="Forget?" onConfirm={() => remove(m)} title="Forget" ariaLabel="Forget this memory">
                  <Glyph name="trash" size={14} />
                </ConfirmButton>
              </div>
            </div>
          ))}
        </div>
      )}
      {data && (
        <div className="cfg-meter" title="Older messages are summarized automatically when this fills up.">
          <div className="cfg-meter__label"><span>Conversation memory</span><span>{fill}% full</span></div>
          <div className="cfg-meter__track"><span style={{ width: `${Math.max(2, fill)}%` }} /></div>
          <div className="cfg-field__hint">
            When it fills up, older messages get summarized so {bot.name} can keep going.
            {data.memory.lastCompaction ? ` Last summarized ${shortDate(data.memory.lastCompaction.created_at)}.` : ''}
          </div>
          <div className="cfg-meter__actions">
            <button type="button" className="cfg-btn cfg-btn--secondary" disabled={maintBusy !== null} onClick={runConsolidate}>
              {maintBusy === 'consolidate' ? 'Extracting…' : 'Extract memories now'}
            </button>
            <button type="button" className="cfg-btn cfg-btn--secondary" disabled={maintBusy !== null} onClick={runCompact}>
              {maintBusy === 'compact' ? 'Compacting…' : 'Compact context'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

const CRON_PRESETS: { label: string; cron: string }[] = [
  { label: 'Weekdays 9am', cron: '0 9 * * 1-5' },
  { label: 'Daily 8am', cron: '0 8 * * *' },
  { label: 'Mondays 9am', cron: '0 9 * * 1' },
  { label: 'Fridays 4pm', cron: '0 16 * * 5' },
  { label: 'Hourly', cron: '0 * * * *' },
];

type RoutineDraft = Pick<Routine, 'name' | 'prompt'>;

function RoutinesTab({ bot, routines, onChange, draft }: { bot: Bot; routines: Routine[] | undefined; onChange: () => void; draft?: RoutineDraft }) {
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(draft ? 'new' : null);
  useEffect(() => () => { if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current); }, []);
  const say = (t: string) => {
    setFlash(t);
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => { setFlash(null); flashTimerRef.current = null; }, 2200);
  };
  const refresh = () => {
    onChange();
    useStore.getState().loadRoutines(bot.id).catch(() => {});
  };
  return (
    <div className="cfg-page">
      <div className="cfg-page__head">
        <div>
          <div className="cfg-page__title">Routines</div>
          <div className="cfg-page__sub">Recurring jobs {bot.name} runs on a schedule. Create one here or ask in chat.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {flash && <span className="cfg-savebar__note" role="status">{flash}</span>}
          {editing !== 'new' && (
            <button
              type="button"
              className="cfg-btn cfg-btn--primary"
              onClick={() => {
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                  try { navigator.vibrate(8); } catch {}
                }
                setEditing('new');
              }}
            >
              <Icon name="plus" size={12} /> New routine
            </button>
          )}
        </div>
      </div>
      {editing === 'new' && (
        <RoutineEditor
          botId={bot.id}
          draft={draft}
          onDone={(msg) => {
            setEditing(null);
            const { botSettings } = useConfigUI.getState();
            if (botSettings?.routineDraft) useConfigUI.setState({ botSettings: { ...botSettings, routineDraft: undefined } });
            if (msg) say(msg);
            refresh();
          }}
        />
      )}
      {!routines ? <div className="cfg-empty">Loading…</div> : routines.length === 0 && editing !== 'new' ? (
        <div className="cfg-empty">No routines yet. Click “New routine” above or ask {bot.name}: “every Friday at 4pm, recap my week”.</div>
      ) : (
        <div className="cfg-list">
          {routines.map((r) =>
            editing === r.id ? (
              <RoutineEditor
                key={r.id}
                botId={bot.id}
                routine={r}
                onDone={(msg) => {
                  setEditing(null);
                  if (msg) say(msg);
                  refresh();
                }}
              />
            ) : (
              <RoutineItem key={r.id} r={r} onFlash={say} onEdit={() => setEditing(r.id)} onRefresh={refresh} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function RoutineEditor({ botId, routine, draft, onDone }: { botId: string; routine?: Routine; draft?: RoutineDraft; onDone: (msg?: string) => void }) {
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const [name, setName] = useState(routine?.name ?? draft?.name ?? '');
  const [schedule, setSchedule] = useState(routine?.schedule ?? '0 9 * * 1-5');
  const [timezone, setTimezone] = useState(routine?.timezone ?? localTz);
  const [prompt, setPrompt] = useState(routine?.prompt ?? draft?.prompt ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const schedRef = useRef<HTMLInputElement>(null);
  const tzRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const isEvent = schedule.startsWith('event:');
  const can = name.trim() && schedule.trim() && prompt.trim() && !busy;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!can) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(12); } catch {}
    }
    setBusy(true);
    setError(null);
    try {
      if (routine) {
        await configApi.updateRoutine(routine.id, { name: name.trim(), schedule: schedule.trim(), timezone: timezone.trim() || 'UTC', prompt: prompt.trim() });
        if (window.innerWidth <= 900 && document.activeElement instanceof HTMLElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
          document.activeElement.blur();
        }
        onDone('Routine updated');
      } else {
        await configApi.createRoutine(botId, { name: name.trim(), schedule: schedule.trim(), timezone: timezone.trim() || 'UTC', prompt: prompt.trim() });
        if (window.innerWidth <= 900 && document.activeElement instanceof HTMLElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
          document.activeElement.blur();
        }
        onDone('Routine created');
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form className="cfg-editor" onSubmit={save}>
      <input
        className="text-input"
        enterKeyHint="next"
        placeholder="Routine name, e.g. Morning briefing"
        value={name}
        maxLength={80}
        onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !prompt.trim()) {
            e.preventDefault();
            (isEvent ? promptRef.current : schedRef.current)?.focus();
          }
        }}
        autoFocus={typeof window === 'undefined' || window.innerWidth > 900}
        aria-label="Routine name"
      />
      {!isEvent && (
        <div className="cfg-chips-wrap">
          {CRON_PRESETS.map((p) => (
            <button
              key={p.cron}
              type="button"
              aria-pressed={schedule === p.cron}
              className={`cfg-chip${schedule === p.cron ? '' : ' cfg-chip--muted'}`}
              onClick={() => {
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                  try { navigator.vibrate(8); } catch {}
                }
                if (window.innerWidth <= 900 && document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
                if (error) setError(null);
                setSchedule(p.cron);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      <div className="cfg-routine-fields">
        <input
          ref={schedRef}
          className="text-input"
          enterKeyHint="next"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Cron schedule (e.g. 0 9 * * 1-5)"
          value={schedule}
          disabled={isEvent}
          onChange={(e) => { setSchedule(e.target.value); if (error) setError(null); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !prompt.trim()) {
              e.preventDefault();
              tzRef.current?.focus();
            }
          }}
          aria-label="Cron schedule"
        />
        <input
          ref={tzRef}
          className="text-input"
          enterKeyHint="next"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Timezone (e.g. America/New_York)"
          value={timezone}
          disabled={isEvent}
          onChange={(e) => { setTimezone(e.target.value); if (error) setError(null); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !prompt.trim()) {
              e.preventDefault();
              promptRef.current?.focus();
            }
          }}
          aria-label="Routine timezone"
        />
      </div>
      <textarea
        ref={promptRef}
        className="text-input cfg-textarea"
        rows={4}
        placeholder="What should this Bot do each time the routine runs?"
        value={prompt}
        onChange={(e) => { setPrompt(e.target.value); if (error) setError(null); }}
        aria-label="Routine instructions"
      />
      {error && <div className="cfg-error" role="alert">{error}</div>}
      <div className="cfg-editor__actions">
        <button
          type="button"
          className="cfg-btn cfg-btn--secondary"
          onClick={() => {
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
            onDone();
          }}
        >
          Cancel
        </button>
        <button type="submit" className="cfg-btn cfg-btn--primary" disabled={!can}>{busy ? 'Saving…' : routine ? 'Save routine' : 'Create routine'}</button>
      </div>
    </form>
  );
}

function RoutineItem({ r, onFlash, onEdit, onRefresh }: { r: Routine; onFlash: (t: string) => void; onEdit: () => void; onRefresh: () => void }) {
  const [enabled, setEnabled] = useState(r.enabled);
  const [toggling, setToggling] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [dryRunning, setDryRunning] = useState(false);
  const [dryResult, setDryResult] = useState<RoutineDryRunResult | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<AgentRun[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  useEffect(() => setEnabled(r.enabled), [r.enabled]);

  const loadHistory = useCallback(() => {
    setHistoryError(null);
    configApi.routineRuns(r.id)
      .then(({ runs }) => setHistory(runs))
      .catch((e) => setHistoryError((e as Error).message));
  }, [r.id]);

  useEffect(() => {
    if (historyOpen) loadHistory();
  }, [historyOpen, r.lastRunAt, r.lastRunState, loadHistory]);

  const toggle = async (v: boolean) => {
    if (toggling) return;
    setToggling(true);
    setEnabled(v);
    try { await configApi.setRoutine(r.id, v); onFlash(v ? 'Resumed' : 'Paused'); onRefresh(); }
    catch { setEnabled(!v); onFlash('Could not update routine'); }
    finally { setToggling(false); }
  };

  const runDry = () => {
    if (dryRunning) return;
    setDryRunning(true);
    configApi.dryRunRoutine(r.id)
      .then((res) => {
        setDryResult(res);
        onFlash(res.ok ? 'Dry run passed' : `Dry run: ${res.warnings.length} warning${res.warnings.length === 1 ? '' : 's'}`);
      })
      .catch((e) => onFlash((e as Error).message))
      .finally(() => setDryRunning(false));
  };

  const runStateLabel = (state: AgentRun['state']) =>
    state === 'completed' ? 'Completed' : state === 'failed' ? 'Failed' : state === 'running' ? 'Running'
      : state === 'waiting' ? 'Waiting for approval' : state === 'interrupted' ? 'Interrupted' : 'Queued';

  return (
    <div className="cfg-item cfg-item--routine" style={{ flexWrap: 'wrap' }}>
      <span className="cfg-item__icon"><Icon name="clock" size={14} /></span>
      <div className="cfg-item__text">
        <div className="cfg-item__title">{r.name}</div>
        <div className="cfg-item__sub">{enabled ? [r.description || r.schedule, nextRunLabel(r.nextRunAt, r.timezone)].filter(Boolean).join(' · ') : 'Paused'}</div>
        <div className="cfg-item__prompt">{r.prompt}</div>
        {r.lastRunState === 'failed' && (
          <div className="cfg-error" role="alert" style={{ marginTop: 6 }}>
            Last run failed: {r.lastRunSummary || 'See run history for details.'}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
          <button type="button" className="link-btn link-btn--small" disabled={dryRunning} onClick={runDry}>
            {dryRunning ? 'Checking…' : 'Dry run'}
          </button>
          <button
            type="button"
            className="link-btn link-btn--small"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((open) => !open)}
          >
            {historyOpen ? 'Hide history' : 'Run history'}
          </button>
        </div>
        {dryResult && (
          <div className="cfg-field__hint" role="status" style={{ marginTop: 6 }}>
            <strong>{dryResult.ok ? 'Dry run OK' : 'Dry run warnings'}</strong>
            {dryResult.nextRunAt ? ` · Next scheduled: ${new Date(dryResult.nextRunAt).toLocaleString()}` : ''}
            {dryResult.warnings.length > 0 && (
              <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                {dryResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
          </div>
        )}
        {historyOpen && (
          <div style={{ marginTop: 8 }}>
            {historyError && <div className="cfg-error" role="alert">{historyError}</div>}
            {!history && !historyError && <div className="cfg-field__hint">Loading run history…</div>}
            {history && history.length === 0 && <div className="cfg-field__hint">No runs recorded yet.</div>}
            {history && history.length > 0 && (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {history.map((run) => (
                  <li key={run.id} className="cfg-field__hint" style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span>
                      <strong>{runStateLabel(run.state)}</strong>
                      {' · '}
                      {run.source === 'manual-routine' ? 'Test fire' : run.source === 'event' ? 'Event' : 'Scheduled'}
                      {' · '}
                      {new Date(run.createdAt).toLocaleString()}
                    </span>
                    {run.summary && (
                      <span style={run.state === 'failed' ? { color: 'var(--color-danger-text)' } : undefined}>
                        {run.summary}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="cfg-item__actions">
        <button
          type="button"
          className="cfg-icon-btn"
          title="Test fire (run now)"
          aria-label={`Test fire ${r.name} now`}
          disabled={runningNow}
          onClick={() => {
            if (runningNow) return;
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
              try { navigator.vibrate(10); } catch {}
            }
            setRunningNow(true);
            configApi.runRoutine(r.id)
              .then(() => {
                onFlash('Test-fired routine');
                onRefresh();
                if (historyOpen) loadHistory();
              })
              .catch((e) => onFlash(e.message))
              .finally(() => setRunningNow(false));
          }}
        >
          {runningNow ? <span className="cfg-spinner" /> : <Glyph name="play" size={13} />}
        </button>
        <button
          type="button"
          className="cfg-icon-btn"
          title="Edit"
          aria-label={`Edit ${r.name}`}
          onClick={() => {
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
              try { navigator.vibrate(8); } catch {}
            }
            onEdit();
          }}
        >
          <Icon name="edit" size={14} />
        </button>
        <ConfirmButton
          className="cfg-icon-btn"
          title="Delete"
          ariaLabel={`Delete ${r.name}`}
          onConfirm={() => configApi.deleteRoutine(r.id).then(() => { onFlash('Deleted'); onRefresh(); }).catch((e) => onFlash((e as Error).message))}
        >
          <Glyph name="trash" size={14} />
        </ConfirmButton>
        <Switch on={enabled} onChange={toggle} disabled={toggling} label={`${r.name} ${enabled ? 'on' : 'paused'}`} />
      </div>
    </div>
  );
}
