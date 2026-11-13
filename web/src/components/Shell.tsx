import { lazy, Suspense, useEffect } from 'react';
import { startEvents } from '../lib/events';
import { useStore } from '../store';
import { ChatView } from './ChatView';
import { Sidebar } from './Sidebar';
import { Toasts } from './Toasts';
import { useConfigUI } from '../configStore';

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

  // Switching views (e.g. to Tasks from the sidebar drawer) closes the mobile drawer.
  useEffect(() => { set({ mobileSidebarOpen: false }); }, [view, set]);

  useEffect(() => {
    const st = useStore.getState();
    // On small screens the details panel is an overlay drawer; never start with it open.
    if (window.innerWidth <= 900 && st.detailsOpen) st.set({ detailsOpen: false });
    st.loadBots().catch(() => st.notify('Could not load your operators'));
    st.loadComputer().catch(() => {});
    const cfgSt = useConfigUI.getState();
    cfgSt.loadLlmConfig().catch(console.error);
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
    return () => { stop(); window.removeEventListener('message', onMsg); };
  }, []);

  // Global shortcuts: ⌘K search, ⌘B sidebar, ⇧⌘, details, ⌘, settings, ⇧⌘O / Alt+N new bot.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const st = useStore.getState();
      const key = e.key.toLowerCase();
      if (e.altKey && !e.metaKey && !e.ctrlKey && key === 'n') {
        e.preventDefault();
        st.setModal(st.modal === 'create' ? null : 'create');
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (key === 'k') { e.preventDefault(); st.setModal(st.modal === 'search' ? null : 'search'); }
      else if (key === 'b') { e.preventDefault(); st.set({ sidebarCollapsed: !st.sidebarCollapsed }); }
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
      {(mobileSidebarOpen || detailsOpen) && (
        <div
          className="mobile-scrim"
          onClick={() => {
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
            set({ mobileSidebarOpen: false, detailsOpen: false });
          }}
          onTouchStart={() => {
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
            set({ mobileSidebarOpen: false, detailsOpen: false });
          }}
          aria-hidden="true"
        />
      )}
      <Toasts />
      {view === 'tasks' ? <Suspense fallback={null}><TasksView /></Suspense> : <ChatView />}
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
