/** Focusable controls inside a modal dialog (excludes disabled controls and hidden inputs). */
export const MODAL_FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const MODAL_AUTOFOCUS_SELECTOR = '[autofocus]:not([disabled]):not([type="hidden"])';

export function initialModalControlSelector(mobile: boolean): string {
  return mobile
    ? 'button:not([disabled])'
    : 'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), button:not([disabled])';
}

/** Return true only when Escape should dismiss the dialog (not during IME composition or after an inner control handled it). */
export function shouldDismissOnEscape(e: {
  key: string;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}): boolean {
  return e.key === 'Escape' && !e.defaultPrevented && !e.isComposing && e.keyCode !== 229;
}

/**
 * Decide which element to focus when Tab / Shift+Tab is pressed inside a modal.
 * Returns null when native browser Tab traversal inside the dialog should proceed.
 */
export function nextModalTabTarget<T>(
  dialog: T,
  focusables: readonly T[],
  active: T | null,
  shiftKey: boolean,
  containsActive: boolean,
): T | null {
  if (!focusables.length) return dialog;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (!containsActive) return shiftKey ? last : first;
  if (shiftKey && (active === first || active === dialog)) return last;
  if (!shiftKey && active === last) return first;
  return null;
}

/** Pick the initial element to focus when a modal opens, falling back to the dialog container itself. */
export function pickInitialModalFocus<T>(
  dialog: T,
  autofocused: readonly T[],
  preferred: readonly T[],
  focusables: readonly T[],
): T {
  return autofocused[0] ?? preferred[0] ?? focusables[0] ?? dialog;
}

/** Safely compute vertical swipe distance on touchend without throwing on empty changedTouches. */
export function sheetSwipeDeltaY(
  changedTouches: ArrayLike<{ clientY: number }> | undefined,
  startY: number | null,
): number | null {
  if (startY === null || !changedTouches || changedTouches.length === 0) return null;
  const touch = changedTouches[0];
  if (!touch || !Number.isFinite(touch.clientY)) return null;
  return touch.clientY - startY;
}
