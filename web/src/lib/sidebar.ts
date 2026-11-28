import type { Bot } from '@shared/types';

export const DRAWER_LOCK_SLOP_PX = 10;
export const DRAWER_CLOSE_THRESHOLD_PX = -56;

export interface DrawerSwipeState {
  readonly active: boolean;
  readonly startX: number;
  readonly startY: number;
  readonly locked: 'x' | 'y' | null;
  readonly dragX: number;
}

export const IDLE_DRAWER_SWIPE: DrawerSwipeState = {
  active: false,
  startX: 0,
  startY: 0,
  locked: null,
  dragX: 0,
};

function firstCodePoint(s: string): string {
  return Array.from(s)[0] ?? '';
}

/** Code-point-safe user initials (preserves emoji/astral characters without splitting UTF-16 surrogates). */
export function userInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = firstCodePoint(parts[0]);
  const last = parts.length > 1 ? firstCodePoint(parts[parts.length - 1]) : '';
  return (first + last).toUpperCase() || '?';
}

export function accountDisplayName(
  user: { name?: string | null; email?: string | null } | null | undefined,
): string {
  return user?.name?.trim() || user?.email?.trim() || '';
}

export function sidebarPreviewText(
  bot: Pick<Bot, 'lastPreview'>,
  running: boolean,
  awaiting: string | null,
): string {
  const awaitingText = awaiting?.trim();
  if (awaitingText) return `Waiting for you: ${awaitingText}`;
  const previewText = bot.lastPreview?.trim();
  if (running && !previewText) return 'Working…';
  return previewText || 'No messages yet';
}

export function partitionSidebarBots<T extends Pick<Bot, 'isPrimary' | 'lastActivityAt'>>(
  bots: readonly T[],
): { primary: T | undefined; others: T[] } {
  const primary = bots.find((b) => b.isPrimary);
  const score = (b: T) => (Number.isFinite(b.lastActivityAt) ? b.lastActivityAt : 0);
  const others = bots.filter((b) => !b.isPrimary).sort((a, b) => score(b) - score(a));
  return { primary, others };
}

export function startDrawerSwipe(x: number, y: number): DrawerSwipeState {
  return { active: true, startX: x, startY: y, locked: null, dragX: 0 };
}

export function moveDrawerSwipe(
  state: DrawerSwipeState,
  x: number,
  y: number,
): { next: DrawerSwipeState; lockedHorizontalNow: boolean } {
  if (!state.active) return { next: state, lockedHorizontalNow: false };
  const dx = x - state.startX;
  const dy = y - state.startY;
  let locked = state.locked;
  let lockedHorizontalNow = false;
  if (!locked) {
    if (Math.abs(dx) < DRAWER_LOCK_SLOP_PX && Math.abs(dy) < DRAWER_LOCK_SLOP_PX) {
      return { next: state, lockedHorizontalNow: false };
    }
    locked = Math.abs(dx) > Math.abs(dy) * 1.2 && dx < 0 ? 'x' : 'y';
    lockedHorizontalNow = locked === 'x';
  }
  const dragX = locked === 'x' ? Math.min(0, dx) : 0;
  return {
    next: { ...state, locked, dragX },
    lockedHorizontalNow,
  };
}

export function endDrawerSwipe(
  state: DrawerSwipeState,
  endClientX?: number,
): { shouldClose: boolean; next: DrawerSwipeState } {
  if (!state.active) return { shouldClose: false, next: IDLE_DRAWER_SWIPE };
  const deltaX = endClientX !== undefined && Number.isFinite(endClientX)
    ? endClientX - state.startX
    : state.dragX;
  return {
    shouldClose: state.locked === 'x' && deltaX < DRAWER_CLOSE_THRESHOLD_PX,
    next: IDLE_DRAWER_SWIPE,
  };
}
