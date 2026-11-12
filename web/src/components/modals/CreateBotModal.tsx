import { useCallback, useState } from 'react';
import type { AvatarColor, AvatarShape, Bot } from '@shared/types';
import { BotAvatar, PICKER_SHAPES } from '../../avatar/BotAvatar';
import { api } from '../../lib/api';
import { COLOR_ORDER, palette } from '../../lib/colors';
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

export function CreateBotModal() {
  const setModal = useStore((s) => s.setModal);
  const curatedModels = useConfigUI((s) => s.curatedModels);
  const llmConfig = useConfigUI((s) => s.llmConfig);
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [model, setModel] = useState('');
  const [shape, setShape] = useState<AvatarShape>('hex');
  const [color, setColor] = useState<AvatarColor>('cyan');
  const [mode, setMode] = useState<Bot['mode']>('personal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = useCallback(() => setModal(null), [setModal]);
  const canCreate = name.trim().length > 0 && !busy;

  const applyTemplate = (t: BotTemplate) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
    setName(t.name);
    setLabel(t.label);
    setDescription(t.description);
    setInstructions(t.instructions);
    setShape(t.shape);
    setColor(t.color);
    setMode(t.mode);
  };

  const create = async () => {
    if (!canCreate) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(12); } catch {} }
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
      st.set({ bots: st.bots.some((b) => b.id === bot.id) ? st.bots : [...st.bots, bot] });
      st.selectBot(bot.id);
      close();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal onClose={close} className="create-modal" label="Create New Bot">
      <form onSubmit={(e) => { e.preventDefault(); create(); }}>
        <div className="modal__header">
          <div className="modal__title">Create New Bot</div>
          <button type="button" className="modal__close" onClick={close} aria-label="Close"><Icon name="close" size={14} opacity={0.68} /></button>
        </div>
        <div className="create-modal__body">
          <BotAvatar shape={shape} color={color} size={96} className="create-modal__preview" />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', width: '100%' }} aria-label="Role templates">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="cat-pill create-modal__template-pill"
                onClick={() => applyTemplate(t)}
                title={t.description}
              >
                {t.title}
              </button>
            ))}
          </div>
          <input
            className="text-input create-modal__name"
            placeholder="Give your Bot a name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            aria-label="Bot name"
          />
          <input
            className="text-input create-modal__name"
            placeholder="Role or label (optional, e.g. Research)"
            value={label}
            maxLength={60}
            onChange={(e) => setLabel(e.target.value)}
            aria-label="Bot label"
            style={{ marginTop: -4 }}
          />
          <select
            className="text-input create-modal__name"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            aria-label="Bot model"
            style={{ marginTop: -4 }}
          >
            <option value="">Default Model ({llmConfig?.defaultModel ?? 'anthropic/claude-3.7-sonnet'})</option>
            {curatedModels.map((m) => (
              <option key={m.id} value={m.id}>{m.name} · {m.provider}</option>
            ))}
          </select>
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
                      setColor(c);
                    }}
                  >
                    <span className={`swatch${color === c ? ' is-selected' : ''}`} style={{ background: palette(c).fill }} />
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="mode-pick" role="radiogroup" aria-label="Bot type">
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'personal'}
              className={`mode-pick__opt${mode === 'personal' ? ' is-active' : ''}`}
              onClick={() => {
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                setMode('personal');
              }}
            >
              <span className="mode-pick__title">Personal assistant</span>
              <span className="mode-pick__sub">Works for you, with your apps</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'teammate'}
              className={`mode-pick__opt${mode === 'teammate' ? ' is-active' : ''}`}
              onClick={() => {
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                setMode('teammate');
              }}
            >
              <span className="mode-pick__title">Teammate</span>
              <span className="mode-pick__sub">Works with your whole team</span>
            </button>
          </div>
          {error && <div className="card__error">{error}</div>}
        </div>
        <div className="modal__footer">
          <button
            type="button"
            className="link-btn link-btn--small"
            style={{ marginRight: 'auto' }}
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
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
              close();
            }}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn--primary btn--sm" disabled={!canCreate}>{busy ? 'Creating…' : 'Create'}</button>
        </div>
      </form>
    </Modal>
  );
}
