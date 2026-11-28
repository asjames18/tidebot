import type { Bot } from '@shared/types';

export const MIN_ROOM_MEMBERS = 2;

export interface MemberIdRef {
  id: string;
}

export interface RoomRequestToken {
  readonly roomId: string;
  readonly gen: number;
}

/**
 * Returns Operators eligible to be added to a group chat (non-rooms not already in `members`).
 * Returns an empty list while `members` has not loaded (`null`).
 */
export function eligibleRoomCandidates(
  bots: readonly Bot[],
  members: readonly MemberIdRef[] | null,
): Bot[] {
  if (members === null) return [];
  const memberIds = new Set(members.map((m) => m.id));
  return bots.filter((b) => b.kind !== 'room' && !memberIds.has(b.id));
}

/**
 * Computes the next deduplicated member ID list after adding `botId`.
 * Returns `null` when `members` is not loaded (`null`), `botId` is empty, or `botId` is already present.
 */
export function addRoomMemberIds(
  members: readonly MemberIdRef[] | null,
  botId: string,
): string[] | null {
  if (members === null || !botId) return null;
  const ids = [...new Set(members.map((m) => m.id))];
  if (ids.includes(botId)) return null;
  return [...ids, botId];
}

/**
 * Computes the next deduplicated member ID list after removing `botId`.
 * Returns `null` when `members` is not loaded (`null`), `botId` is absent, or removing it
 * would violate the minimum 2-member room invariant.
 */
export function removeRoomMemberIds(
  members: readonly MemberIdRef[] | null,
  botId: string,
): string[] | null {
  if (members === null || !botId) return null;
  const ids = [...new Set(members.map((m) => m.id))];
  if (!ids.includes(botId)) return null;
  const next = ids.filter((id) => id !== botId);
  if (next.length < MIN_ROOM_MEMBERS) return null;
  return next;
}

/**
 * Coordinates room-scoped async loads and saves so switching rooms, clicking Retry,
 * or unmounting invalidates stale in-flight responses.
 */
export class RoomMembersGate {
  private activeRoomId: string | null = null;
  private loadGen = 0;
  private saveGen = 0;

  selectRoom(roomId: string): void {
    this.activeRoomId = roomId;
    this.loadGen += 1;
    this.saveGen += 1;
  }

  invalidate(): void {
    this.loadGen += 1;
    this.saveGen += 1;
  }

  beginLoad(roomId: string): RoomRequestToken | null {
    if (this.activeRoomId !== roomId) return null;
    this.loadGen += 1;
    return { roomId, gen: this.loadGen };
  }

  isLoadCurrent(token: RoomRequestToken): boolean {
    return this.activeRoomId === token.roomId && this.loadGen === token.gen;
  }

  beginSave(roomId: string): RoomRequestToken | null {
    if (this.activeRoomId !== roomId) return null;
    this.saveGen += 1;
    return { roomId, gen: this.saveGen };
  }

  isSaveCurrent(token: RoomRequestToken): boolean {
    return this.activeRoomId === token.roomId && this.saveGen === token.gen;
  }
}
