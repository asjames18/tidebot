export type ShellShortcutAction =
  | 'close-mobile-drawers'
  | 'toggle-create'
  | 'toggle-search'
  | 'toggle-sidebar'
  | 'toggle-details'
  | 'open-settings';

export interface EditableTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

export interface ShortcutKeyLike {
  key: string;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  target?: EditableTargetLike | EventTarget | null;
}

export interface ShellShortcutContext {
  isMobile: boolean;
  hasModal: boolean;
  viewerOpen: boolean;
  hasConfigModal: boolean;
  mobileSidebarOpen: boolean;
  detailsOpen: boolean;
}

export interface EdgeTouch {
  x: number;
  y: number;
  side: 'left' | 'right';
}

export function isEditableTarget(target: EditableTargetLike | EventTarget | null | undefined): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as EditableTargetLike;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  if (typeof el.closest === 'function') {
    return Boolean(el.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
  }
  return false;
}

/**
 * Resolves global TideBot studio keyboard shortcuts while respecting IME composition,
 * `defaultPrevented`, remote desktop viewer focus, AltGr chords, and editable inputs.
 */
export function resolveShellShortcut(
  e: ShortcutKeyLike,
  ctx: ShellShortcutContext,
): ShellShortcutAction | null {
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return null;
  const key = e.key.toLowerCase();

  if (key === 'escape') {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
    if (ctx.isMobile && !ctx.hasModal && !ctx.viewerOpen && !ctx.hasConfigModal && (ctx.mobileSidebarOpen || ctx.detailsOpen)) {
      return 'close-mobile-drawers';
    }
    return null;
  }

  // When the fullscreen computer viewer is open, keep hotkeys from popping modals behind it.
  if (ctx.viewerOpen) return null;

  if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && key === 'n') {
    if (isEditableTarget(e.target)) return null;
    return 'toggle-create';
  }

  const mod = Boolean(e.metaKey || e.ctrlKey);
  // Reject AltGr (Ctrl+Alt on Windows/Linux) and Cmd+Option chords.
  if (!mod || e.altKey) return null;

  if (key === 'k' && !e.shiftKey) return 'toggle-search';
  if (key === 'b' && !e.shiftKey) return 'toggle-sidebar';
  if (e.shiftKey && key === 'o') return 'toggle-create';
  if (e.shiftKey && (key === ',' || key === '<')) return 'toggle-details';
  if (key === ',' && !e.shiftKey) return 'open-settings';
  return null;
}

export function detectEdgeSwipeStart(
  clientX: number,
  clientY: number,
  viewportWidth: number,
  canOpenRight: boolean,
): EdgeTouch | null {
  if (clientX <= 28) return { x: clientX, y: clientY, side: 'left' };
  if (clientX >= viewportWidth - 28 && canOpenRight) return { x: clientX, y: clientY, side: 'right' };
  return null;
}

export function resolveEdgeSwipeEnd(
  start: EdgeTouch,
  endX: number,
  endY: number,
): 'open-sidebar' | 'open-details' | null {
  const dx = endX - start.x;
  const dy = endY - start.y;
  if (Math.abs(dx) < 52 || Math.abs(dx) < Math.abs(dy) * 1.4) return null;
  if (start.side === 'left' && dx > 52) return 'open-sidebar';
  if (start.side === 'right' && dx < -52) return 'open-details';
  return null;
}

export function shouldCloseScrimSwipe(
  start: { x: number; y: number },
  endX: number,
  endY: number,
  mobileSidebarOpen: boolean,
  detailsOpen: boolean,
): boolean {
  const dx = endX - start.x;
  const dy = endY - start.y;
  if (Math.abs(dx) < 36 || Math.abs(dx) < Math.abs(dy) * 1.2) return false;
  return (mobileSidebarOpen && dx < -36) || (detailsOpen && dx > 36);
}
