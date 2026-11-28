/**
 * Per-bot composer draft store that keeps drafts isolated across bot switches
 * and async send / enhance completions.
 */
export class DraftStore {
  private map = new Map<string, string>();

  get(botId: string): string {
    return this.map.get(botId) ?? '';
  }

  set(botId: string, text: string): void {
    if (text) this.map.set(botId, text);
    else this.map.delete(botId);
  }

  clear(botId: string): void {
    this.map.delete(botId);
  }

  /**
   * Apply the result of an async send completion for `targetBotId`.
   * Clears `targetBotId`'s stored draft only if it still matches what was sent
   * (so newer edits made after switching away and back are preserved).
   * Returns true when `activeBotId` is still `targetBotId` and the visible
   * composer should be cleared.
   */
  completeSend(targetBotId: string, activeBotId: string, sentTrimmed: string): boolean {
    const unchanged = this.get(targetBotId).trim() === sentTrimmed;
    if (unchanged) this.map.delete(targetBotId);
    return unchanged && targetBotId === activeBotId;
  }

  /**
   * Apply the result of an async prompt enhancement for `targetBotId`.
   * Only writes `enhanced` if the user has not edited `targetBotId`'s draft
   * since enhancement began. Returns true when `activeBotId` is still
   * `targetBotId` so the visible composer should update immediately.
   */
  completeEnhance(targetBotId: string, activeBotId: string, originalRaw: string, enhanced: string): boolean {
    if (this.get(targetBotId).trim() !== originalRaw) return false;
    this.set(targetBotId, enhanced);
    return targetBotId === activeBotId;
  }
}

/** Insert dictated text at [start, end] with smart surrounding spaces, returning new text and caret offset. */
export function insertDictatedText(
  current: string,
  transcript: string,
  start: number,
  end: number,
): { text: string; caret: number } {
  const s = Math.max(0, Math.min(current.length, start));
  const e = Math.max(s, Math.min(current.length, end));
  const before = current.slice(0, s);
  const after = current.slice(e);
  const pre = before && !/\s$/.test(before) ? ' ' : '';
  const post = after && !/^\s/.test(after) ? ' ' : '';
  return {
    text: before + pre + transcript + post + after,
    caret: before.length + pre.length + transcript.length,
  };
}
