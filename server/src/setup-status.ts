// First-run wizard resume state (plan §2.2). Pure reads over the tables the
// wizard steps already depend on — no new tables, no network, no model calls.
// modelConfigured reuses the same public config the Settings → Models flow
// shows, so a key saved in the UI, a personal key, or a key in .env all count.
import { db } from './db.js';
import { getPublicLlmConfig } from './agent/llm.js';
import type { SetupStatus } from './types.js';

/** Which of the guided first-run wizard's steps are done, for one user. */
export function setupStatus(userId: string): SetupStatus {
  const cfg = getPublicLlmConfig(userId);
  const count = (sql: string) => (db.prepare(sql).get(userId) as { n: number }).n;
  const hasOperator =
    count('SELECT COUNT(*) n FROM bots WHERE user_id=? AND COALESCE(hidden,0)=0') > 0;
  const hasCompletedRun =
    count(
      'SELECT COUNT(*) n FROM agent_runs r JOIN bots b ON b.id=r.bot_id ' +
        'WHERE b.user_id=? AND r.finished_at IS NOT NULL',
    ) > 0;
  return {
    modelConfigured: cfg.isConfigured,
    provider: cfg.provider,
    defaultModel: cfg.defaultModel,
    hasOperator,
    hasCompletedRun,
    setupComplete: cfg.isConfigured && hasOperator && hasCompletedRun,
  };
}
