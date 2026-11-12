import { useMemo, useState } from 'react';
import { BotAvatarFor } from '../avatar/BotAvatar';
import { api } from '../lib/api';
import { configApi } from '../lib/configApi';
import { botVars } from '../lib/colors';
import { displayName, sortedRows, useSelectedBot, useStore } from '../store';
import { useConfigUI } from '../configStore';
import { Composer } from './Composer';
import { Icon } from './Icon';
import { Menu } from './Menu';
import { Transcript } from './Transcript';
import { VoiceCallBar } from './VoiceCallBar';

export function ChatView() {
  const bot = useSelectedBot();
  const transcript = useStore((s) => (bot ? s.transcripts[bot.id] : undefined));
  const live = useStore((s) => (bot ? s.live[bot.id] : undefined));
  const detailsOpen = useStore((s) => s.detailsOpen);
  const set = useStore((s) => s.set);
  const llmConfig = useConfigUI((s) => s.llmConfig);
  const curatedModels = useConfigUI((s) => s.curatedModels);
  const [menu, setMenu] = useState(false);
  const [modelMenu, setModelMenu] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const rows = useMemo(() => sortedRows(transcript), [transcript]);

  if (!bot) {
    return (
      <main className="chat chat--empty">
        <div className="empty-chat"><div className="empty-chat__sub">No Operator selected.</div></div>
      </main>
    );
  }

  const flash = (t: string) => { setToast(t); setTimeout(() => setToast(null), 2200); };

  const activeModel = bot.model || llmConfig?.defaultModel || 'anthropic/claude-3.7-sonnet';
  const shortModel = activeModel.includes('/') ? activeModel.split('/').pop()! : activeModel;

  const pickBotModel = async (modelId: string) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
    try {
      await configApi.updateBot(bot.id, { model: modelId });
      flash(modelId ? `Switched ${bot.name} to ${modelId}` : `Using default model (${llmConfig?.defaultModel})`);
    } catch (e: any) {
      flash(e?.message ?? 'Could not update model');
    }
  };

  const shareTranscript = async () => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
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

    try {
      await navigator.clipboard.writeText(md);
      flash('Copied conversation as Markdown');
    } catch {
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${bot.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-chat.md`;
      a.click();
      URL.revokeObjectURL(url);
      flash('Downloaded conversation as Markdown');
    }
  };

  return (
    <main className="chat" style={botVars(bot.avatarColor)}>
      <Transcript bot={bot} rows={rows} live={live} loaded={!!transcript?.loaded} />
      <VoiceCallBar />
      <Composer bot={bot} running={!!live?.isRunning} />
      <header className="chat__header">
        <button
          type="button"
          className="icon-btn icon-btn--bordered mobile-nav-btn"
          onClick={() => {
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
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
                setMenu(!menu);
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
                  { label: 'Open computer', onSelect: () => set({ viewerOpen: true }) },
                  { label: 'Copy conversation (.md)', onSelect: () => void shareTranscript() },
                  { label: 'Download full transcript (.md)', onSelect: () => { window.open(api.exportBotUrl(bot.id), '_blank'); } },
                  ...(bot.kind !== 'room' ? [{
                    label: `Clone ${bot.name}`,
                    onSelect: () => {
                      api.cloneBot(bot.id).then(({ bot: cloned }) => {
                        useStore.getState().loadBots().then(() => useStore.getState().selectBot(cloned.id));
                        flash(`Cloned ${bot.name} → ${cloned.name}`);
                      }).catch((e) => flash(e.message));
                    },
                  }] : []),
                  { label: 'New conversation', onSelect: () => api.fresh(bot.id).then(() => flash('Started a new conversation')).catch((e) => flash(e.message)) },
                  { label: 'Operator settings', onSelect: () => useConfigUI.getState().openBotSettings(bot.id) },
                ]}
              />
            )}
          </span>

          <span className="chat__pill-anchor">
            <button
              type="button"
              className={`chat__model-pill${llmConfig?.isConfigured ? ' is-live' : ''}`}
              onClick={() => {
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                setModelMenu(!modelMenu);
              }}
              aria-haspopup="menu"
              aria-expanded={modelMenu}
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
          </span>
        </div>
        <div className="chat__header-right">
          <button
            type="button"
            className="icon-btn icon-btn--bordered mobile-only-btn"
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
              useStore.getState().setModal('search');
            }}
            aria-label="Command palette"
            title="Command palette (⌘K)"
          >
            <Icon name="search" opacity={0.75} />
          </button>
          {!detailsOpen && (
            <button
              type="button"
              className="icon-btn icon-btn--bordered"
              onClick={() => {
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                set({ detailsOpen: true });
              }}
              aria-label="Show details"
              title="Show details"
            >
              <Icon name="sidebar" opacity={0.66} style={{ transform: 'scaleX(-1)' }} />
            </button>
          )}
          <button
            type="button"
            className="share-btn"
            onClick={() => void shareTranscript()}
            title="Export conversation as Markdown"
            aria-label="Share conversation"
          >
            <Icon name="share" size={14} opacity={0.8} />
            <span className="share-btn__label">Share</span>
          </button>
        </div>
      </header>
      {toast && (
        <div
          className="toast"
          role="status"
          onClick={() => {
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(6); } catch {} }
            setToast(null);
          }}
          title="Tap to dismiss"
          style={{ cursor: 'pointer' }}
        >
          {toast}
        </div>
      )}
    </main>
  );
}
