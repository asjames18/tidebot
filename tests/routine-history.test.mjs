// Regression tests for issue #53: routine run history, dry-run / test-fire,
// and failure notifications surfaced to the user.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-routine-hist-'));
process.env.DB_PATH = path.join(fixtures, 'test.db');
process.env.ENV_PATH = path.join(fixtures, '.env');
fs.writeFileSync(process.env.ENV_PATH, 'DEV_LOGIN=1\n', 'utf8');
delete process.env.OPENROUTER_API_KEY;
delete process.env.XAI_API_KEY;
delete process.env.LLM_BASE_URL;

const { db } = await import('../server/dist/db.js');
const { Hono } = await import('hono');
const { api } = await import('../server/dist/routes.js');
const { initSubagents } = await import('../server/dist/agent/subagents.js');
const { initRooms } = await import('../server/dist/agent/rooms.js');
const { runInBotQueue } = await import('../server/dist/agent/loop.js');
const { createRun, setRunState, startRun } = await import('../server/dist/runs.js');
const { saveLlmConfig } = await import('../server/dist/agent/llm.js');
const { unscheduleRoutine } = await import('../server/dist/routines.js');
const { listRows } = await import('../server/dist/store.js');

initSubagents();
initRooms();
const app = new Hono();
app.route('/api', api);

const createdRoutines = [];
after(() => {
  for (const id of createdRoutines) unscheduleRoutine(id);
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

test('dry-run validates routine without executing or creating history; test-fire runs immediately and surfaces failures', async () => {
  const cookie = await login('rt-owner@example.test', 'Owner');
  const otherCookie = await login('rt-other@example.test', 'Other');

  const { bots } = await (await app.request('/api/bots', { headers: { cookie } })).json();
  const botId = bots[0].id;

  // Create a weekday cron routine
  const createRes = await app.request(`/api/bots/${botId}/routines`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      name: 'Morning digest',
      prompt: 'Summarize overnight updates.',
      schedule: '0 9 * * 1-5',
      timezone: 'UTC',
    }),
  });
  assert.equal(createRes.status, 200);
  const { routine } = await createRes.json();
  createdRoutines.push(routine.id);

  // Cross-user isolation on new routine endpoints
  assert.equal((await app.request(`/api/routines/${routine.id}/runs`, { headers: { cookie: otherCookie } })).status, 404);
  assert.equal((await app.request(`/api/routines/${routine.id}/dry-run`, { method: 'POST', headers: { cookie: otherCookie } })).status, 404);

  // Dry-run before any LLM key is configured reports warning without mutating state or creating a run
  const dryRes = await app.request(`/api/routines/${routine.id}/dry-run`, { method: 'POST', headers: { cookie } });
  assert.equal(dryRes.status, 200);
  const dry = await dryRes.json();
  assert.equal(dry.dryRun, true);
  assert.equal(dry.ok, false);
  assert.equal(dry.kind, 'cron');
  assert.ok(typeof dry.nextRunAt === 'number' && dry.nextRunAt > Date.now());
  assert.equal(dry.promptPreview, 'Summarize overnight updates.');
  assert.ok(dry.warnings.some((w) => /No LLM provider key/i.test(w)));

  // Dry-run alias via ?dryRun=1 also works without creating runs
  const dryAliasRes = await app.request(`/api/routines/${routine.id}/run?dryRun=1`, { method: 'POST', headers: { cookie } });
  assert.equal(dryAliasRes.status, 200);
  assert.equal((await dryAliasRes.json()).dryRun, true);

  const runsBefore = await (await app.request(`/api/routines/${routine.id}/runs`, { headers: { cookie } })).json();
  assert.equal(runsBefore.runs.length, 0);
  const rawBefore = db.prepare('SELECT last_run_at FROM routines WHERE id=?').get(routine.id);
  assert.equal(rawBefore.last_run_at, null);

  // Reset unread count so we can verify failure increments unread
  db.prepare('UPDATE bots SET unread=0 WHERE id=?').run(botId);

  // Test-fire runs immediately without waiting for schedule; with no model key it fails and surfaces a notification
  const fireRes = await app.request(`/api/routines/${routine.id}/run`, { method: 'POST', headers: { cookie } });
  assert.equal(fireRes.status, 200);
  const fired = await fireRes.json();
  assert.equal(fired.ok, true);
  assert.ok(typeof fired.runId === 'string' && fired.runId.startsWith('run_'));

  // Wait for the bot's serial queue to finish the test-fired run
  await runInBotQueue(botId, async () => {});

  // Persisted run history records the failed manual test-fire run
  const historyRes = await app.request(`/api/routines/${routine.id}/runs`, { headers: { cookie } });
  assert.equal(historyRes.status, 200);
  const { runs } = await historyRes.json();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].id, fired.runId);
  assert.equal(runs[0].source, 'manual-routine');
  assert.equal(runs[0].state, 'failed');
  assert.match(runs[0].summary ?? '', /No model was available/);

  // Transcript has an error notice naming the routine and unread badge was bumped
  const transcript = listRows(botId, { limit: 20 });
  const notice = transcript.find((row) => row.body.type === 'notice' && row.body.tone === 'error' && row.body.text.includes('Morning digest'));
  assert.ok(notice, 'expected an error notice naming the failed routine in transcript');
  const botAfter = db.prepare('SELECT unread FROM bots WHERE id=?').get(botId);
  assert.ok(botAfter.unread > 0, 'expected unread count to increase on routine failure');

  // GET /api/bots/:id/routines surfaces lastRunState and lastRunSummary for the routine
  const listRes = await app.request(`/api/bots/${botId}/routines`, { headers: { cookie } });
  assert.equal(listRes.status, 200);
  const listed = (await listRes.json()).routines.find((item) => item.id === routine.id);
  assert.equal(listed.lastRunState, 'failed');
  assert.equal(listed.lastRunId, fired.runId);
  assert.match(listed.lastRunSummary ?? '', /No model was available/);

  // A subsequent completed run moves to the top of persisted history and clears the failed lastRunState
  const okRunId = createRun(botId, 'schedule', routine.name, routine.id);
  startRun(okRunId, botId);
  setRunState(okRunId, botId, 'completed');

  const historyAfter = await (await app.request(`/api/routines/${routine.id}/runs`, { headers: { cookie } })).json();
  assert.equal(historyAfter.runs.length, 2);
  assert.equal(historyAfter.runs[0].id, okRunId);
  assert.equal(historyAfter.runs[0].state, 'completed');
  assert.equal(historyAfter.runs[1].id, fired.runId);

  const listAfter = (await (await app.request(`/api/bots/${botId}/routines`, { headers: { cookie } })).json()).routines.find((item) => item.id === routine.id);
  assert.equal(listAfter.lastRunState, 'completed');

  // Once a model key is configured and routine is active, dry-run reports ok: true with no warnings
  saveLlmConfig({ openrouterKey: 'sk-or-v1-fixturekey1234567890abcdef' });
  const dryOk = await (await app.request(`/api/routines/${routine.id}/dry-run`, { method: 'POST', headers: { cookie } })).json();
  assert.equal(dryOk.ok, true);
  assert.deepEqual(dryOk.warnings, []);
});
