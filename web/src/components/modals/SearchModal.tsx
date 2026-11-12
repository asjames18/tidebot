import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ShaderStyle } from '@shared/types';
import { BotAvatarFor } from '../../avatar/BotAvatar';
import { useConfigUI } from '../../configStore';
import { api, type SearchResults } from '../../lib/api';
import { configApi } from '../../lib/configApi';
import { relativeShort } from '../../lib/time';
import { displayName, useSelectedBot, useStore } from '../../store';
import { Glyph } from '../config/glyphs';
import { Icon } from '../Icon';
import { Modal } from './Modal';

type PaletteItem = {
  key: string;
  section: 'Operators' | 'Switch Model' | 'Messages' | 'Memories' | 'Tasks' | 'TideBot Commands';
  run: () => void;
  render: () => React.ReactNode;
};

export function SearchModal() {
  const bots = useStore((s) => s.bots);
  const selectedBot = useSelectedBot();
  const setModal = useStore((s) => s.setModal);
  const selectBot = useStore((s) => s.selectBot);
  const curatedModels = useConfigUI((s) => s.curatedModels);
  const llmConfig = useConfigUI((s) => s.llmConfig);
  const setLlmConfig = useConfigUI((s) => s.setLlmConfig);
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState<SearchResults | null>(null);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setModal(null), [setModal]);

  const byId = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);

  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) {
      setRemote(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      api.search(needle).then((res) => { if (alive) setRemote(res); }).catch(() => {});
    }, 160);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  const openBot = useCallback((id: string) => {
    useConfigUI.getState().setView('chat');
    selectBot(id);
    close();
  }, [selectBot, close]);

  const items = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [];
    const ordered = [...bots].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || b.lastActivityAt - a.lastActivityAt);
    const needle = q.trim().toLowerCase();

    const matchedBots = needle
      ? ordered.filter((b) => `${b.name} ${b.label} ${b.description}`.toLowerCase().includes(needle))
      : ordered;

    for (const b of matchedBots) {
      out.push({
        key: `bot:${b.id}`,
        section: 'Operators',
        run: () => openBot(b.id),
        render: () => (
          <>
            <BotAvatarFor bot={b} size={28} />
            <span className="search-row__text">
              <span className="search-row__name">{displayName(b)}</span>
              <span className="search-row__sub">{b.lastPreview ?? (b.description || 'Ready for instructions')}</span>
            </span>
          </>
        ),
      });
    }

    if (selectedBot && selectedBot.kind !== 'room') {
      const matchedModels = needle
        ? curatedModels.filter((m) => `${m.id} ${m.name} ${m.provider} ${m.badge ?? ''}`.toLowerCase().includes(needle))
        : curatedModels.slice(0, 4);
      for (const m of matchedModels.slice(0, 6)) {
        const isCurrent = (selectedBot.model || llmConfig?.defaultModel) === m.id;
        out.push({
          key: `model:${m.id}`,
          section: 'Switch Model',
          run: () => {
            configApi.updateBot(selectedBot.id, { model: m.id }).then(({ bot: updated }) => {
              useStore.setState((s) => ({ bots: s.bots.map((x) => (x.id === updated.id ? updated : x)) }));
            }).catch(() => {});
            close();
          },
          render: () => (
            <>
              <span style={{ width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: 'rgba(56, 189, 248, 0.14)', color: '#38BDF8', fontSize: 12, fontWeight: 700 }}>
                AI
              </span>
              <span className="search-row__text">
                <span className="search-row__name">
                  {isCurrent ? `✓ ${m.name}` : `Switch ${selectedBot.name} to ${m.name}`}
                </span>
                <span className="search-row__sub">{m.id} · {m.provider}{m.badge ? ` · ${m.badge}` : ''}</span>
              </span>
            </>
          ),
        });
      }
    }

    if (needle && remote) {
      for (const m of remote.messages) {
        const bot = byId.get(m.botId);
        out.push({
          key: `msg:${m.botId}:${m.seq}`,
          section: 'Messages',
          run: () => openBot(m.botId),
          render: () => (
            <>
              {bot ? <BotAvatarFor bot={bot} size={24} /> : <Icon name="search" size={16} opacity={0.5} />}
              <span className="search-row__text">
                <span className="search-row__name">{m.role === 'user' ? `You → ${m.botName}` : m.botName} · <span style={{ opacity: 0.55, fontWeight: 400 }}>{relativeShort(m.createdAt)}</span></span>
                <span className="search-row__sub">{m.snippet}</span>
              </span>
            </>
          ),
        });
      }
      for (const mem of remote.memories) {
        const bot = byId.get(mem.botId);
        out.push({
          key: `mem:${mem.id}`,
          section: 'Memories',
          run: () => {
            close();
            useConfigUI.getState().openBotSettings(mem.botId, 'memories');
          },
          render: () => (
            <>
              {bot ? <BotAvatarFor bot={bot} size={24} /> : <Glyph name="spark" size={16} />}
              <span className="search-row__text">
                <span className="search-row__name">{mem.botName} memory</span>
                <span className="search-row__sub">{mem.text}</span>
              </span>
            </>
          ),
        });
      }
      for (const tk of remote.tasks) {
        const bot = byId.get(tk.botId);
        out.push({
          key: `task:${tk.id}`,
          section: 'Tasks',
          run: () => {
            close();
            useConfigUI.getState().setView('tasks');
          },
          render: () => (
            <>
              {bot ? <BotAvatarFor bot={bot} size={24} /> : <Glyph name="tasks" size={16} />}
              <span className="search-row__text">
                <span className="search-row__name">{tk.title}</span>
                <span className="search-row__sub">{tk.botName} · {tk.state === 'done' ? 'Done' : tk.state === 'needs_input' ? 'Waiting on you' : 'In progress'}</span>
              </span>
            </>
          ),
        });
      }
    }

    const actions: { id: string; title: string; sub: string; keywords: string; run: () => void }[] = [
      { id: 'byom-models', title: 'Models & OpenRouter (BYOM)', sub: 'Configure OpenRouter API key, custom endpoints, and default model', keywords: 'openrouter byom model api key claude gemini deepseek', run: () => { close(); useConfigUI.getState().openAppSettings('models'); } },
      { id: 'connect-apps', title: 'Connect Composio Apps', sub: 'Browse 1,500+ integrations: Gmail, Slack, GitHub, Calendar, Notion', keywords: 'connect apps integrations composio tools oauth', run: () => setModal('apps') },
      { id: 'create-bot', title: 'Deploy New Operator', sub: 'Add a specialist or teammate Operator with custom model & skills', keywords: 'new bot operator create template', run: () => setModal('create') },
      { id: 'create-group', title: 'New Multi-Operator War Room', sub: 'Start a collaborative room with multiple Operators', keywords: 'group room chat team war room', run: () => setModal('group') },
      ...(selectedBot && selectedBot.kind !== 'room' ? [
        {
          id: 'clone-bot',
          title: `Clone ${selectedBot.name}`,
          sub: 'Duplicate instructions, skills, and model configuration into a new Operator',
          keywords: 'clone duplicate copy operator',
          run: () => {
            close();
            api.cloneBot(selectedBot.id).then(({ bot }) => {
              useStore.getState().loadBots().then(() => useStore.getState().selectBot(bot.id));
            }).catch(() => {});
          },
        },
        {
          id: 'export-bot',
          title: `Export ${selectedBot.name} Transcript (.md)`,
          sub: 'Download full conversation history and reasoning trace as Markdown',
          keywords: 'export download markdown transcript history',
          run: () => {
            close();
            window.open(api.exportBotUrl(selectedBot.id), '_blank');
          },
        },
      ] : []),
      { id: 'tasks-view', title: 'Open Tasks Command Center', sub: 'View, delegate, and manage tasks across all Operators', keywords: 'tasks todo progress kanban', run: () => { close(); useConfigUI.getState().setView('tasks'); } },
      {
        id: 'cycle-shader',
        title: 'Cycle WebGL Ambient Shader',
        sub: `Current: ${(llmConfig?.shaderStyle ?? 'aurora').toUpperCase()} (Aurora · Plasma · Obsidian · Vortex · Grid)`,
        keywords: 'shader webgl background aurora plasma obsidian vortex grid theme',
        run: () => {
          const styles: ShaderStyle[] = ['aurora', 'plasma', 'obsidian', 'vortex', 'grid'];
          const cur = llmConfig?.shaderStyle ?? 'aurora';
          const next = styles[(styles.indexOf(cur) + 1) % styles.length];
          configApi.saveLlmConfig({ shaderStyle: next }).then(setLlmConfig).catch(() => {});
          close();
        },
      },
      { id: 'app-settings', title: 'TideBot Studio Settings & Computer', sub: 'Theme, shader engine, cloud computer screens, and tool permissions', keywords: 'settings preferences computer permissions theme dark light', run: () => { close(); useConfigUI.getState().openAppSettings(); } },
    ];
    for (const act of actions) {
      if (!needle || `${act.title} ${act.sub} ${act.keywords}`.toLowerCase().includes(needle)) {
        out.push({
          key: `act:${act.id}`,
          section: 'TideBot Commands',
          run: act.run,
          render: () => (
            <>
              <span style={{ width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: 'var(--color-bg-tertiary)' }}>
                <Glyph name="gear" size={15} opacity={0.75} />
              </span>
              <span className="search-row__text">
                <span className="search-row__name">{act.title}</span>
                <span className="search-row__sub">{act.sub}</span>
              </span>
            </>
          ),
        });
      }
    }
    return out;
  }, [bots, byId, q, remote, openBot, close, setModal, selectedBot, curatedModels, llmConfig, setLlmConfig]);

  useEffect(() => setActive(0), [q, remote]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  let lastSection: string | null = null;

  return (
    <Modal onClose={close} className="search-modal" label="TideBot Command Palette">
      <div className="search-modal__field">
        <span className="search-modal__icon"><Icon name="search" size={18} opacity={0.56} /></span>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={typeof window !== 'undefined' && window.innerWidth <= 640 ? "Search Operators, models, commands…" : "Search Operators, switch models (claude, gemini, deepseek…), or run commands…"}
          aria-label="Command and search palette"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, Math.max(0, items.length - 1))); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter' && items[active]) {
              e.preventDefault();
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
              items[active].run();
            }
          }}
        />
      </div>
      <div className="search-modal__results" ref={listRef} role="listbox">
        {items.map((item, i) => {
          const showHeader = item.section !== lastSection;
          lastSection = item.section;
          return (
            <div key={item.key}>
              {showHeader && <div className="search-modal__section">{item.section}</div>}
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                data-idx={i}
                className={`search-row${i === active ? ' is-active' : ''}`}
                onMouseMove={() => setActive(i)}
                onClick={() => {
                  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
                  item.run();
                }}
              >
                {item.render()}
              </button>
            </div>
          );
        })}
        {items.length === 0 && <div className="search-modal__empty">Nothing matches “{q}”</div>}
      </div>
    </Modal>
  );
}
