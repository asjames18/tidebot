import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCostUsd, formatTokenCount, formatUsageSummary } from '../web/src/lib/usageFormat.ts';

test('formatTokenCount and formatCostUsd format compact human-readable figures', () => {
  assert.equal(formatTokenCount(0), '0');
  assert.equal(formatTokenCount(842), '842');
  assert.equal(formatTokenCount(1450), '1.5k');
  assert.equal(formatTokenCount(2_500_000), '2.5M');

  assert.equal(formatCostUsd(0), '$0.00');
  assert.equal(formatCostUsd(0.00004), '<$0.0001');
  assert.equal(formatCostUsd(0.0042), '$0.0042');
  assert.equal(formatCostUsd(0.125), '$0.125');
  assert.equal(formatCostUsd(1.5), '$1.50');
});

test('formatUsageSummary shows honest empty and not-reported states', () => {
  assert.deepEqual(formatUsageSummary(undefined), {
    tokens: 'No model calls yet',
    cost: '—',
    inline: 'No usage recorded',
  });

  const unreported = formatUsageSummary({
    calls: 2,
    reportedCalls: 0,
    costReportedCalls: 0,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    costUsd: null,
  });
  assert.equal(unreported.tokens, 'Usage not reported by provider');
  assert.equal(unreported.cost, 'Cost not reported');
  assert.equal(unreported.inline, 'Usage not reported by provider');
});

test('formatUsageSummary shows reported tokens, optional cost, and partial-reporting note', () => {
  const full = formatUsageSummary({
    calls: 2,
    reportedCalls: 2,
    costReportedCalls: 2,
    inputTokens: 1200,
    outputTokens: 300,
    totalTokens: 1500,
    costUsd: 0.0045,
  });
  assert.equal(full.tokens, '1.5k tokens (1.2k in · 300 out)');
  assert.equal(full.cost, '$0.0045');
  assert.equal(full.note, undefined);
  assert.equal(full.inline, '1.5k tok · $0.0045');

  const tokensOnly = formatUsageSummary({
    calls: 3,
    reportedCalls: 2,
    costReportedCalls: 0,
    inputTokens: 800,
    outputTokens: 200,
    totalTokens: 1000,
    costUsd: null,
  });
  assert.equal(tokensOnly.tokens, '1.0k tokens (800 in · 200 out)');
  assert.equal(tokensOnly.cost, 'Cost not reported');
  assert.equal(tokensOnly.note, 'Reported for 2 of 3 calls');
  assert.equal(tokensOnly.inline, '1.0k tok · cost not reported');
});

test('formatUsageSummary shows reported cost even when token counts are missing', () => {
  assert.deepEqual(formatUsageSummary({
    calls: 2,
    reportedCalls: 0,
    costReportedCalls: 1,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    costUsd: 0,
  }), {
    tokens: 'Usage not reported by provider',
    cost: '$0.00',
    note: 'Cost reported for 1 of 2 calls',
    inline: 'Tokens not reported · $0.00 (1 of 2 calls)',
  });
});

test('formatUsageSummary distinguishes token and cost reporting coverage', () => {
  const partial = formatUsageSummary({
    calls: 3,
    reportedCalls: 2,
    costReportedCalls: 1,
    inputTokens: 300,
    outputTokens: 100,
    totalTokens: 400,
    costUsd: 0.02,
  });
  assert.equal(partial.note, 'Tokens reported for 2 of 3 calls · Cost reported for 1 of 3 calls');
  assert.equal(partial.inline, '400 tok · $0.020 (1 of 3 calls)');
});
