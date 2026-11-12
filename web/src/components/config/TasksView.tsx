import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Bot, Task } from '@shared/types';
import { BotAvatarFor } from '../../avatar/BotAvatar';
import { api } from '../../lib/api';
import { configApi } from '../../lib/configApi';
import { relativeShort } from '../../lib/time';
import { useConfigUI, useVersion } from '../../configStore';
import { useStore } from '../../store';
import { Icon } from '../Icon';
import { Glyph } from './glyphs';
import './ui';

type Filter = 'all' | 'open' | 'done';

const STATE_LABEL: Record<Task['state'], string> = { working: 'Working on it', needs_input: 'Waiting on you', done: 'Done' };

function when(t: Task): string {
  const r = relativeShort(t.updatedAt);
  const ago = r === 'now' ? 'just now' : r === 'Yesterday' ? 'yesterday' : `${r} ago`;
  return t.state === 'done' ? `Completed ${ago}` : t.state === 'needs_input' ? `Asked ${ago}` : `Updated ${ago}`;
}

function refreshTaskViews(botId: string) {
  const { bump } = useConfigUI.getState();
  bump('tasks');
  bump(`tasks:${botId}`);
}

function TaskRow({ t, bot, showBot }: { t: Task; bot?: Bot; showBot: boolean }) {
  const open = () => { if (bot) { useStore.getState().selectBot(bot.id); useConfigUI.getState().setView('chat'); } };
  const toggleDone = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
    const nextState: Task['state'] = t.state === 'done' ? 'working' : 'done';
    await configApi.updateTask(t.id, { state: nextState }).catch(() => {});
    refreshTaskViews(t.botId);
  };
  const runTaskNow = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!bot) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
    useStore.getState().selectBot(bot.id);
    useConfigUI.getState().setView('chat');
    await api.send(bot.id, `Please execute this task and mark it done when complete: "${t.title}" (task_id: ${t.id})${t.note ? ` — Notes: ${t.note}` : ''}`).catch(() => {});
  };
  const remove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
    await configApi.deleteTask(t.id).catch(() => {});
    refreshTaskViews(t.botId);
  };
  return (
    <div className={`task-row is-${t.state}`} role="listitem">
      <button
        type="button"
        className={`task-row__check is-${t.state}`}
        onClick={toggleDone}
        title={t.state === 'done' ? 'Mark as in progress' : 'Mark as done'}
        aria-label={t.state === 'done' ? `Mark "${t.title}" as in progress` : `Mark "${t.title}" as done`}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
      >
        {t.state === 'done' ? <Glyph name="check_circle" size={18} /> : <span className="task-row__ring" />}
      </button>
      <span
        className="task-row__text"
        onClick={open}
        role={bot ? 'button' : undefined}
        tabIndex={bot ? 0 : undefined}
        onKeyDown={(e) => { if (e.key === 'Enter') open(); }}
        style={{ cursor: bot ? 'pointer' : 'default' }}
        title={bot ? `Open ${bot.name}` : undefined}
      >
        <span className="task-row__title">{t.title}</span>
        {t.note && <span className="task-row__note">{t.note}</span>}
        <span className="task-row__meta">
          {showBot && bot && <><BotAvatarFor bot={bot} size={14} /><span>{bot.name}</span><span aria-hidden>·</span></>}
          <span>{when(t)}</span>
        </span>
      </span>
      {t.state !== 'done' && bot && (
        <button
          type="button"
          className="cfg-btn cfg-btn--secondary"
          onClick={runTaskNow}
          style={{ height: 26, padding: '0 8px', fontSize: 11.5 }}
          title={`Have ${bot.name} work on this task now`}
        >
          Run ↗
        </button>
      )}
      <span className={`task-chip is-${t.state}`}>{STATE_LABEL[t.state]}</span>
      <button type="button" className="cfg-icon-btn" onClick={remove} title="Delete task" aria-label={`Delete ${t.title}`}>
        <Glyph name="trash" size={13} />
      </button>
    </div>
  );
}

