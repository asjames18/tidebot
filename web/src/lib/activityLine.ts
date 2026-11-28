import type { Bot, LiveState } from '@shared/types';

export interface ActivityTiming {
  since: number;
  elapsedMs: number;
  tick: number;
}

export interface ActivityLineState {
  waiting: boolean;
  awaitingReason: string;
  shortModel: string;
  elapsedMs: number;
  tick: number;
}

function finitePositiveTimestamp(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Extracts a clean display name for the active model (falling back from a blank
 * per-bot override to the studio default and ignoring trailing slashes).
 */
export function formatShortModelName(
  botModel?: string | null,
  defaultModel?: string | null,
): string {
  const active = botModel?.trim() || defaultModel?.trim() || '';
  if (!active) return '';
  const segments = active.split('/').map((s) => s.trim()).filter(Boolean);
  return segments.length ? segments[segments.length - 1] : '';
}

export function resolveActivityTiming(
  live: Pick<LiveState, 'startedAt' | 'activity' | 'awaiting'>,
  nowMs: number,
): ActivityTiming {
  const safeNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const startedAt = finitePositiveTimestamp(live.startedAt);
  const activitySince = finitePositiveTimestamp(live.activity?.since);
  const awaitingSince = finitePositiveTimestamp(live.awaiting?.since);
  const since = startedAt ?? activitySince ?? awaitingSince ?? safeNow;
  const phraseSince = activitySince ?? since;
  const elapsedMs = Math.max(0, safeNow - since);
  const tick = Math.max(0, Math.floor((safeNow - phraseSince) / 6000));
  return { since, elapsedMs, tick };
}

export function deriveActivityLineState(
  bot: Pick<Bot, 'model'>,
  live: Pick<LiveState, 'isRunning' | 'startedAt' | 'activity' | 'awaiting'>,
  defaultModel: string | null | undefined,
  nowMs: number,
): ActivityLineState {
  const waiting = !live.isRunning && Boolean(live.awaiting || live.activity?.kind === 'waiting_for_you');
  const awaitingReason = live.awaiting?.reason?.trim() || '';
  const shortModel = formatShortModelName(bot.model, defaultModel);
  const { elapsedMs, tick } = resolveActivityTiming(live, nowMs);
  return { waiting, awaitingReason, shortModel, elapsedMs, tick };
}
