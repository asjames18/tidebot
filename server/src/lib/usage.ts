import type Database from 'better-sqlite3';
import type { BotUsageResponse, UsageSummary } from '../types.js';

export interface ProviderUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
}

function finiteNonNegative(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

function integerTokenCount(v: unknown): number | null {
  const n = finiteNonNegative(v);
  return n === null ? null : Math.round(n);
}

/**
 * Extract only usage numbers explicitly reported by a model provider.
 * Never guesses or estimates cost from token counts. Returns null when the
 * provider reported no valid token or cost fields.
 */
export function extractProviderUsage(raw: unknown): ProviderUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const inputTokens = integerTokenCount(u.prompt_tokens ?? u.input_tokens);
  const outputTokens = integerTokenCount(u.completion_tokens ?? u.output_tokens);
  const explicitTotal = integerTokenCount(u.total_tokens);
  const totalTokens = explicitTotal ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);
  const costUsd = finiteNonNegative(u.cost);

  if (inputTokens === null && outputTokens === null && totalTokens === null && costUsd === null) {
    return null;
  }
  return { inputTokens, outputTokens, totalTokens, costUsd };
}

export function emptyUsageSummary(): UsageSummary {
  return {
    calls: 0,
    reportedCalls: 0,
    costReportedCalls: 0,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    costUsd: null,
  };
}

interface AggRow {
  calls: number;
  reported_calls: number;
  cost_reported_calls: number;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cost_usd: number | null;
}

function toUsageSummary(row: AggRow | undefined): UsageSummary {
  if (!row || !row.calls) return emptyUsageSummary();
  const reportedCalls = Number(row.reported_calls ?? 0);
  const costReportedCalls = Number(row.cost_reported_calls ?? 0);
  return {
    calls: Number(row.calls),
    reportedCalls,
    costReportedCalls,
    inputTokens: reportedCalls > 0 && row.input_tokens !== null ? Number(row.input_tokens) : null,
    outputTokens: reportedCalls > 0 && row.output_tokens !== null ? Number(row.output_tokens) : null,
    totalTokens: reportedCalls > 0 && row.total_tokens !== null ? Number(row.total_tokens) : null,
    costUsd: costReportedCalls > 0 && row.cost_usd !== null ? Number(row.cost_usd) : null,
  };
}

const AGG_SELECT = `
  COUNT(*) AS calls,
  SUM(CASE WHEN reported = 1 THEN 1 ELSE 0 END) AS reported_calls,
  SUM(CASE WHEN cost_usd IS NOT NULL THEN 1 ELSE 0 END) AS cost_reported_calls,
  SUM(input_tokens) AS input_tokens,
  SUM(output_tokens) AS output_tokens,
  SUM(total_tokens) AS total_tokens,
  SUM(cost_usd) AS cost_usd
`;

export function recordUsageEvent(
  db: Database.Database,
  event: {
    botId: string;
    runId?: string | null;
    provider: string;
    model: string;
    usage: ProviderUsage | null;
    createdAt?: number;
  },
): void {
  const u = event.usage;
  const reported = u && (u.inputTokens !== null || u.outputTokens !== null || u.totalTokens !== null) ? 1 : 0;
  db.prepare(`
    INSERT INTO usage_events (bot_id, run_id, provider, model, input_tokens, output_tokens, total_tokens, cost_usd, reported, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.botId,
    event.runId ?? null,
    event.provider,
    event.model,
    u?.inputTokens ?? null,
    u?.outputTokens ?? null,
    u?.totalTokens ?? null,
    u?.costUsd ?? null,
    reported,
    event.createdAt ?? Date.now(),
  );
}

export function summarizeBotUsage(db: Database.Database, botId: string): BotUsageResponse {
  const totalRow = db.prepare(`SELECT ${AGG_SELECT} FROM usage_events WHERE bot_id = ?`).get(botId) as AggRow | undefined;
  const modelRows = db.prepare(`
    SELECT provider, model, ${AGG_SELECT}
    FROM usage_events
    WHERE bot_id = ?
    GROUP BY provider, model
    ORDER BY MAX(created_at) DESC
  `).all(botId) as Array<AggRow & { provider: string; model: string }>;

  return {
    botId,
    totals: toUsageSummary(totalRow),
    byModel: modelRows.map((r) => ({
      provider: r.provider,
      model: r.model,
      usage: toUsageSummary(r),
    })),
  };
}

export function summarizeRunUsage(db: Database.Database, botId: string, runId: string): UsageSummary {
  const row = db.prepare(`SELECT ${AGG_SELECT} FROM usage_events WHERE bot_id = ? AND run_id = ?`).get(botId, runId) as AggRow | undefined;
  return toUsageSummary(row);
}

export function summarizeRunsUsage(db: Database.Database, botId: string, runIds: string[]): Map<string, UsageSummary> {
  const out = new Map<string, UsageSummary>();
  if (!runIds.length) return out;
  const placeholders = runIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT run_id, ${AGG_SELECT}
    FROM usage_events
    WHERE bot_id = ? AND run_id IN (${placeholders})
    GROUP BY run_id
  `).all(botId, ...runIds) as Array<AggRow & { run_id: string }>;
  for (const r of rows) out.set(r.run_id, toUsageSummary(r));
  return out;
}
