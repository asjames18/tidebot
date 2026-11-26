import type Database from 'better-sqlite3';

/**
 * Pending tool-approval counts per bot, for one user (issue #5: keep pending
 * approvals visible from chat even when they belong to another bot).
 *
 * Source of truth is the `approvals` table: the agent loop inserts one row
 * in the same transaction as the approval card (loop.ts), and resolveApproval
 * flips both the row and the card out of 'pending' together — so this count
 * always agrees with the pending approval cards in the transcripts. Draft
 * cards (drf_) and question cards are not approvals and are not counted.
 */
export function pendingApprovalCounts(db: InstanceType<typeof Database>, userId: string): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT a.bot_id AS botId, COUNT(*) AS n FROM approvals a
       JOIN bots b ON b.id = a.bot_id
       WHERE b.user_id = ? AND a.status = 'pending'
       GROUP BY a.bot_id`,
    )
    .all(userId) as { botId: string; n: number }[];
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.botId] = r.n;
  return counts;
}
