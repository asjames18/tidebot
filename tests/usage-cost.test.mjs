// Regression tests for issue #54: per-Operator and per-run token / cost visibility.
// Verifies only provider-reported numbers are stored/shown and unreported providers
// return null totals with an honest unreported count (never guessed prices).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-usage-'));
process.env.DB_PATH = path.join(fixtures, 'test.db');
process.env.ENV_PATH = path.join(fixtures, '.env');
fs.writeFileSync(process.env.ENV_PATH, 'DEV_LOGIN=1\n', 'utf8');

const { db } = await import('../server/dist/db.js');
const { Hono } = await import('hono');
const { api } = await import('../server/dist/routes.js');
const { initSubagents } = await import('../server/dist/agent/subagents.js');
const { initRooms } = await import('../server/dist/agent/rooms.js');
const { createRun } = await import('../server/dist/runs.js');
const {
  extractProviderUsage,
  recordUsageEvent,
  summarizeBotUsage,
  summarizeRunUsage,
} = await import('../server/dist/lib/usage.js');

initSubagents();
initRooms();
const app = new Hono();
app.route('/api', api);

after(() => {
  try { db.close(); } finally { fs.rmSync(fixtures, { recursive: true, force: true }); }
});

async function login(email, name) {
  const res = await app.request('/api/auth/dev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name }),
  });
  assert.equal(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

test('extractProviderUsage parses OpenRouter, xAI, and ignores missing/invalid fields without guessing', () => {
  assert.deepEqual(
    extractProviderUsage({ prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500, cost: 0.0045 }),
    { inputTokens: 1200, outputTokens: 300, totalTokens: 1500, costUsd: 0.0045 },
  );

  // xAI Responses shape (tokens reported, no cost field -> costUsd stays null)
  assert.deepEqual(
    extractProviderUsage({ input_tokens: 400, output_tokens: 100 }),
    { inputTokens: 400, outputTokens: 100, totalTokens: 500, costUsd: null },
  );

  // Unreported or malformed usage returns null
  assert.equal(extractProviderUsage(undefined), null);
  assert.equal(extractProviderUsage(null), null);
  assert.equal(extractProviderUsage({}), null);
  assert.equal(extractProviderUsage({ prompt_tokens: -5, cost: Number.NaN }), null);
});

test('per-Operator and per-run usage reports exact totals and honest not-reported states over HTTP', async () => {
  const cookie = await login('usage-owner@example.test', 'Owner');
  const otherCookie = await login('usage-other@example.test', 'Other');

  // Create two bots: one backed by a provider that reports usage/cost, one by a local provider with no usage
  const createBot = async (name) => {
    const res = await app.request('/api/bots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name, avatarShape: 'hex', avatarColor: 'cyan', mode: 'personal' }),
    });
    assert.equal(res.status, 200);
    return (await res.json()).bot;
  };

  const botReported = await createBot('Analyst');
  const botUnreported = await createBot('LocalBot');

  const run1 = createRun(botReported.id, 'chat', 'Summarize Q3');
  const run2 = createRun(botReported.id, 'chat', 'Draft memo');
  const runLocal = createRun(botUnreported.id, 'chat', 'Offline summary');

  // Run 1: two OpenRouter calls with tokens and provider-reported USD cost
  recordUsageEvent(db, {
    botId: botReported.id,
    runId: run1,
    provider: 'openrouter',
    model: 'anthropic/claude-3.7-sonnet',
    usage: { inputTokens: 1000, outputTokens: 250, totalTokens: 1250, costUsd: 0.003 },
    createdAt: 1000,
  });
  recordUsageEvent(db, {
    botId: botReported.id,
    runId: run1,
    provider: 'openrouter',
    model: 'anthropic/claude-3.7-sonnet',
    usage: { inputTokens: 500, outputTokens: 150, totalTokens: 650, costUsd: 0.0015 },
    createdAt: 2000,
  });

  // Run 2: xAI call reporting tokens only (no cost)
  recordUsageEvent(db, {
    botId: botReported.id,
    runId: run2,
    provider: 'xai',
    model: 'grok-4.7',
    usage: { inputTokens: 300, outputTokens: 100, totalTokens: 400, costUsd: null },
    createdAt: 3000,
  });

  // LocalBot run: custom provider that reports no usage at all
  recordUsageEvent(db, {
    botId: botUnreported.id,
    runId: runLocal,
    provider: 'custom',
    model: 'llama3.2',
    usage: null,
    createdAt: 4000,
  });

  // Cross-user isolation
  assert.equal((await app.request(`/api/bots/${botReported.id}/usage`, { headers: { cookie: otherCookie } })).status, 404);

  // Per-Operator summary (reported)
  const usageRes = await app.request(`/api/bots/${botReported.id}/usage`, { headers: { cookie } });
  assert.equal(usageRes.status, 200);
  const botUsage = await usageRes.json();
  assert.equal(botUsage.totals.calls, 3);
  assert.equal(botUsage.totals.reportedCalls, 3);
  assert.equal(botUsage.totals.costReportedCalls, 2);
  assert.equal(botUsage.totals.inputTokens, 1800);
  assert.equal(botUsage.totals.outputTokens, 500);
  assert.equal(botUsage.totals.totalTokens, 2300);
  assert.ok(Math.abs(botUsage.totals.costUsd - 0.0045) < 1e-9);
  assert.equal(botUsage.byModel.length, 2);

  // Per-Operator summary (provider reports no usage -> nulls, never invented numbers)
  const localUsage = summarizeBotUsage(db, botUnreported.id);
  assert.equal(localUsage.totals.calls, 1);
  assert.equal(localUsage.totals.reportedCalls, 0);
  assert.equal(localUsage.totals.costReportedCalls, 0);
  assert.equal(localUsage.totals.inputTokens, null);
  assert.equal(localUsage.totals.outputTokens, null);
  assert.equal(localUsage.totals.totalTokens, null);
  assert.equal(localUsage.totals.costUsd, null);

  // Per-run usage over GET /api/bots/:id/runs and GET /api/bots/:id/runs/:runId
  const runsRes = await app.request(`/api/bots/${botReported.id}/runs`, { headers: { cookie } });
  assert.equal(runsRes.status, 200);
  const { runs } = await runsRes.json();
  const r1 = runs.find((r) => r.id === run1);
  const r2 = runs.find((r) => r.id === run2);
  assert.equal(r1.usage.totalTokens, 1900);
  assert.ok(Math.abs(r1.usage.costUsd - 0.0045) < 1e-9);
  assert.equal(r2.usage.totalTokens, 400);
  assert.equal(r2.usage.costUsd, null);

  const detailRes = await app.request(`/api/bots/${botUnreported.id}/runs/${runLocal}`, { headers: { cookie } });
  assert.equal(detailRes.status, 200);
  const { run: localDetail } = await detailRes.json();
  assert.deepEqual(localDetail.usage, summarizeRunUsage(db, botUnreported.id, runLocal));
  assert.equal(localDetail.usage.calls, 1);
  assert.equal(localDetail.usage.reportedCalls, 0);
  assert.equal(localDetail.usage.costUsd, null);
});
