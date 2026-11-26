import { useCallback, useEffect, useRef, useState } from 'react';
import type { AvatarColor, AvatarShape, Bot } from '@shared/types';
import { BotAvatar, PICKER_SHAPES } from '../../avatar/BotAvatar';
import { api } from '../../lib/api';
import { COLOR_ORDER, palette } from '../../lib/colors';
import { nextTemplateField } from '../../lib/templateField';
import { useConfigUI } from '../../configStore';
import { useStore } from '../../store';
import { Icon } from '../Icon';
import { Modal } from './Modal';

const ROWS = [PICKER_SHAPES.slice(0, 5), PICKER_SHAPES.slice(5, 10), PICKER_SHAPES.slice(10)];
const COLOR_ROWS = [COLOR_ORDER.slice(0, 6), COLOR_ORDER.slice(6)];

interface BotTemplate {
  id: string;
  title: string;
  name: string;
  label: string;
  description: string;
  instructions: string;
  shape: AvatarShape;
  color: AvatarColor;
  mode: Bot['mode'];
}

const TEMPLATES: BotTemplate[] = [
  {
    id: 'research',
    title: 'Research',
    name: 'Atlas',
    label: 'Research Analyst',
    description: 'Deep-dives topics, compares companies, and writes structured briefings.',
    instructions: 'Lead with key findings and sources. Use concise bullet points and markdown tables when comparing options.',
    shape: 'gem',
    color: 'blue',
    mode: 'teammate',
  },
  {
    id: 'inbox',
    title: 'Inbox & Calendar',
    name: 'Clara',
    label: 'Executive Assistant',
    description: 'Triages email, preps meeting briefs, and keeps your calendar organized.',
    instructions: 'Summarize action items clearly. Always ask before sending external emails or rescheduling meetings.',
    shape: 'clover',
    color: 'green',
    mode: 'personal',
  },
  {
    id: 'eng',
    title: 'Engineering',
    name: 'Devon',
    label: 'Software Engineer',
    description: 'Writes code, runs shell commands, debugs issues, and reviews PRs.',
    instructions: 'Verify changes by running tests or commands on your computer before reporting completion. Prefer clean, minimal code.',
    shape: 'hex',
    color: 'violet',
    mode: 'teammate',
  },
  {
    id: 'social',
    title: 'Growth & Social',
    name: 'Nova',
    label: 'Social & Content',
    description: 'Monitors X trends, drafts posts, and tracks launch announcements.',
    instructions: 'Write sharp, engaging copy without clichés or hashtags. Give 2-3 variations when drafting posts.',
    shape: 'sparkle',
    color: 'orange',
    mode: 'teammate',
  },
];

const BLANK: BotTemplate = {
  id: 'blank', title: 'Blank bot', name: '', label: '', description: 'Set your own role and instructions.',
  instructions: '', shape: 'hex', color: 'cyan', mode: 'personal',
};

const STARTERS = [BLANK, ...TEMPLATES];

