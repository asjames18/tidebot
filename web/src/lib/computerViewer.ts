import type { ComputerState } from '@shared/types';

export type ViewerMode = 'watch' | 'control';

export const TOP_SWIPE_SLOP_PX = 6;
export const TOP_SWIPE_CLOSE_PX = 64;

export interface TopSwipeState {
  readonly active: boolean;
  readonly startX: number;
  readonly startY: number;
  readonly dragY: number;
}

export const IDLE_TOP_SWIPE: TopSwipeState = {
  active: false,
  startX: 0,
  startY: 0,
  dragY: 0,
};

export interface ViewerKeyLike {
  key: string;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

export function startTopSwipe(x: number, y: number): TopSwipeState {
  return { active: true, startX: x, startY: y, dragY: 0 };
}

export function moveTopSwipe(state: TopSwipeState, x: number, y: number): TopSwipeState {
  if (!state.active) return state;
  const dx = Math.abs(x - state.startX);
  const dy = y - state.startY;
  if (dx > Math.abs(dy) && state.dragY === 0) return IDLE_TOP_SWIPE;
  const dragY = dy > TOP_SWIPE_SLOP_PX ? dy : 0;
  if (dragY === state.dragY) return state;
  return { ...state, dragY };
}

export function endTopSwipe(state: TopSwipeState): { shouldClose: boolean; next: TopSwipeState } {
  return {
    shouldClose: state.active && state.dragY > TOP_SWIPE_CLOSE_PX,
    next: IDLE_TOP_SWIPE,
  };
}

export function buildScreenSocketUrl(
  protocol: string,
  host: string,
  botId: string,
  mode: ViewerMode,
): string {
  const proto = protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${host}/api/bots/${encodeURIComponent(botId)}/screen?mode=${mode}`;
}

export function shouldCloseViewerOnKey(e: ViewerKeyLike, mode: ViewerMode): boolean {
  if (mode !== 'watch') return false;
  if (e.key !== 'Escape') return false;
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return false;
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
  return true;
}

export function shouldClearWaking(
  computer: Pick<ComputerState, 'status' | 'error'> | null | undefined,
): boolean {
  if (!computer) return false;
  return (
    computer.status === 'running' ||
    computer.status === 'starting' ||
    computer.status === 'resuming' ||
    computer.status === 'creating' ||
    computer.status === 'error' ||
    Boolean(computer.error)
  );
}
