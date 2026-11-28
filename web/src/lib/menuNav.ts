/** Compute the next focused menuitem index for WAI-ARIA menu keyboard navigation. */
export function nextMenuIndex(current: number, count: number, key: string): number | null {
  if (count <= 0) return null;
  if (key === 'ArrowDown') return current < 0 ? 0 : (current + 1) % count;
  if (key === 'ArrowUp') return current < 0 ? count - 1 : (current - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

export interface FocusableTarget {
  isConnected?: boolean;
  focus?: (options?: { preventScroll?: boolean }) => void;
}

/** Close a popover menu and restore focus to its trigger when still mounted. */
export function closeMenuAndRestoreFocus(
  close: () => void,
  trigger: FocusableTarget | null | undefined,
): void {
  close();
  if (trigger && trigger.isConnected !== false) {
    trigger.focus?.({ preventScroll: true });
  }
}
