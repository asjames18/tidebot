/** Copies text to the clipboard, falling back to an offscreen textarea on non-HTTPS mobile LAN origins. */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback.
    }
  }
  let ta: HTMLTextAreaElement | undefined;
  let prior: HTMLElement | null = null;
  try {
    prior = document.activeElement as HTMLElement | null;
    ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '-9999px';
    ta.style.fontSize = '16px';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    const restore = ta && document.activeElement === ta;
    ta?.remove();
    if (restore && prior?.isConnected) prior.focus?.({ preventScroll: true });
  }
}
