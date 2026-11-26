import type { Row } from '@shared/types';

/**
 * Badge for the chat header's Details button (issue #5: keep active runs
 * and pending approvals visible from chat, even with Details closed).
 *
 * The badge is derived from state the chat view already holds, so it needs
 * no new API call and no store change:
 * - pending approvals are approval cards with status 'pending' in the
 *   selected bot's transcript. This is the durable truth: unlike the
 *   in-memory `live.awaiting` flag, a pending card survives a server
 *   restart and still needs an answer.
 * - a run is active while the bot is working (`live.isRunning`) or a run
 *   sits in state 'waiting' (paused for approval).
 */
export interface DetailsBadgeInput {
  rows: Row[];
  isRunning: boolean;
  awaitingApproval: boolean;
  waitingRun: boolean;
}

export interface DetailsBadge {
  /** Number of pending approval cards, when any. Null for the dot states. */
  count: number | null;
  /** Short human label, e.g. "2 approvals waiting" or "Working". */
  label: string;
  /** True when something needs the user's input (warn colour), false for a plain working dot. */
  urgent: boolean;
}

/** How many approval cards in these rows are still waiting for an answer. */
export function pendingApprovalCount(rows: Row[]): number {
  let count = 0;
  for (const row of rows) {
    const body = row.body;
    if (body.type === 'card' && body.card === 'approval' && body.status === 'pending') count += 1;
  }
  return count;
}

export function detailsBadge(input: DetailsBadgeInput): DetailsBadge | null {
  const pending = pendingApprovalCount(input.rows);
  if (pending > 0) {
    return {
      count: pending,
      label: pending === 1 ? '1 approval waiting' : `${pending} approvals waiting`,
      urgent: true,
    };
  }
  if (input.awaitingApproval || input.waitingRun) {
    return { count: null, label: 'Needs your input', urgent: true };
  }
  if (input.isRunning) {
    return { count: null, label: 'Working', urgent: false };
  }
  return null;
}
