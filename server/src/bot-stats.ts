// Per-bot activity counts for the studio (used by GET /api/bots/:id/stats).
// Pure SQL over the same tables /system/status already aggregates — no new
// tables, no network, no model calls.
import { db } from './db.js';

export interface BotStats {
  messages: number;
  tasksOpen: number;
  tasksDone: number;
  memories: number;
}

/** Counts for one of the caller's own bots, or null when the bot does not
 *  exist or belongs to someone else. Callers turn null into a 404. */
export function botStats(userId: string, botId: string): BotStats | null {
  const bot = db.prepare('SELECT 1 FROM bots WHERE id=? AND user_id=?').get(botId, userId);
  if (!bot) return null;
  const count = (sql: string, ...params: unknown[]) =>
    (db.prepare(sql).get(...params) as { n: number }).n;
  return {
    messages: count("SELECT COUNT(*) n FROM rows WHERE bot_id=? AND kind='message'", botId),
    tasksOpen: count("SELECT COUNT(*) n FROM tasks WHERE bot_id=? AND state<>'done'", botId),
    tasksDone: count("SELECT COUNT(*) n FROM tasks WHERE bot_id=? AND state='done'", botId),
    memories: count('SELECT COUNT(*) n FROM memories WHERE bot_id=?', botId),
  };
}
