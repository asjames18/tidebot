import { AsyncLocalStorage } from 'node:async_hooks';
import { db, now } from './db.js';
import { hub } from './lib/hub.js';
import { newId } from './lib/ids.js';
import { emptyUsageSummary, summarizeRunUsage, summarizeRunsUsage } from './lib/usage.js';
import type { AgentRun, AgentRunState, UsageSummary } from './types.js';

type RunLink = { id: string; botId: string };
export const runContext = new AsyncLocalStorage<RunLink>();

export function createRun(botId: string, source: AgentRun['source'], title: string, routineId?: string, requestSeq?: number) {
  const id = newId('run');
  const inserted = db.transaction(() => {
    const result = db.prepare(`INSERT INTO agent_runs(id, bot_id, source, title, routine_id, state, created_at)
      SELECT ?, id, ?, ?, ?, 'queued', ? FROM bots WHERE id=?`).run(id, source, title, routineId ?? null, now(), botId);
    if (result.changes && requestSeq !== undefined) {
      db.prepare(`UPDATE rows SET run_id=? WHERE bot_id=? AND seq=? AND run_id IS NULL
        AND generation=(SELECT generation FROM bots WHERE id=?)`).run(id, botId, requestSeq, botId);
    }
    return result.changes;
  })();
  if (!inserted) return;
  emitRuns(botId);
  return id;
}

function emitRuns(botId: string) {
  const bot = db.prepare('SELECT user_id FROM bots WHERE id=?').get(botId) as { user_id: string } | undefined;
  if (bot) hub.emit(bot.user_id, { type: 'runs', botId });
}

export function startRun(id: string, botId: string) {
  const result = db.prepare(`UPDATE agent_runs SET state='running', started_at=COALESCE(started_at, ?)
    WHERE id=? AND bot_id=? AND state IN ('queued','waiting')`).run(now(), id, botId);
  if (result.changes) emitRuns(botId);
  return !!result.changes;
}

export function setRunState(id: string, botId: string, state: 'waiting' | 'completed' | 'failed' | 'interrupted', summary?: string) {
  const changed = db.prepare(`UPDATE agent_runs SET state=?, finished_at=?, summary=?
    WHERE id=? AND bot_id=? AND state IN ('running','waiting')`)
    .run(state, state === 'waiting' ? null : now(), summary ?? null, id, botId);
  if (changed.changes) emitRuns(botId);
}

export function recoverInterruptedRuns() {
  db.transaction(() => {
    db.prepare(`UPDATE agent_runs SET state='interrupted', finished_at=?, summary=?
      WHERE state IN ('queued','running') OR (state='waiting' AND NOT EXISTS (
        SELECT 1 FROM pending_turns p JOIN approvals a ON a.id=json_extract(p.state, '$.approvalId')
        WHERE p.bot_id=agent_runs.bot_id AND json_extract(p.state, '$.runId')=agent_runs.id AND a.status='pending'
      ))`).run(now(), 'TideBot stopped before this run finished.');
    // A checkpoint from an interrupted approval continuation could repeat an action.
    db.exec(`DELETE FROM pending_turns WHERE EXISTS (
      SELECT 1 FROM agent_runs r WHERE r.bot_id=pending_turns.bot_id
        AND r.id=json_extract(pending_turns.state, '$.runId') AND r.state='interrupted'
    )`);
  })();
}

type RunRecord = { id: string; source: AgentRun['source']; title: string; routine_id: string | null; state: AgentRunState;
  created_at: number; started_at: number | null; finished_at: number | null; summary: string | null };
const toRun = (r: RunRecord, usage?: UsageSummary): AgentRun => ({
  id: r.id, source: r.source, title: r.title, routineId: r.routine_id, state: r.state,
  createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at, summary: r.summary,
  ...(usage ? { usage } : {}),
});

export function listRuns(botId: string) {
  const rows = db.prepare('SELECT * FROM agent_runs WHERE bot_id=? ORDER BY rowid DESC LIMIT 50').all(botId) as RunRecord[];
  const byRun = summarizeRunsUsage(db, botId, rows.map((r) => r.id));
  return rows.map((r) => toRun(r, byRun.get(r.id) ?? emptyUsageSummary()));
}

export function listRoutineRuns(routineId: string, limit = 20) {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 50);
  return (db.prepare('SELECT * FROM agent_runs WHERE routine_id=? ORDER BY rowid DESC LIMIT ?').all(routineId, safeLimit) as RunRecord[]).map((r) => toRun(r));
}

export function latestRoutineRuns(botId: string): Map<string, AgentRun> {
  const rows = db.prepare(`
    SELECT a.*
    FROM agent_runs a
    INNER JOIN (
      SELECT routine_id, MAX(rowid) AS max_rowid
      FROM agent_runs
      WHERE bot_id=? AND routine_id IS NOT NULL
      GROUP BY routine_id
    ) latest ON a.rowid = latest.max_rowid
  `).all(botId) as RunRecord[];
  const out = new Map<string, AgentRun>();
  for (const r of rows) {
    if (r.routine_id) out.set(r.routine_id, toRun(r));
  }
  return out;
}

export function getRun(botId: string, runId: string) {
  const r = db.prepare('SELECT * FROM agent_runs WHERE bot_id=? AND id=?').get(botId, runId) as RunRecord | undefined;
  return r && toRun(r, summarizeRunUsage(db, botId, r.id));
}
