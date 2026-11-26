import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentRun } from '@shared/types';
import { BotAvatarFor } from '../avatar/BotAvatar';
import { api } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { configApi } from '../lib/configApi';
import { botVars } from '../lib/colors';
import { displayName, sortedRows, useSelectedBot, useStore } from '../store';
import { useConfigUI } from '../configStore';
import { Composer } from './Composer';
import { Icon } from './Icon';
import { Menu } from './Menu';
import { Transcript } from './Transcript';
import { VoiceCallBar } from './VoiceCallBar';

const RUN_STATUS: Record<AgentRun['state'], string> = {
  queued: 'Queued', running: 'Working', waiting: 'Needs your input',
  completed: 'Finished', failed: 'Could not finish', interrupted: 'Interrupted',
};

export function ChatView() {
  const bot = useSelectedBot();
  const transcript = useStore((s) => (bot ? s.transcripts[bot.id] : undefined));
  const live = useStore((s) => (bot ? s.live[bot.id] : undefined));
  const detailsOpen = useStore((s) => s.detailsOpen);
  const set = useStore((s) => s.set);
  const llmConfig = useConfigUI((s) => s.llmConfig);
  const curatedModels = useConfigUI((s) => s.curatedModels);
  const loadModels = useConfigUI((s) => s.loadModels);
  const [menu, setMenu] = useState(false);
  const [modelMenu, setModelMenu] = useState(false);
  const [confirmFresh, setConfirmFresh] = useState(false);
  const [freshBusy, setFreshBusy] = useState(false);
  const [briefingBusy, setBriefingBusy] = useState(false);
  const [modelBusy, setModelBusy] = useState(false);
  const [cloneBusy, setCloneBusy] = useState(false);
  const confirmTimer = useRef<number | null>(null);
  const rows = useMemo(() => sortedRows(transcript), [transcript]);
  const runBotId = bot?.kind === 'room' ? undefined : bot?.id;
  const runVersion = useConfigUI((s) => runBotId ? s.versions[`runs:${runBotId}`] : undefined);
  const [recentRun, setRecentRun] = useState<{ botId: string; run: AgentRun }>();

  useEffect(() => {
    if (!runBotId) return;
    let active = true;
    void configApi.runs(runBotId).then(({ runs }) => {
      if (!active) return;
      const run = runs.find((entry) => entry.state === 'waiting') ?? runs[0];
      setRecentRun(run ? { botId: runBotId, run } : undefined);
    }).catch(() => {});
    return () => { active = false; };
  }, [runBotId, runVersion]);

  useEffect(() => {
    setMenu(false);
    setModelMenu(false);
    setConfirmFresh(false);
    setFreshBusy(false);
    setBriefingBusy(false);
    setModelBusy(false);
    setCloneBusy(false);
    if (confirmTimer.current) { window.clearTimeout(confirmTimer.current); confirmTimer.current = null; }
  }, [bot?.id]);

  useEffect(() => () => {
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
  }, []);

  if (!bot) {
    return (
      <main className="chat chat--empty">
        <div className="empty-chat">
          <div className="empty-chat__sub">No Operator selected.</div>
          <button
            type="button"
            className="btn btn--secondary mobile-only-btn"
            style={{ marginTop: 12 }}
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
              set({ mobileSidebarOpen: true, sidebarCollapsed: false });
            }}
          >
            Open Operators
          </button>
        </div>
      </main>
    );
  }

  const flash = (t: string) => useStore.getState().notify(t);

  const startNewChat = () => {
    if (freshBusy) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
    setMenu(false);
    setModelMenu(false);
    blurComposerOnMobile();
    if (!rows.length) {
      flash(`Already in a fresh chat with ${displayName(bot)}`);
      return;
    }
    if (!confirmFresh) {
      setConfirmFresh(true);
      flash('Tap New chat again to start fresh (memories & skills stay)');
      if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
      confirmTimer.current = window.setTimeout(() => { setConfirmFresh(false); confirmTimer.current = null; }, 3500);
      return;
    }
    if (confirmTimer.current) { window.clearTimeout(confirmTimer.current); confirmTimer.current = null; }
    setConfirmFresh(false);
    setFreshBusy(true);
    api.fresh(bot.id)
      .then(() => {
        set({ detailsOpen: false, detailsTab: 'activity' });
        flash(`Started a new chat with ${displayName(bot)}`);
      })
      .catch((e) => flash(e.message))
      .finally(() => setFreshBusy(false));
  };

  const activeModel = bot.model || llmConfig?.defaultModel || 'anthropic/claude-3.7-sonnet';
  const shortModel = activeModel.includes('/') ? activeModel.split('/').pop()! : activeModel;
  const run = recentRun?.botId === bot.id ? recentRun.run : undefined;
  const runLabel = live?.awaiting ? 'Needs your input' : live?.isRunning ? 'Working' : run && RUN_STATUS[run.state];

  const pickBotModel = async (modelId: string) => {
    if (modelBusy) return;
    if ((bot.model || '') === modelId) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
    setModelBusy(true);
    try {
      const { bot: updated } = await configApi.updateBot(bot.id, { model: modelId });
      useStore.setState((s) => ({ bots: s.bots.map((x) => (x.id === updated.id ? updated : x)) }));
      flash(modelId ? `Switched ${bot.name} to ${modelId}` : `Using default model (${llmConfig?.defaultModel})`);
    } catch (e: any) {
      flash(e?.message ?? 'Could not update model');
    } finally {
      setModelBusy(false);
    }
  };

  const shareTranscript = async () => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
    setMenu(false);
    setModelMenu(false);
    blurComposerOnMobile();
    const msgs = rows.filter((r) => r.body.type === 'message' && !r.body.streaming);
    if (!msgs.length) {
      flash('No messages to export yet');
      return;
    }
    const md = [
      `# Conversation with ${displayName(bot)}`,
      '',
      ...msgs.map((r) => {
        if (r.body.type !== 'message') return '';
        const speaker = r.body.role === 'user' ? (r.body.from?.name ? `${r.body.from.name}` : 'You') : bot.name;
        return `### ${speaker}\n\n${r.body.text}\n`;
      }),
    ].join('\n');

    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({
          title: `Conversation with ${displayName(bot)}`,
          text: md,
        });
        flash('Shared conversation');
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }

    if (await copyText(md)) {
      flash('Copied conversation as Markdown');
      return;
    }
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${bot.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-chat.md`;
    a.click();
    URL.revokeObjectURL(url);
    flash('Downloaded conversation as Markdown');
  };

  const blurComposerOnMobile = () => {
    if (typeof window !== 'undefined' && window.innerWidth <= 900) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.classList.contains('composer__input')) {
        active.blur();
      }
    }
  };

  const requestBriefing = () => {
    if (briefingBusy || live?.isRunning || !llmConfig?.isConfigured) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
    blurComposerOnMobile();
    setBriefingBusy(true);
    api.send(bot.id, 'Give me my daily briefing: 1) open tasks and anything waiting on me, 2) routines coming up in the next 24 hours, 3) anything important from my connected apps (email, calendar, Slack) if available, 4) one suggested focus for today. Keep it tight and spoken-friendly — short sentences, no tables, no code.')
      .catch(() => useStore.getState().notify('Briefing request failed'))
      .finally(() => setBriefingBusy(false));
  };

  return (
    <main className="chat" style={botVars(bot.avatarColor)}>
      <Transcript bot={bot} rows={rows} live={live} loaded={!!transcript?.loaded} />
      <VoiceCallBar />
      {runLabel && <div className="chat__run-status">
        <div className="chat__run-copy" role="status">
          <strong>{runLabel}</strong>
          {run && <span>{run.state === 'completed' && run.summary ? run.summary : run.title}</span>}
        </div>
        {runBotId && <button type="button" className="link-btn" onClick={() => {
          blurComposerOnMobile();
          set({ detailsOpen: true, detailsTab: 'runs' });
        }}>View runs</button>}
      </div>}
      <Composer bot={bot} running={!!live?.isRunning} />
      <header className="chat__header">
        <button
          type="button"
          className="icon-btn icon-btn--bordered mobile-nav-btn"
          onClick={() => {
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
            setMenu(false);
            setModelMenu(false);
            blurComposerOnMobile();
            set({ mobileSidebarOpen: true, sidebarCollapsed: false });
          }}
          aria-label="Open operators list"
        >
          <Icon name="sidebar" opacity={0.8} />
        </button>
        <div className="chat__header-center">
          <span className="chat__pill-anchor">
            <button
              type="button"
              className="chat__pill"
              onClick={() => {
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                blurComposerOnMobile();
                setModelMenu(false);
                setMenu((v) => !v);
              }}
              aria-haspopup="menu"
              aria-expanded={menu}
            >
              <BotAvatarFor bot={bot} size={24} />
              <span className="chat__pill-name">{displayName(bot)}</span>
            </button>
            {menu && (
              <Menu
                align="center"
                onClose={() => setMenu(false)}
                items={[
                  { label: detailsOpen ? 'Hide details' : 'Show details', hint: '⇧⌘,', onSelect: () => set({ detailsOpen: !detailsOpen }) },
                  ...(llmConfig?.isConfigured && !briefingBusy && !live?.isRunning ? [{ label: 'Get a briefing', onSelect: requestBriefing }] : []),
                  { label: 'Search commands', onSelect: () => useStore.getState().setModal('search') },
                  { label: 'Open computer', onSelect: () => set({ viewerOpen: true }) },
                  { label: 'Copy conversation (.md)', onSelect: () => void shareTranscript() },
                  { label: 'Download full transcript (.md)', onSelect: () => { window.open(api.exportBotUrl(bot.id), '_blank'); } },
                  ...(bot.kind !== 'room' ? [{
                    label: cloneBusy ? `Cloning ${bot.name}…` : `Clone ${bot.name}`,
                    onSelect: () => {
                      if (cloneBusy) return;
                      setCloneBusy(true);
                      api.cloneBot(bot.id).then(({ bot: cloned }) => {
                        useStore.getState().loadBots().then(() => useStore.getState().selectBot(cloned.id));
                        flash(`Cloned ${bot.name} → ${cloned.name}`);
                      }).catch((e) => flash(e.message))
                        .finally(() => setCloneBusy(false));
                    },
                  }] : []),
                  {
                    label: freshBusy ? 'Starting new chat…' : 'New conversation',
                    onSelect: () => {
                      if (freshBusy) return;
                      if (confirmTimer.current) { window.clearTimeout(confirmTimer.current); confirmTimer.current = null; }
                      setConfirmFresh(false);
                      if (!rows.length) {
                        flash(`Already in a fresh chat with ${displayName(bot)}`);
                        return;
                      }
                      setFreshBusy(true);
                      api.fresh(bot.id)
                        .then(() => {
                          set({ detailsOpen: false, detailsTab: 'activity' });
                          flash(`Started a new chat with ${displayName(bot)}`);
                        })
                        .catch((e) => flash(e.message))
                        .finally(() => setFreshBusy(false));
                    },
                  },
                  { label: 'Operator settings', onSelect: () => useConfigUI.getState().openBotSettings(bot.id) },
                ]}
              />
            )}
          </span>

          {llmConfig?.isConfigured ? <span className="chat__pill-anchor">
            <button
              type="button"
              className={`chat__model-pill${llmConfig?.isConfigured ? ' is-live' : ''}`}
              onClick={() => {
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                blurComposerOnMobile();
                setMenu(false);
                if (!curatedModels.length) void loadModels();
                setModelMenu((v) => !v);
              }}
              aria-haspopup="menu"
              aria-expanded={modelMenu}
              aria-label={`Model: ${shortModel}`}
              title={`Active Model: ${activeModel} (click to switch)`}
            >
              <span className={`chat__model-dot${llmConfig?.isConfigured ? ' is-ok' : ''}`} />
              <span className="chat__model-name">{shortModel}</span>
              <Icon name="chev_down" size={10} opacity={0.65} />
            </button>
            {modelMenu && (
              <Menu
                align="center"
                onClose={() => setModelMenu(false)}
                items={[
                  {
                    label: `${!bot.model ? '✓ ' : ''}Default (${(llmConfig?.defaultModel ?? 'claude-3.7-sonnet').split('/').pop()})`,
                    hint: (llmConfig?.defaultModel ?? '').includes(':free') ? 'Free Default' : 'Default',
                    onSelect: () => void pickBotModel(''),
                  },
                  ...curatedModels.slice(0, 10).map((m) => ({
                    label: `${bot.model === m.id ? '✓ ' : ''}${m.name}`,
                    hint: m.id.includes(':free') ? '🎁 Free' : m.provider,
                    onSelect: () => void pickBotModel(m.id),
                  })),
                  {
                    label: 'Configure OpenRouter & BYOM…',
                    onSelect: () => useConfigUI.getState().openAppSettings('models'),
                  },
                ]}
              >
                <div className="menu__header">Operator Model ({llmConfig?.provider?.toUpperCase() ?? 'OPENROUTER'})</div>
              </Menu>
            )}
          </span> : rows.length > 0 && <button type="button" className="chat__model-pill" onClick={() => {
            blurComposerOnMobile();
            useConfigUI.getState().openAppSettings('setup');
          }}>Connect a model</button>}
          {llmConfig?.isConfigured && <button
            type="button"
            className="chat__model-pill chat__briefing-btn"
            disabled={briefingBusy || !!live?.isRunning}
            title="Get your briefing: tasks, routines, connected apps, one focus"
            onClick={requestBriefing}
          >
            <Icon name="clock" size={12} opacity={0.7} />
            <span>{briefingBusy ? 'Sending…' : 'Briefing'}</span>
          </button>}
        </div>
        <div className="chat__header-right">
          <button
            type="button"
            className={`new-chat-btn${confirmFresh ? ' is-confirming' : ''}`}
            disabled={freshBusy}
            onClick={startNewChat}
            title={confirmFresh ? 'Tap again to clear this chat and start fresh' : `Start a new chat with ${displayName(bot)}`}
            aria-label={confirmFresh ? 'Confirm new chat' : 'New chat'}
          >
            <Icon name="edit" size={14} opacity={0.85} />
            <span className="new-chat-btn__label">{freshBusy ? 'Starting…' : confirmFresh ? 'Confirm?' : 'New chat'}</span>
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--bordered mobile-only-btn chat__search-btn"
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
              setMenu(false);
              setModelMenu(false);
              blurComposerOnMobile();
              useStore.getState().setModal('search');
            }}
            aria-label="Command palette"
            title="Command palette (⌘K)"
          >
            <Icon name="search" opacity={0.75} />
          </button>
          <button
            type="button"
            className="new-chat-btn chat__details-btn"
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
              setMenu(false);
              setModelMenu(false);
              blurComposerOnMobile();
              set({ detailsOpen: !detailsOpen });
            }}
            aria-label={detailsOpen ? 'Hide details' : 'Show details'}
            aria-expanded={detailsOpen}
            aria-controls={detailsOpen ? 'conversation-details' : undefined}
          >
            <Icon name="sidebar" size={14} opacity={0.8} style={{ transform: 'scaleX(-1)' }} />
            <span className="new-chat-btn__label">Details</span>
          </button>
          <button
            type="button"
            className="share-btn"
            onClick={() => { void shareTranscript(); }}
            title="Export conversation as Markdown"
            aria-label="Share conversation"
          >
            <Icon name="share" size={14} opacity={0.8} />
            <span className="share-btn__label">Share</span>
          </button>
        </div>
      </header>
    </main>
  );
}
