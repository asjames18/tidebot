import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useConfigUI } from '../configStore';
import { TasksIsland } from './config/TasksView';
import type { Bot } from '@shared/types';
import { BotAvatarFor } from '../avatar/BotAvatar';
import { displayName, useStore } from '../store';
import { api } from '../lib/api';
import { hasNativeDesktopWindow } from '../lib/desktop';
import {
  accountDisplayName,
  endDrawerSwipe,
  IDLE_DRAWER_SWIPE,
  moveDrawerSwipe,
  partitionSidebarBots,
  sidebarPreviewText,
  startDrawerSwipe,
  userInitials,
  type DrawerSwipeState,
} from '../lib/sidebar';
import { Icon } from './Icon';
import { Menu } from './Menu';

export function TrafficLights() {
  if (hasNativeDesktopWindow()) return null;
  return (
    <div className="traffic-lights" aria-hidden>
      <span style={{ background: '#FF5F57' }} />
      <span style={{ background: '#FEBC2E' }} />
      <span style={{ background: '#28C840' }} />
    </div>
  );
}

const BotRow = memo(function BotRow({ bot, selected, running, awaiting, pending, onSelect }: { bot: Bot; selected: boolean; running: boolean; awaiting: string | null; pending: number; onSelect: (id: string) => void }) {
  return (
    <button type="button" className={`bot-row${selected ? ' is-selected' : ''}`} onClick={() => onSelect(bot.id)} aria-current={selected || undefined}>
      <span className="bot-row__avatar">
        <BotAvatarFor bot={bot} size={36} />
        {(running || awaiting || bot.unread > 0) && (
          <span className={`status-dot ${awaiting ? 'is-attention' : running ? 'is-working' : 'is-unread'}`} aria-label={awaiting ? 'Needs attention' : running ? 'Working' : 'Unread activity'} />
        )}
      </span>
      <span className="bot-row__text">
        <span className="bot-row__name">{displayName(bot)}</span>
        <span className="bot-row__preview">{sidebarPreviewText(bot, running, awaiting)}</span>
      </span>
      {pending > 0 && (
        <span className="bot-row__approval-badge" aria-label={`${pending} approval${pending === 1 ? '' : 's'} waiting`}>{pending}</span>
      )}
    </button>
  );
});

