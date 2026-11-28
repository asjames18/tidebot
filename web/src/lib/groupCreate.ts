import type { Bot } from '@shared/types';

export const MIN_GROUP_MEMBERS = 2;

export interface CreateGroupPayload {
  name: string;
  botIds: string[];
}

export interface GroupKeyLike {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
}

export function eligibleGroupBots<T extends Pick<Bot, 'id' | 'kind'>>(bots: readonly T[]): T[] {
  return bots.filter((b) => b.kind !== 'room');
}

/** Deduplicates `picked` and drops any IDs that are no longer in `eligible`. */
export function reconcilePickedBotIds(
  picked: readonly string[],
  eligible: readonly Pick<Bot, 'id'>[],
): string[] {
  const valid = new Set(eligible.map((b) => b.id));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of picked) {
    if (!valid.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function togglePickedBotId(
  picked: readonly string[],
  botId: string,
  eligible: readonly Pick<Bot, 'id'>[],
): string[] {
  const current = reconcilePickedBotIds(picked, eligible);
  if (current.includes(botId)) return current.filter((id) => id !== botId);
  if (!eligible.some((b) => b.id === botId)) return current;
  return [...current, botId];
}

export function isAllEligiblePicked(
  picked: readonly string[],
  eligible: readonly Pick<Bot, 'id'>[],
): boolean {
  return eligible.length > 0 && reconcilePickedBotIds(picked, eligible).length === eligible.length;
}

export function buildCreateGroupPayload(
  name: string,
  picked: readonly string[],
  eligible: readonly Pick<Bot, 'id'>[],
): CreateGroupPayload | null {
  const trimmed = name.trim();
  const botIds = reconcilePickedBotIds(picked, eligible);
  if (!trimmed || botIds.length < MIN_GROUP_MEMBERS) return null;
  return { name: trimmed, botIds };
}

export function shouldBlurNameOnEnter(
  e: GroupKeyLike,
  viewportWidth: number,
  selectedCount: number,
): boolean {
  if (e.key !== 'Enter') return false;
  if (e.isComposing || e.keyCode === 229) return false;
  return viewportWidth <= 900 && selectedCount < MIN_GROUP_MEMBERS;
}
