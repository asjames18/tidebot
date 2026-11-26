// Focus-return for the conversation details panel.
//
// The Details toggle in ChatView only carries
// aria-controls="conversation-details" while the panel is open, so the
// toggle must be captured BEFORE closing the panel. Querying for it
// afterwards depends on React still batching the store update, and
// silently drops focus when the update flushes first (the button's
// aria-controls is already gone by then).
export function closeDetailsAndReturnFocus(
  close: () => void,
  findToggle: () => { focus(): void } | null | undefined,
): void {
  const toggle = findToggle();
  close();
  toggle?.focus();
}
