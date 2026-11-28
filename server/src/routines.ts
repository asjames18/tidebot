import { Cron } from 'croner';
import { db, now } from './db.js';
import { hub } from './lib/hub.js';
import { appendRow } from './store.js';
import { getPublicLlmConfig } from './agent/llm.js';
import type { Routine, RoutineDryRunResult } from './types.js';
import { isEventSchedule, setEventRoutineEnabled } from './triggers.js';

const jobs = new Map<string, Cron>();
let enqueueFn: ((botId: string, t: any) => string | undefined) | null = null;

export function initRoutines(enqueue: (botId: string, t: any) => string | undefined) {
  enqueueFn = enqueue;
  const all = db.prepare("SELECT * FROM routines WHERE enabled=1 AND schedule NOT LIKE 'event:%'").all() as any[];
  for (const r of all) scheduleRoutine({ id: r.id, botId: r.bot_id, name: r.name, prompt: r.prompt, schedule: r.schedule, timezone: r.timezone } as Routine);
  console.log(`[routines] scheduled ${jobs.size}`);
}

export const MIN_ROUTINE_INTERVAL_MS = 15 * 60_000;
export const MAX_ROUTINES_PER_BOT = 25;

/** Returns an error string when the cron schedule is invalid or fires more often than the minimum interval. */
export function validateRoutineSchedule(schedule: string, timezone = 'UTC'): string | null {
  if (isEventSchedule(schedule)) return null;
  let job: Cron;
  try { job = new Cron(schedule, { paused: true, timezone: timezone || 'UTC' }); }
  catch (e: any) { return `Invalid schedule: ${e?.message ?? e}`; }
  try {
    const runs = job.nextRuns(2);
    if (runs.length === 2 && runs[1].getTime() - runs[0].getTime() < MIN_ROUTINE_INTERVAL_MS) {
      return 'Schedule fires too often: routines must be at least 15 minutes apart';
    }
  } finally { job.stop(); }
  return null;
}

/** Returns an error string when a routine's schedule may not be changed to this value. */
export function routineScheduleChangeError(oldSchedule: string, nextSchedule: string): string | null {
  if (isEventSchedule(oldSchedule)) return 'Event routine triggers cannot be edited; delete the routine and create it again';
  if (isEventSchedule(nextSchedule)) return 'Event routines are created by the create_event_routine tool, not by editing a schedule';
  return null;
}

export function scheduleRoutine(r: Pick<Routine, 'id' | 'botId' | 'name' | 'prompt' | 'schedule' | 'timezone'>) {
  if (isEventSchedule(r.schedule)) { void setEventRoutineEnabled(r.id, true); return; }
  const invalid = validateRoutineSchedule(r.schedule, r.timezone || 'UTC');
  if (invalid) { console.warn('[routines] not scheduling', r.id, invalid); return; }
  unscheduleRoutine(r.id);
  try {
    const job = new Cron(r.schedule, { timezone: r.timezone || 'UTC', protect: true }, () => { runRoutine(r.id); });
    jobs.set(r.id, job);
  } catch (e) {
    console.warn('[routines] bad schedule', r.id, r.schedule, (e as Error).message);
  }
}

export function unscheduleRoutine(id: string) {
  const row = db.prepare('SELECT schedule FROM routines WHERE id=?').get(id) as any;
  if (row && isEventSchedule(row.schedule)) void setEventRoutineEnabled(id, false);
  jobs.get(id)?.stop();
  jobs.delete(id);
}

/**
 * Validate and preview a routine without executing it, mutating last_run_at,
 * or creating an agent_runs entry.
 */
export function dryRunRoutine(id: string): RoutineDryRunResult | null {
  const r = db.prepare('SELECT r.*, b.user_id FROM routines r JOIN bots b ON b.id=r.bot_id WHERE r.id=?').get(id) as any;
  if (!r) return null;
  const kind: 'cron' | 'event' = isEventSchedule(r.schedule) ? 'event' : 'cron';
  const warnings: string[] = [];
  if (!r.enabled) warnings.push('Routine is currently paused; scheduled/event triggers will not fire until resumed.');
  let nextRunAt: number | null = null;
  if (kind === 'cron') {
    const invalid = validateRoutineSchedule(r.schedule, r.timezone || 'UTC');
    if (invalid) warnings.push(invalid);
    else {
      try {
        const job = new Cron(r.schedule, { timezone: r.timezone || 'UTC', paused: true });
        try { nextRunAt = job.nextRun()?.getTime() ?? null; } finally { job.stop(); }
      } catch (e: any) {
        warnings.push(`Invalid schedule: ${e?.message ?? e}`);
      }
    }
  } else if (!r.trigger_id) {
    warnings.push('Event routine is missing a Composio trigger id; recreate it to receive live events.');
  }
  try {
    if (!getPublicLlmConfig(r.user_id).isConfigured) {
      warnings.push('No LLM provider key is configured; running this routine will fail until a model is set up.');
    }
  } catch { /* ignore */ }
  return {
    ok: warnings.length === 0,
    dryRun: true,
    routineId: r.id,
    botId: r.bot_id,
    name: r.name,
    kind,
    schedule: r.schedule,
    timezone: r.timezone || 'UTC',
    enabled: !!r.enabled,
    nextRunAt,
    promptPreview: String(r.prompt ?? '').slice(0, 400),
    warnings,
  };
}

export function runRoutine(id: string, source: 'schedule' | 'manual-routine' = 'schedule', enqueue = enqueueFn): string | undefined {
  const r = db.prepare('SELECT r.*, b.user_id FROM routines r JOIN bots b ON b.id=r.bot_id WHERE r.id=?').get(id) as any;
  if (!r || !enqueue) return undefined;
  db.prepare('UPDATE routines SET last_run_at=? WHERE id=?').run(now(), id);
  appendRow(r.bot_id, 'event', { type: 'event', event: 'routine-run', text: `Running routine: ${r.name}`, ref: id });
  const runId = enqueue(r.bot_id, { type: 'routine', routineId: id, name: r.name, prompt: r.prompt, source });
  if (r.user_id) hub.emit(r.user_id, { type: 'routines', botId: r.bot_id });
  return runId;
}