export function CreateBotModal() {
  const setModal = useStore((s) => s.setModal);
  const curatedModels = useConfigUI((s) => s.curatedModels);
  const loadModels = useConfigUI((s) => s.loadModels);
  const llmConfig = useConfigUI((s) => s.llmConfig);
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [model, setModel] = useState('');
  const [shape, setShape] = useState<AvatarShape>('hex');
  const [color, setColor] = useState<AvatarColor>('cyan');
  const [mode, setMode] = useState<Bot['mode']>('personal');
  const [activeTemplate, setActiveTemplate] = useState(BLANK.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodyTouchStartYRef = useRef<number | null>(null);
  const customChoices = useRef({ shape: false, color: false, mode: false });
  const close = useCallback(() => setModal(null), [setModal]);
  const canCreate = name.trim().length > 0 && !busy;

  useEffect(() => {
    if (!curatedModels.length) void loadModels();
  }, [curatedModels.length, loadModels]);

  const blurInputOnMobile = () => {
    if (typeof window !== 'undefined' && window.innerWidth <= 900) {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) {
        active.blur();
      }
    }
  };

  const applyTemplate = (t: BotTemplate, el?: HTMLElement | null) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
    blurInputOnMobile();
    setActiveTemplate(t.id);
    const previous = STARTERS.find((starter) => starter.id === activeTemplate);
    // What the previous template actually applied (Blank applies '' for description).
    const prevDescription = previous ? (previous.id === BLANK.id ? '' : previous.description) : undefined;
    const nextDescription = t.id === BLANK.id ? '' : t.description;
    setName((current) => nextTemplateField(current, previous?.name, t.name));
    setLabel((current) => nextTemplateField(current, previous?.label, t.label));
    setDescription((current) => nextTemplateField(current, prevDescription, nextDescription));
    setInstructions((current) => nextTemplateField(current, previous?.instructions, t.instructions));
    if (!customChoices.current.shape) setShape(t.shape);
    if (!customChoices.current.color) setColor(t.color);
    if (!customChoices.current.mode) setMode(t.mode);
    setError(null);
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  };

  const chooseMode = (mode: Bot['mode']) => {
    customChoices.current.mode = true;
    setMode(mode);
  };

  const create = async () => {
    if (!canCreate) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(12); } catch {} }
    blurInputOnMobile();
    setBusy(true); setError(null);
    try {
      const { bot } = await api.createBot({
        name: name.trim(),
        label: label.trim() || undefined,
        description: description.trim() || undefined,
        instructions: instructions.trim() || undefined,
        model: model.trim() || undefined,
        avatarShape: shape,
        avatarColor: color,
        mode,
      });
      const st = useStore.getState();
      st.set({ bots: st.bots.some((b) => b.id === bot.id) ? st.bots : [...st.bots, bot], detailsOpen: false, detailsTab: 'activity' });
      useConfigUI.getState().setView('chat');
      st.selectBot(bot.id);
      close();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal onClose={close} className="create-modal create-modal--bot" label="Create a bot">
      <form onSubmit={(e) => { e.preventDefault(); create(); }}>
        <div className="modal__header">
          <h2 className="modal__title">Create a bot</h2>
          <button
            type="button"
            className="modal__close"
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
              close();
            }}
            aria-label="Close"
          >
            <Icon name="close" size={14} opacity={0.68} />
          </button>
        </div>
        <div
          ref={bodyRef}
          className="create-modal__body create-modal__body--bot"
          onTouchStart={(e) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest('textarea')) { bodyTouchStartYRef.current = null; return; }
            bodyTouchStartYRef.current = e.touches[0]?.clientY ?? null;
          }}
          onTouchMove={(e) => {
            if (bodyTouchStartYRef.current === null || window.innerWidth > 900) return;
            const y = e.touches[0]?.clientY;
            if (y !== undefined && Math.abs(y - bodyTouchStartYRef.current) > 18) {
              bodyTouchStartYRef.current = null;
              const active = document.activeElement;
              if (active instanceof HTMLElement && bodyRef.current?.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
                active.blur();
              }
            }
          }}
          onTouchEnd={() => { bodyTouchStartYRef.current = null; }}
          onTouchCancel={() => { bodyTouchStartYRef.current = null; }}
        >
          <section className="create-modal__section" aria-labelledby="create-bot-role">
            <h3 id="create-bot-role">Choose a role</h3>
            <div className="create-modal__templates" role="group" aria-labelledby="create-bot-role">
              {STARTERS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`cat-pill create-modal__template-pill${activeTemplate === t.id ? ' is-active' : ''}`}
                  aria-pressed={activeTemplate === t.id}
                  onClick={(e) => applyTemplate(t, e.currentTarget)}
                >
                  <BotAvatar shape={t.shape} color={t.color} size={26} />
                  <span className="create-modal__template-copy"><strong>{t.title}</strong><span>{t.description}</span></span>
                </button>
              ))}
            </div>
          </section>
          <div className="create-modal__identity">
            <BotAvatar shape={shape} color={color} size={46} />
            <label className="create-modal__field">
              <span>Bot name</span>
              <input
                className="text-input"
                enterKeyHint="go"
                autoCapitalize="words"
                placeholder="Give your bot a name"
                value={name}
                maxLength={60}
                required
                onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
              />
            </label>
          </div>
          <section className="create-modal__section" aria-labelledby="create-bot-access">
            <h3 id="create-bot-access">Working mode</h3>
            <div className="mode-pick" role="radiogroup" aria-labelledby="create-bot-access">
              <label className={`mode-pick__opt${mode === 'personal' ? ' is-active' : ''}`}>
                <input type="radio" name="bot-mode" value="personal" checked={mode === 'personal'} onChange={() => chooseMode('personal')} />
                <span className="mode-pick__title">Personal assistant</span>
                <span className="mode-pick__sub">Works for you, with your apps</span>
              </label>
              <label className={`mode-pick__opt${mode === 'teammate' ? ' is-active' : ''}`}>
                <input type="radio" name="bot-mode" value="teammate" checked={mode === 'teammate'} onChange={() => chooseMode('teammate')} />
                <span className="mode-pick__title">Teammate</span>
                <span className="mode-pick__sub">Works with your team in rooms</span>
              </label>
            </div>
          </section>
          <details className="create-modal__customize">
            <summary>Customize instructions, model, and avatar</summary>
            <div className="create-modal__options">
              <label className="create-modal__field">
                <span>Role label (optional)</span>
                <input className="text-input" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
              </label>
              <label className="create-modal__field">
                <span>Description</span>
                <textarea className="text-input" rows={2} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
              </label>
              <label className="create-modal__field">
                <span>Instructions</span>
                <textarea className="text-input" rows={4} value={instructions} maxLength={8000} onChange={(e) => setInstructions(e.target.value)} />
              </label>
              <label className="create-modal__field">
                <span>Bot model</span>
                <select className="text-input" value={model} onChange={(e) => setModel(e.target.value)}>
                  <option value="">{llmConfig?.defaultModel ? `Studio default (${llmConfig.defaultModel})` : 'Studio default'}</option>
                  {curatedModels.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.provider}</option>)}
                </select>
              </label>
              <div className="create-modal__section">
                <h3>Avatar</h3>
                <div className="shape-grid" role="radiogroup" aria-label="Character shape">
                  {ROWS.map((row, i) => (
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
                            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(6); } catch {} }
                            blurInputOnMobile();
                            customChoices.current.shape = true;
                            setShape(s);
                          }}
                        >
                          <BotAvatar shape={s} color={color} size={36} ring={shape === s} />
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
                            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(6); } catch {} }
                            blurInputOnMobile();
                            customChoices.current.color = true;
                            setColor(c);
                          }}
                        >
                          <span className={`swatch${color === c ? ' is-selected' : ''}`} style={{ background: palette(c).fill }} />
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </details>
          {error && <div className="card__error" role="alert">{error}</div>}
        </div>
        <div className="modal__footer">
          <button
            type="button"
            className="link-btn link-btn--small"
            style={{ marginRight: 'auto' }}
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
              blurInputOnMobile();
              setModal('group');
            }}
          >
            New group chat instead
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
              blurInputOnMobile();
              close();
            }}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn--primary btn--sm" disabled={!canCreate}>{busy ? 'Creating…' : 'Create bot'}</button>
        </div>
      </form>
    </Modal>
  );
}