function useTasks(botId?: string): Task[] | null {
  const v = useVersion(botId ? `tasks:${botId}` : 'tasks');
  const [tasks, setTasks] = useState<Task[] | null>(null);
  useEffect(() => {
    let alive = true;
    (botId ? configApi.botTasks(botId) : configApi.tasks()).then((r) => { if (alive) setTasks(r.tasks); }).catch(() => { if (alive) setTasks([]); });
    return () => { alive = false; };
  }, [botId, v]);
  return tasks;
}

function sortTasks(list: Task[]) {
  const rank = { needs_input: 0, working: 1, done: 2 } as const;
  return [...list].sort((a, b) => rank[a.state] - rank[b.state] || b.updatedAt - a.updatedAt);
}

/** Full Tasks view in the main column (sidebar → Tasks). */
export function TasksView() {
  const bots = useStore((s) => s.bots);
  const selectedId = useStore((s) => s.selectedBotId);
  const tasks = useTasks();
  const [filter, setFilter] = useState<Filter>('open');
  const [newTitle, setNewTitle] = useState('');
  const [targetBotId, setTargetBotId] = useState<string>('');
  const [adding, setAdding] = useState(false);

  const nonRoomBots = useMemo(() => bots.filter((b) => b.kind !== 'room'), [bots]);
  const effectiveBotId = targetBotId || (nonRoomBots.some((b) => b.id === selectedId) ? selectedId! : nonRoomBots[0]?.id ?? '');

  const byId = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  const counts = useMemo(
    () => ({
      waiting: tasks?.filter((t) => t.state === 'needs_input').length ?? 0,
      working: tasks?.filter((t) => t.state === 'working').length ?? 0,
      open: tasks?.filter((t) => t.state !== 'done').length ?? 0,
      done: tasks?.filter((t) => t.state === 'done').length ?? 0,
    }),
    [tasks],
  );
  const shown = useMemo(() => sortTasks((tasks ?? []).filter((t) => filter === 'all' || (filter === 'done' ? t.state === 'done' : t.state !== 'done'))), [tasks, filter]);

  const handleAdd = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title || !effectiveBotId || adding) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
    setAdding(true);
    try {
      await configApi.createTask(effectiveBotId, { title });
      setNewTitle('');
      refreshTaskViews(effectiveBotId);
    } finally {
      setAdding(false);
    }
  }, [newTitle, effectiveBotId, adding]);

  return (
    <main className="chat tasks-view">
      <header className="tasks-view__header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="icon-btn icon-btn--bordered mobile-nav-btn mobile-nav-btn--inline"
            onClick={() => useStore.getState().set({ mobileSidebarOpen: true, sidebarCollapsed: false })}
            aria-label="Open operators list"
          >
            <Icon name="sidebar" opacity={0.8} />
          </button>
          <button
            type="button"
            className="cfg-btn cfg-btn--secondary mobile-only-btn"
            onClick={() => useConfigUI.getState().setView('chat')}
            style={{ height: 32, padding: '0 8px', fontSize: 12, gap: 4 }}
            title="Return to Operator Chat"
          >
            <Glyph name="arrow_left" size={12} /> Chat
          </button>
          <div className="tasks-view__title">Operator Tasks</div>
          <span className="tidebot-pill tideos-pill tideos-pill--glow">{counts.open} Active</span>
        </div>
        <div className="segmented" role="tablist" aria-label="Filter tasks">
          {([['open', `In progress${counts.open ? ` (${counts.open})` : ''}`], ['done', `Done${counts.done ? ` (${counts.done})` : ''}`], ['all', 'All']] as [Filter, string][]).map(([f, label]) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              className={filter === f ? 'is-active' : ''}
              onClick={() => {
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                setFilter(f);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <div className="tasks-view__scroll">
        <div className="tasks-view__inner">
          <div className="tasks-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
            <div className="cfg-card" style={{ padding: '12px 14px' }}>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono-stack)', color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>Active Work</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--color-ink)', marginTop: 2 }}>{counts.working}</div>
            </div>
            <div className="cfg-card" style={{ padding: '12px 14px' }}>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono-stack)', color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>Waiting on You</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: counts.waiting ? 'var(--color-warn-text)' : 'var(--color-ink)', marginTop: 2 }}>{counts.waiting}</div>
            </div>
            <div className="cfg-card" style={{ padding: '12px 14px' }}>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono-stack)', color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>Completed</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: '#38BDF8', marginTop: 2 }}>{counts.done}</div>
            </div>
          </div>

          {nonRoomBots.length > 0 && (
            <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input
                className="text-input"
                placeholder="Assign a new task to an Operator…"
                value={newTitle}
                maxLength={200}
                onChange={(e) => setNewTitle(e.target.value)}
                aria-label="New task title"
                style={{ flex: 1 }}
              />
              {nonRoomBots.length > 1 && (
                <select
                  className="text-input"
                  value={effectiveBotId}
                  onChange={(e) => setTargetBotId(e.target.value)}
                  aria-label="Assign task to Operator"
                  style={{ width: 'auto', minWidth: 130 }}
                >
                  {nonRoomBots.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              )}
              <button type="submit" className="cfg-btn cfg-btn--primary" disabled={!newTitle.trim() || adding}>
                <Icon name="plus" size={12} /> Add Task
              </button>
            </form>
          )}
          {tasks === null ? <div className="cfg-empty">Loading…</div> : shown.length === 0 ? (
            <div className="tasks-empty">
              <Glyph name="tasks" size={28} opacity={0.35} />
              <div className="tasks-empty__title">{filter === 'done' ? 'Nothing finished yet' : 'No active tasks'}</div>
              <div className="tasks-empty__sub">Assign a multi-part goal to an Operator or add a task above—then click "Run ↗" to dispatch it autonomously.</div>
            </div>
          ) : (
            <div className="task-list" role="list">{shown.map((t) => <TaskRow key={t.id} t={t} bot={byId.get(t.botId)} showBot />)}</div>
          )}
        </div>
      </div>
    </main>
  );
}