export function Sidebar() {
  const bots = useStore((s) => s.bots);
  const live = useStore((s) => s.live);
  const pendingApprovals = useStore((s) => s.pendingApprovals);
  const storeSelectedBotId = useStore((s) => s.selectedBotId);
  const inTasks = useConfigUI((s) => s.view === 'tasks');
  const selectedBotId = inTasks ? null : storeSelectedBotId; // nothing highlighted while the Tasks view is open
  const user = useStore((s) => s.user);
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const mobileOpen = useStore((s) => s.mobileSidebarOpen);
  const set = useStore((s) => s.set);
  const storeSelectBot = useStore((s) => s.selectBot);
  const selectBot = useCallback((id: string) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(8); } catch {}
    }
    useConfigUI.getState().setView('chat');
    storeSelectBot(id);
    set({ mobileSidebarOpen: false });
  }, [storeSelectBot, set]);
  const setModal = useStore((s) => s.setModal);
  const [accountMenu, setAccountMenu] = useState(false);
  const logout = async () => { await api.logout().catch(() => {}); location.reload(); };

  const { primary, others } = partitionSidebarBots(bots);

  const swipeRef = useRef<DrawerSwipeState>(IDLE_DRAWER_SWIPE);
  const sidebarRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);

  useLayoutEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    // Match the breakpoint that turns the sidebar into a drawer in mobile.css.
    const mobile = window.matchMedia('(max-width: 900px)');
    const syncDrawer = () => { sidebar.inert = mobile.matches && !mobileOpen; };
    syncDrawer();
    mobile.addEventListener('change', syncDrawer);
    return () => mobile.removeEventListener('change', syncDrawer);
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) {
      swipeRef.current = IDLE_DRAWER_SWIPE;
      setAccountMenu(false);
      setDragging(false);
      setDragX(0);
      return;
    }
    const selectedEl = scrollRef.current?.querySelector<HTMLElement>('.bot-row.is-selected, .pinned__tile.is-selected');
    selectedEl?.scrollIntoView({ block: 'nearest' });
  }, [mobileOpen]);

  const resetSwipe = () => {
    swipeRef.current = IDLE_DRAWER_SWIPE;
    setDragging(false);
    setDragX(0);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (!mobileOpen || e.touches.length !== 1 || !e.touches[0]) return;
    swipeRef.current = startDrawerSwipe(e.touches[0].clientX, e.touches[0].clientY);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!mobileOpen || !swipeRef.current.active) return;
    if (e.touches.length !== 1 || !e.touches[0]) {
      resetSwipe();
      return;
    }
    const { next, lockedHorizontalNow } = moveDrawerSwipe(swipeRef.current, e.touches[0].clientX, e.touches[0].clientY);
    swipeRef.current = next;
    if (lockedHorizontalNow) {
      setAccountMenu(false);
      setDragging(true);
    }
    if (next.locked === 'x') {
      setDragX(next.dragX);
    }
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!swipeRef.current.active) return;
    const endX = e.changedTouches[0]?.clientX;
    const { shouldClose, next } = endDrawerSwipe(swipeRef.current, endX);
    swipeRef.current = next;
    setDragging(false);
    setDragX(0);
    if (shouldClose && mobileOpen) {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try { navigator.vibrate(10); } catch {}
      }
      set({ mobileSidebarOpen: false });
    }
  };
  const onTouchCancel = () => {
    resetSwipe();
  };

  return (
    <aside
      ref={sidebarRef}
      className={`sidebar${collapsed ? ' is-collapsed' : ''}${mobileOpen ? ' is-mobile-open' : ''}`}
      aria-label="Operators navigation"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      style={dragX < 0 ? { transform: `translateX(${dragX}px)`, transition: dragging ? 'none' : undefined } : undefined}
    >
      <div className="sidebar__titlebar">
        <div className={`sidebar__brand${hasNativeDesktopWindow() ? ' sidebar__brand--native' : ''}`}>
          <TrafficLights />
          {!collapsed && <span className="sidebar__brand-mark">TIDE<span>BOT</span></span>}
        </div>
        <div className="sidebar__controls">
          <button type="button" className="icon-btn icon-btn--plain mobile-hide" onClick={() => set({ sidebarCollapsed: !collapsed })} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title="Toggle sidebar (⌘B)">
            <Icon name="sidebar" opacity={0.66} />
          </button>
          {!collapsed && (
            <>
              <button
                type="button"
                className="icon-btn"
                onClick={() => {
                  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                  set({ mobileSidebarOpen: false });
                  setModal('search');
                }}
                aria-label="Search"
                title="Search (⌘K)"
              >
                <Icon name="search" opacity={0.66} />
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => {
                  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                  set({ mobileSidebarOpen: false });
                  setModal('create');
                }}
                aria-label="New Bot"
                title="New Bot"
              >
                <Icon name="plus" opacity={0.66} />
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--plain mobile-only-btn"
                onClick={() => {
                  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                  set({ mobileSidebarOpen: false });
                }}
                aria-label="Close drawer"
              >
                <Icon name="close" size={14} opacity={0.75} />
              </button>
            </>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="sidebar__scroll">
        <TasksIsland />
        {primary && (
          <div className="pinned">
            <button
              type="button"
              className={`pinned__tile${selectedBotId === primary.id ? ' is-selected' : ''}`}
              onClick={() => selectBot(primary.id)}
              aria-current={selectedBotId === primary.id || undefined}
              aria-label={collapsed ? displayName(primary) : undefined}
              title={displayName(primary)}
            >
              <span className="pinned__avatar">
                <BotAvatarFor bot={primary} size={collapsed ? 44 : 60} star />
                {(live[primary.id]?.awaiting || live[primary.id]?.isRunning || primary.unread > 0) && (
                  <span
                    className={`status-dot pinned__dot ${live[primary.id]?.awaiting ? 'is-attention' : live[primary.id]?.isRunning ? 'is-working' : 'is-unread'}`}
                    aria-label={live[primary.id]?.awaiting ? 'Needs attention' : live[primary.id]?.isRunning ? 'Working' : 'Unread activity'}
                  />
                )}
              </span>
              {!collapsed && <span className="pinned__label">{displayName(primary)}</span>}
              {!collapsed && (pendingApprovals[primary.id] ?? 0) > 0 && (
                <span className="pinned__approval-badge" aria-label={`${pendingApprovals[primary.id]} approval${pendingApprovals[primary.id] === 1 ? '' : 's'} waiting`}>{pendingApprovals[primary.id]}</span>
              )}
            </button>
          </div>
        )}
        <div className="bot-list">
          {others.map((b) =>
            collapsed ? (
              <button
                key={b.id}
                type="button"
                className={`bot-rail-item${selectedBotId === b.id ? ' is-selected' : ''}`}
                onClick={() => selectBot(b.id)}
                aria-current={selectedBotId === b.id || undefined}
                aria-label={displayName(b)}
                title={displayName(b)}
              >
                <BotAvatarFor bot={b} size={36} />
              </button>
            ) : (
              <BotRow key={b.id} bot={b} selected={selectedBotId === b.id} running={!!live[b.id]?.isRunning} awaiting={live[b.id]?.awaiting?.reason ?? null} pending={pendingApprovals[b.id] ?? 0} onSelect={selectBot} />
            ),
          )}
          {!collapsed && others.length === 0 && (
            <button
              type="button"
              className="bot-list__empty"
              onClick={() => {
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                set({ mobileSidebarOpen: false });
                setModal('create');
              }}
            >
              <span className="bot-list__empty-plus"><Icon name="plus" size={14} opacity={0.66} /></span>
              <span>
                <span className="bot-row__name">Create a Bot</span>
                <span className="bot-row__preview">Give it a job, like research or inbox triage</span>
              </span>
            </button>
          )}
        </div>
      </div>

      <div className="sidebar__footer">
        <div className="sidebar__fade" />
        <div className="sidebar__footer-row">
          {!collapsed && (
            <div className="account">
              <button
                type="button"
                className="account__btn"
                onClick={() => {
                  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
                  setAccountMenu(!accountMenu);
                }}
                aria-haspopup="menu"
                aria-expanded={accountMenu}
                title={user?.email}
              >
                <span className="account__initials">{userInitials(accountDisplayName(user))}</span>
                <span className="account__name">{accountDisplayName(user)}</span>
              </button>
              {accountMenu && (
                <Menu
                  placement="above"
                  onClose={() => setAccountMenu(false)}
                  items={[
                    { label: 'Models & OpenRouter (BYOM)', onSelect: () => { set({ mobileSidebarOpen: false }); useConfigUI.getState().openAppSettings('models'); } },
                    { label: 'Settings', hint: '⌘,', onSelect: () => { set({ mobileSidebarOpen: false }); useConfigUI.getState().openAppSettings(); } },
                    { label: 'Connect apps', onSelect: () => { set({ mobileSidebarOpen: false }); setModal('apps'); } },
                    { label: 'Log out', danger: true, onSelect: logout },
                  ]}
                >
                  <div className="menu__header">{user?.email}</div>
                </Menu>
              )}
            </div>
          )}
          <button
            type="button"
            className="icon-btn icon-btn--bordered"
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(8); } catch {} }
              set({ mobileSidebarOpen: false });
              setModal('apps');
            }}
            aria-label="Connect apps"
            title="Connect apps"
          >
            <Icon name="apps" />
          </button>
        </div>
      </div>
    </aside>
  );
}
