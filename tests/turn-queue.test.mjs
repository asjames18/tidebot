// Regression tests for Phase 3.1: the serial per-Operator turn queue in
// server/src/agent/loop.ts must recover cleanly from the failure modes a
// daily driver hits — a queued job that throws, a turn with no model
// available, a message for a bot that no longer exists — with no corrupted
// history and no stuck queue. Runs against the compiled server:
// `npm run build -w server` first. Isolated from live data via DB_PATH;
// no model keys, no network.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-turn-queue-'));
process.env.DB_PATH = path.join(fixtures, 'test.db');
const { db } = await import('../server/dist/db.js');
// Mirror server startup (server/src/index.ts): the bots.hidden /
// parent_bot_id columns only exist after initSubagents() runs, and the
// turn's system prompt queries them. Without this, every turn on a fresh
// DB dies with "no such column: hidden".
const { initSubagents } = await import('../server/dist/agent/subagents.js');
initSubagents();
const { appendRow, loadHistory } = await import('../server/dist/store.js');
const { getRun } = await import('../server/dist/runs.js');
const { enqueue, interrupt, isBotBusy, runInBotQueue } = await import('../server/dist/agent/loop.js');

/** Yield one macrotask so the queue's `.finally` cleanup (a microtask
 *  chained off the settled job) has run before checking isBotBusy. */
const drain = () => sleep(0);

after(() => {
  try { db.close(); } finally { fs.rmSync(fixtures, { recursive: true, force: true }); }
});

function seedBot(id) {
  db.prepare("INSERT INTO users(id,email,name,created_at) VALUES (?,?, 'U', 1)").run(`u-${id}`, `${id}@test.local`);
  db.prepare("INSERT INTO bots(id,user_id,name,created_at,updated_at) VALUES (?,?,?,1,1)").run(id, `u-${id}`, 'B');
}

test('queued jobs run serially, in order', async () => {
  const botId = 'queue-order';
  seedBot(botId);
  const order = [];
  const a = runInBotQueue(botId, async () => { await sleep(50); order.push('a'); });
  const b = runInBotQueue(botId, async () => { order.push('b'); });
  await Promise.all([a, b]);
  assert.deepEqual(order, ['a', 'b'], 'the second job must wait for the first');
  await drain();
  assert.equal(isBotBusy(botId), false, 'the queue must drain');
});

test('a failing queued job rejects to its caller but does not poison the queue', async () => {
  const botId = 'queue-poison';
  seedBot(botId);
  await assert.rejects(
    runInBotQueue(botId, async () => { throw new Error('boom'); }),
    /boom/,
    'the caller must see the failure',
  );
  const after = await runInBotQueue(botId, async () => 'still here');
  assert.equal(after, 'still here', 'later jobs must still run after a failure');
  await drain();
  assert.equal(isBotBusy(botId), false, 'the queue must drain');
});

test('a user turn with no model key fails cleanly and the queue stays usable', async () => {
  const botId = 'queue-no-model';
  seedBot(botId);
  const runId = enqueue(botId, { type: 'user', text: 'hello, are you there?' });
  assert.ok(runId, 'enqueue must create a run');
  // Flush the queue: this job runs only after the turn finishes.
  await runInBotQueue(botId, async () => {});
  await drain();
  assert.equal(isBotBusy(botId), false, 'the queue must drain after the turn');

  const run = getRun(botId, runId);
  assert.equal(run.state, 'failed', 'no model means the run fails, not hangs');
  assert.match(run.summary ?? '', /No model was available/, 'the failure reason must say why');
  const history = loadHistory(botId);
  assert.equal(history[0]?.role, 'user', 'the user message must be first in history');
  assert.match(history[0]?.content ?? '', /hello, are you there\?/);
  const reply = history.find((m) => m?.role === 'assistant');
  assert.ok(reply, 'the local fallback reply must be in history');
  assert.match(JSON.stringify(reply.content), /No API key is configured/);

  // A second message after the failure must still get a turn.
  const runId2 = enqueue(botId, { type: 'user', text: 'second try' });
  await runInBotQueue(botId, async () => {});
  assert.equal(getRun(botId, runId2).state, 'failed');
  assert.equal(loadHistory(botId).filter((m) => m?.role === 'user').length, 2,
    'history must hold both user messages, in order, with no corruption');
});

test('a message for a bot that does not exist is a no-op that does not stick the queue', async () => {
  const botId = 'queue-real-bot';
  seedBot(botId);
  const ghostRun = enqueue('queue-ghost-bot', { type: 'user', text: 'hello?' });
  assert.equal(ghostRun, undefined, 'no run can be created for a missing bot');
  const after = await runInBotQueue(botId, async () => 'queue is free');
  assert.equal(after, 'queue is free', 'the queue must still work after the ghost turn');
  await drain();
  assert.equal(isBotBusy('queue-ghost-bot'), false, 'the ghost queue entry must be gone');
});

test('interrupt with no running turn is a safe no-op', () => {
  const botId = 'queue-interrupt';
  seedBot(botId);
  assert.doesNotThrow(() => interrupt(botId), 'interrupt must not throw when idle');
  assert.equal(isBotBusy(botId), false);
});
