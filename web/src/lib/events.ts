import type { ServerEvent } from '@shared/types';
import { useStore } from '../store';
import { api } from './api';

/**
 * One EventSource for the whole app. EventSource retries on its own, but a server restart
 * can leave it CLOSED, so we also reconnect manually with backoff and resync on reconnect.
 */
export function startEvents(): () => void {
  let es: EventSource | null = null;
  let stopped = false;
  let retry = 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resyncOnOpen = false;
  let hiddenAt: number | null = null;

  const resync = () => {
    const st = useStore.getState();
    st.loadBots().catch(() => {});
    st.loadComputer().catch(() => {});
    if (st.selectedBotId) { st.loadRows(st.selectedBotId).catch(() => {}); st.loadRoutines(st.selectedBotId).catch(() => {}); }
  };

  const open = () => {
    if (stopped) return;
    clearTimeout(timer);
    es?.close();
    es = new EventSource('/api/events', { withCredentials: true });
    es.onopen = () => {
      retry = 1000;
      useStore.getState().set({ sseConnected: true });
      if (resyncOnOpen) resync();
      resyncOnOpen = true;
    };
    es.onmessage = (m) => {
      try { useStore.getState().handleEvent(JSON.parse(m.data) as ServerEvent); } catch (e) { console.warn('bad event', e); }
    };
    es.onerror = () => {
      // The studio's initial requests may have failed along with the stream.
      resyncOnOpen = true;
      useStore.getState().set({ sseConnected: false });
      if (es?.readyState === EventSource.CLOSED) {
        es = null;
        clearTimeout(timer);
        timer = setTimeout(open, retry);
        retry = Math.min(retry * 2, 15_000);
      }
    };
  };

  const wake = () => {
    if (stopped) return;
    if (!es || es.readyState !== EventSource.OPEN) {
      retry = 1000;
      open();
    } else if (resyncOnOpen) {
      resync();
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    const awayMs = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = null;
    const st = useStore.getState();
    const openBot = st.selectedBotId ? st.bots.find((b) => b.id === st.selectedBotId) : undefined;
    if (openBot && openBot.unread > 0) api.markRead(openBot.id).catch(() => {});
    if (!es || es.readyState !== EventSource.OPEN || awayMs > 10_000) {
      wake();
    }
  };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', wake);
  open();
  return () => {
    stopped = true;
    useStore.getState().set({ sseConnected: false });
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', wake);
    es?.close();
  };
}