/** Sidebar entry for the Tasks view, with a count of tasks waiting on the user. */
export function TasksIsland() {
  const view = useConfigUI((s) => s.view);
  const tasks = useTasks();
  const waiting = tasks?.filter((t) => t.state === 'needs_input').length ?? 0;
  return (
    <button type="button" className={`sidebar-island${view === 'tasks' ? ' is-active' : ''}`} onClick={() => useConfigUI.getState().setView(view === 'tasks' ? 'chat' : 'tasks')} title="Tasks" aria-pressed={view === 'tasks'}>
      <span className="sidebar-island__icon"><Glyph name="tasks" size={18} /></span>
      <span className="sidebar-island__label">Tasks</span>
      {waiting > 0 && <span className="sidebar-island__count" aria-label={`${waiting} waiting on you`}>{waiting}</span>}
    </button>
  );
}

/** Tasks for one bot (details panel → Tasks tab). */
export function BotTasks({ bot }: { bot: Bot }) {
  const tasks = useTasks(bot.id);
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const sorted = useMemo(() => sortTasks(tasks ?? []), [tasks]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title || adding) return;
    setAdding(true);
    try {
      await configApi.createTask(bot.id, { title });
      setNewTitle('');
      refreshTaskViews(bot.id);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="details__sections">
      <section>
        <div className="section-label section-label--row">
          <span>Tasks</span>
          <button type="button" className="link-btn link-btn--small" onClick={() => useConfigUI.getState().setView('tasks')}>See all</button>
        </div>
        <form onSubmit={add} style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input
            className="text-input"
            placeholder={`Add task for ${bot.name}…`}
            value={newTitle}
            maxLength={200}
            onChange={(e) => setNewTitle(e.target.value)}
            aria-label={`Add task for ${bot.name}`}
            style={{ flex: 1, height: 32, fontSize: 12.5 }}
          />
          <button type="submit" className="cfg-btn cfg-btn--secondary" disabled={!newTitle.trim() || adding} style={{ height: 32, padding: '0 10px' }}>
            <Icon name="plus" size={12} />
          </button>
        </form>
        {tasks === null ? <div className="panel-card"><div className="panel-empty">Loading…</div></div> : sorted.length === 0 ? (
          <div className="panel-card"><div className="panel-empty">No tasks yet. Ask {bot.name} for a few things at once and they’ll be tracked here.</div></div>
        ) : (
          <div className="panel-card task-list task-list--compact" role="list">{sorted.map((t) => <TaskRow key={t.id} t={t} bot={bot} showBot={false} />)}</div>
        )}
      </section>
    </div>
  );
}
