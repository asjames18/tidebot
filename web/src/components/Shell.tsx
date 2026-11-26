import { lazy, Suspense, useEffect, useRef } from 'react';
import { startEvents } from '../lib/events';
import { useStore } from '../store';
import { ChatView } from './ChatView';
import { Sidebar } from './Sidebar';
import { Toasts } from './Toasts';
import { ReleaseNotice } from './ReleaseNotice';
import { useConfigUI } from '../configStore';
import { configApi } from '../lib/configApi';

const ConnectAppsModal = lazy(() => import('./modals/ConnectAppsModal').then((m) => ({ default: m.ConnectAppsModal })));
const CreateBotModal = lazy(() => import('./modals/CreateBotModal').then((m) => ({ default: m.CreateBotModal })));
const CreateGroupModal = lazy(() => import('./modals/CreateGroupModal').then((m) => ({ default: m.CreateGroupModal })));
const SearchModal = lazy(() => import('./modals/SearchModal').then((m) => ({ default: m.SearchModal })));
const ConfigLayer = lazy(() => import('./config/ConfigLayer').then((m) => ({ default: m.ConfigLayer })));
const TasksView = lazy(() => import('./config/TasksView').then((m) => ({ default: m.TasksView })));
const ComputerViewer = lazy(() => import('./ComputerViewer').then((m) => ({ default: m.ComputerViewer })));
const DetailsPanel = lazy(() => import('./DetailsPanel').then((m) => ({ default: m.DetailsPanel })));

