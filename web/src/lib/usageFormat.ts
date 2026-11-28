import type { UsageSummary } from '@shared/types';

/** Compact token formatting (e.g. 842, 1.4k, 2.3M). */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n >= 1_000_000) return `${n >= 10_000_000 ? Math.round(n / 1_000_000) : (Math.round(n / 100_000) / 10).toFixed(1)}M`;
  if (n >= 1_000) return `${n >= 10_000 ? Math.round(n / 1_000) : (Math.round(n / 100) / 10).toFixed(1)}k`;
  return String(Math.round(n));
}

/** Format a provider-reported USD cost honestly (never invents a price). */
export function formatCostUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return 'Not reported';
  if (usd === 0) return '$0.00';
  if (usd < 0.0001) return '<$0.0001';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export interface FormattedUsage {
  /** Primary display text for tokens (or honest "not reported" / "no calls yet" state). */
  tokens: string;
  /** Primary display text for provider-reported cost (or honest "not reported" state). */
  cost: string;
  /** Optional partial-reporting note when only a subset of calls reported usage. */
  note?: string;
  /** Single-line summary suitable for compact run/task rows. */
  inline: string;
}

/**
 * Format a UsageSummary for Operator and Run/Task UI panels.
 * Always distinguishes "no calls yet" vs "provider did not report usage/cost".
 */
export function formatUsageSummary(usage: UsageSummary | undefined): FormattedUsage {
  if (!usage || usage.calls === 0) {
    return {
      tokens: 'No model calls yet',
      cost: '—',
      inline: 'No usage recorded',
    };
  }

  const { calls, reportedCalls, costReportedCalls, costUsd } = usage;
  const cost = costUsd === null ? 'Cost not reported' : formatCostUsd(costUsd);
  const costCoverage = costUsd !== null && costReportedCalls < calls ? `${costReportedCalls} of ${calls} calls` : '';
  const costNote = costCoverage ? `Cost reported for ${costCoverage}` : '';
  const inlineCost = costCoverage ? `${cost} (${costCoverage})` : costUsd === null ? 'cost not reported' : cost;

  if (reportedCalls === 0) {
    return {
      tokens: 'Usage not reported by provider',
      cost,
      ...(costNote ? { note: costNote } : {}),
      inline: costUsd === null ? 'Usage not reported by provider' : `Tokens not reported · ${inlineCost}`,
    };
  }

  const total = usage.totalTokens ?? ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0));
  const breakdown: string[] = [];
  if (usage.inputTokens !== null) breakdown.push(`${formatTokenCount(usage.inputTokens)} in`);
  if (usage.outputTokens !== null) breakdown.push(`${formatTokenCount(usage.outputTokens)} out`);
  const tokens = breakdown.length
    ? `${formatTokenCount(total)} tokens (${breakdown.join(' · ')})`
    : `${formatTokenCount(total)} tokens`;

  const tokenNote = reportedCalls < calls
    ? `${costUsd === null ? 'Reported' : 'Tokens reported'} for ${reportedCalls} of ${calls} calls`
    : '';
  const note = [tokenNote, costNote].filter(Boolean).join(' · ');
  const inline = `${formatTokenCount(total)} tok · ${inlineCost}`;

  return { tokens, cost, ...(note ? { note } : {}), inline };
}