export function Shell() {
  const detailsOpen = useStore((s) => s.detailsOpen);
  const mobileSidebarOpen = useStore((s) => s.mobileSidebarOpen);
  const set = useStore((s) => s.set);
  const modal = useStore((s) => s.modal);
  const viewerOpen = useStore((s) => s.viewerOpen);
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const hasBot = useStore((s) => !!s.selectedBotId);
  const view = useConfigUI((s) => s.view);
  const edgeTouch = useRef<{ x: number; y: number; side: 'left' | 'right' } | null>(null);
  const scrimTouch = useRef<{ x: number; y: number } | null>(null);

  // Switching views (e.g. to Tasks from the sidebar drawer) closes the mobile drawer.
  useEffect(() => { set({ mobileSidebarOpen: false }); }, [view, set]);

  // Mobile edge-swipe to open the left Operators drawer (from left edge) or right Details drawer (from right edge).
  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      if (window.innerWidth > 900) return;
      if (e.touches.length !== 1) { edgeTouch.current = null; return; }
      const st = useStore.getState();
      const cfg = useConfigUI.getState();
      if (st.mobileSidebarOpen || st.detailsOpen || st.modal || st.viewerOpen || cfg.botSettings || cfg.appSettings) return;
      const t = e.touches[0];
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], .md-table, pre, .composer-quick-bar, .composer-telemetry, .toast--item, .empty-quick-prompts, .tasks-filters, .vcall, .menu, .slash-palette')) return;
      if (t.clientX <= 28) {
        edgeTouch.current = { x: t.clientX, y: t.clientY, side: 'left' };
      } else if (t.clientX >= window.innerWidth - 28 && st.selectedBotId && cfg.view === 'chat') {
        edgeTouch.current = { x: t.clientX, y: t.clientY, side: 'right' };
      } else {
        edgeTouch.current = null;
      }
    };
    const onEnd = (e: TouchEvent) => {
      const start = edgeTouch.current;
      edgeTouch.current = null;
      if (!start || !e.changedTouches.length) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Math.abs(dx) < 52 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      const ae = document.activeElement;
      if (ae instanceof HTMLElement && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) ae.blur();
      if (start.side === 'left' && dx > 52) {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
        useStore.getState().set({ mobileSidebarOpen: true, sidebarCollapsed: false });
      } else if (start.side === 'right' && dx < -52) {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
        useStore.getState().set({ detailsOpen: true });
      }
    };
    const onCancel = () => { edgeTouch.current = null; };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onCancel);
    };
  }, []);

  useEffect(() => {
    const st = useStore.getState();
    // On small screens the details panel is an overlay drawer; never start with it open.
    if (window.innerWidth <= 900 && st.detailsOpen) st.set({ detailsOpen: false });
    st.loadBots().catch(() => st.notify('Could not load your operators'));
    st.loadComputer().catch(() => {});
    const cfgSt = useConfigUI.getState();
    let active = true;
    const accountId = st.user?.id;
    void cfgSt.loadLlmConfig().then(async () => {
      if (!accountId || !active || useConfigUI.getState().llmConfig?.isConfigured) return;
      const seenKey = `tidebot.setup-seen:${accountId}`;
      try { if (localStorage.getItem(seenKey)) return; } catch { /* storage disabled */ }
      await configApi.personalModel();
      if (!active || useStore.getState().user?.id !== accountId || useConfigUI.getState().appSettings) return;
      try { localStorage.setItem(seenKey, '1'); } catch { /* setup is still available */ }
      useConfigUI.getState().openAppSettings('setup');
    }).catch(() => {});
    cfgSt.loadModels().catch(console.error);
    const stop = startEvents();
    // OAuth popups post back here; refresh connection-dependent views and the open transcript.
    const onMsg = (e: MessageEvent) => {
      if ((e.data as { type?: string })?.type !== 'grokbot-connected') return;
      const s = useStore.getState();
      s.set({ connectionsVersion: s.connectionsVersion + 1 });
      if (s.selectedBotId) s.loadRows(s.selectedBotId).catch(() => {});
    };
    window.addEventListener('message', onMsg);
    return () => { active = false; stop(); window.removeEventListener('message', onMsg); };
  }, []);

  // Global shortcuts: ⌘K search, ⌘B sidebar, ⇧⌘, details, ⌘, settings, ⇧⌘O / Alt+N new bot.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const key = e.key.toLowerCase();
      if (key === 'escape' && !e.defaultPrevented && window.innerWidth <= 900) {
        const cfg = useConfigUI.getState();
        if (!st.modal && !st.viewerOpen && !cfg.botSettings && !cfg.appSettings && (st.mobileSidebarOpen || st.detailsOpen)) {
          e.preventDefault();
          st.set({ mobileSidebarOpen: false, detailsOpen: false });
          return;
        }
      }
      if (e.altKey && !e.metaKey && !e.ctrlKey && key === 'n') {
        e.preventDefault();
        st.setModal(st.modal === 'create' ? null : 'create');
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (key === 'k') { e.preventDefault(); st.setModal(st.modal === 'search' ? null : 'search'); }
      else if (key === 'b') {
        e.preventDefault();
        if (window.innerWidth <= 900) {
          const next = !st.mobileSidebarOpen;
          st.set({ mobileSidebarOpen: next, sidebarCollapsed: false, ...(next ? { detailsOpen: false } : {}) });
        } else {
          st.set({ sidebarCollapsed: !st.sidebarCollapsed });
        }
      }
      else if (e.shiftKey && key === 'o') { e.preventDefault(); st.setModal(st.modal === 'create' ? null : 'create'); }
      else if (e.shiftKey && (key === ',' || key === '<')) { e.preventDefault(); st.set({ detailsOpen: !st.detailsOpen }); }
      else if (key === ',') { e.preventDefault(); useConfigUI.getState().openAppSettings(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  return (
    <div className={`app${collapsed ? ' is-sidebar-collapsed' : ''}${detailsOpen && hasBot && view === 'chat' ? ' has-details' : ''}`}>
      <Sidebar />
      {(mobileSidebarOpen || (detailsOpen && hasBot && view === 'chat')) && (
        <div
          className="mobile-scrim"
          onTouchStart={(e) => {
            if (e.touches.length !== 1) return;
            scrimTouch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          }}
          onTouchEnd={(e) => {
            const start = scrimTouch.current;
            scrimTouch.current = null;
            if (!start || !e.changedTouches.length) return;
            const dx = e.changedTouches[0].clientX - start.x;
            const dy = e.changedTouches[0].clientY - start.y;
            if (Math.abs(dx) < 36 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
            if ((mobileSidebarOpen && dx < -36) || (detailsOpen && dx > 36)) {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
              const ae = document.activeElement;
              if (ae instanceof HTMLElement && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) ae.blur();
              set({ mobileSidebarOpen: false, detailsOpen: false });
            }
          }}
          onTouchCancel={() => { scrimTouch.current = null; }}
          onClick={(e) => {
            e.stopPropagation();
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
            const ae = document.activeElement;
            if (ae instanceof HTMLElement && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) ae.blur();
            set({ mobileSidebarOpen: false, detailsOpen: false });
          }}
          aria-hidden="true"
        />
      )}
      <Toasts />
      <div className="app__main">
        <ReleaseNotice />
        {view === 'tasks' ? <Suspense fallback={null}><TasksView /></Suspense> : <ChatView />}
      </div>
      {detailsOpen && hasBot && view === 'chat' && <Suspense fallback={null}><DetailsPanel /></Suspense>}
      <Suspense fallback={null}>
        {modal === 'create' && <CreateBotModal />}
        {modal === 'group' && <CreateGroupModal />}
        {modal === 'search' && <SearchModal />}
        {modal === 'apps' && <ConnectAppsModal />}
        {viewerOpen && <ComputerViewer />}
        <ConfigLayer />
      </Suspense>
    </div>
  );
}
