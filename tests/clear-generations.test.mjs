// Regression tests for RAK-40: clearing a conversation must purge superseded
// generations of rows and llm_items (which can hold large payloads such as
// base64 screenshots), so the DB does not grow with unreachable data.
// Runs against the compiled server: `npm run build -w server` first.
// Isolated from live data via DB_PATH; never touches the network.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-clear-generations-'));
process.env.DB_PATH = path.join(fixtures, 'test.db');
process.env.ENV_PATH = path.join(fixtures, '.env');
const { db } = await import('../server/dist/db.js');
const { appendHistory, appendRow, clearConversation } = await import('../server/dist/store.js');

after(() => {
  try { db.close(); } finally { fs.rmSync(fixtures, { recursive: true, force: true }); }
});

function seedBot(id) {
  db.prepare("INSERT INTO users(id,email,name,created_at) VALUES (?,?, 'U', 1)").run(`u-${id}`, `${id}@test.local`);
  db.prepare("INSERT INTO bots(id,user_id,name,created_at,updated_at) VALUES (?,?,?,1,1)").run(id, `u-${id}`, 'B');
}

const counts = (botId, generation) => ({
  rows: db.prepare('SELECT COUNT(*) n FROM rows WHERE bot_id=? AND generation=?').get(botId, generation).n,
  items: db.prepare('SELECT COUNT(*) n FROM llm_items WHERE bot_id=? AND generation=?').get(botId, generation).n,
});

test('clearConversation deletes old-generation rows and llm_items, including large payloads', () => {
  seedBot('clear-a');
  appendRow('clear-a', 'message', { type: 'message', role: 'user', text: 'hello' });
  appendRow('clear-a', 'message', { type: 'message', role: 'assistant', text: 'hi there' });
  const blob = 'A'.repeat(500_000); // like a base64 screenshot payload
  appendHistory('clear-a', [
    { role: 'user', content: 'look at this' },
    { role: 'assistant', content: [{ type: 'image_url', image_url: blob }] },
  ]);
  const before = db.prepare('SELECT generation FROM bots WHERE id=?').get('clear-a');

  clearConversation('clear-a');

  const gen = db.prepare('SELECT generation, next_seq FROM bots WHERE id=?').get('clear-a');
  assert.equal(gen.generation, before.generation + 1, 'generation must advance');
  assert.equal(gen.next_seq, 1, 'next_seq must reset');
  assert.deepEqual(counts('clear-a', before.generation), { rows: 0, items: 0 }, 'old generation must be purged');
});

test('the bot stays usable after clearing: new rows land in the new generation', () => {
  seedBot('clear-b');
  appendRow('clear-b', 'message', { type: 'message', role: 'user', text: 'first life' });
  const before = db.prepare('SELECT generation FROM bots WHERE id=?').get('clear-b');
  clearConversation('clear-b');

  const row = appendRow('clear-b', 'message', { type: 'message', role: 'user', text: 'fresh start' });
  const gen = db.prepare('SELECT generation FROM bots WHERE id=?').get('clear-b');
  assert.equal(row.generation, gen.generation, 'new row belongs to the new generation');
  assert.deepEqual(counts('clear-b', before.generation), { rows: 0, items: 0 });
  assert.deepEqual(counts('clear-b', gen.generation), { rows: 1, items: 0 });
});

test('an obsolete approval continuation leaves the current run waiting', async () => {
  const { createRun, getRun, setRunState, startRun } = await import('../server/dist/runs.js');
  const { enqueue, runInBotQueue } = await import('../server/dist/agent/loop.js');
  const botId = 'superseded-approval';
  seedBot(botId);
  const runId = createRun(botId, 'chat', 'Current request');
  assert.ok(startRun(runId, botId));
  setRunState(runId, botId, 'waiting');
  db.prepare('INSERT INTO pending_turns(bot_id,state) VALUES (?,?)').run(botId,
    JSON.stringify({ runId, approvalId: 'approval-current', calls: [], outputs: [], depth: 0 }));

  enqueue(botId, { type: 'resume', approvalId: 'approval-old' });
  await runInBotQueue(botId, async () => {});
  assert.equal(getRun(botId, runId).state, 'waiting');
  assert.ok(db.prepare('SELECT 1 FROM pending_turns WHERE bot_id=?').get(botId));
});

test('long run details retain the request and the most recent output', async () => {
  const { createRun, runContext } = await import('../server/dist/runs.js');
  const { listRunRows } = await import('../server/dist/store.js');
  const botId = 'long-run';
  seedBot(botId);
  const request = appendRow(botId, 'message', { type: 'message', role: 'user', text: 'Prepare a brief' });
  const runId = createRun(botId, 'chat', 'Prepare a brief', undefined, request.seq);
  runContext.run({ id: runId, botId }, () => {
    for (let i = 1; i <= 85; i++) appendRow(botId, 'notice', { type: 'notice', text: `Step ${i}` });
  });
  const rows = listRunRows(botId, runId);
  assert.equal(rows.length, 80);
  assert.equal(rows[0].seq, request.seq);
  assert.equal(rows.at(-1).body.text, 'Step 85');
});

test('parseProposedMemories handles fenced JSON, prose wrappers, string items, and malformed input', async () => {
  const { parseProposedMemories } = await import('../server/dist/agent/memory.js');

  assert.deepEqual(
    parseProposedMemories('```json\n{"memories":[{"text":" Prefers concise bullets. "},{"text":""}]}\n```'),
    ['Prefers concise bullets.'],
  );
  assert.deepEqual(
    parseProposedMemories('```\n{"memories":["Works in Pacific time.", {"text":"Uses TypeScript."}]}\n```'),
    ['Works in Pacific time.', 'Uses TypeScript.'],
  );
  assert.deepEqual(
    parseProposedMemories('Here are the extracted facts:\n{"memories":[{"text":"Maintains TideBot."}]}\nDone.'),
    ['Maintains TideBot.'],
  );
  assert.deepEqual(parseProposedMemories('{"memories":"not-an-array"}'), []);
  assert.deepEqual(parseProposedMemories('not json at all'), []);
  assert.deepEqual(parseProposedMemories(''), []);
});

test('botsDueForConsolidation excludes rooms, hidden subagents, active bots, and already-consolidated bots', async () => {
  const { botsDueForConsolidation } = await import('../server/dist/agent/memory.js');
  const tNow = 10_000_000;
  const idleMs = 60_000;
  const staleAt = tNow - idleMs - 5_000;
  const freshAt = tNow - 10_000;

  seedBot('mem-agent-due');
  seedBot('mem-agent-fresh');
  seedBot('mem-agent-done');
  seedBot('mem-room');
  seedBot('mem-subagent');

  db.prepare("UPDATE bots SET kind='room' WHERE id=?").run('mem-room');
  db.prepare('UPDATE bots SET hidden=1 WHERE id=?').run('mem-subagent');

  const insertMsg = db.prepare("INSERT INTO rows(bot_id,generation,seq,updated_seq,kind,body,created_at) VALUES (?,1,1,1,'message',?,?)");
  const msgBody = JSON.stringify({ type: 'message', role: 'user', text: 'remember this' });
  insertMsg.run('mem-agent-due', msgBody, staleAt);
  insertMsg.run('mem-agent-fresh', msgBody, freshAt);
  insertMsg.run('mem-agent-done', msgBody, staleAt);
  insertMsg.run('mem-room', msgBody, staleAt);
  insertMsg.run('mem-subagent', msgBody, staleAt);

  db.prepare('INSERT INTO memory_jobs(bot_id,last_consolidated_at,last_result) VALUES (?,?,?)')
    .run('mem-agent-done', staleAt, '{}');

  const dueIds = botsDueForConsolidation(idleMs, tNow).map((b) => b.botId);
  assert.ok(dueIds.includes('mem-agent-due'), 'idle visible agent should be due');
  assert.ok(!dueIds.includes('mem-agent-fresh'), 'recently active bot should not be due');
  assert.ok(!dueIds.includes('mem-agent-done'), 'already consolidated bot should not be due');
  assert.ok(!dueIds.includes('mem-room'), 'group room must be excluded from consolidation');
  assert.ok(!dueIds.includes('mem-subagent'), 'hidden subagent must be excluded from consolidation');
});

test('consolidateBot skips rooms and hidden subagents and tolerates malformed row JSON', async () => {
  const { consolidateBot } = await import('../server/dist/agent/memory.js');
  const { saveLlmConfig } = await import('../server/dist/agent/llm.js');

  // Mark provider configured with a dummy local custom endpoint so consolidateBot reaches row parsing.
  saveLlmConfig({ provider: 'custom', customBaseUrl: 'http://127.0.0.1:1/v1', defaultModel: 'test-model' });

  seedBot('mem-skip-room');
  seedBot('mem-skip-hidden');
  seedBot('mem-corrupt-row');
  db.prepare("UPDATE bots SET kind='room' WHERE id=?").run('mem-skip-room');
  db.prepare('UPDATE bots SET hidden=1 WHERE id=?').run('mem-skip-hidden');

  const insertMsg = db.prepare("INSERT INTO rows(bot_id,generation,seq,updated_seq,kind,body,created_at) VALUES (?,1,1,1,'message',?,?)");
  insertMsg.run('mem-skip-room', JSON.stringify({ type: 'message', role: 'user', text: 'room chatter' }), 1_000);
  insertMsg.run('mem-skip-hidden', JSON.stringify({ type: 'message', role: 'user', text: 'subagent task' }), 1_000);
  insertMsg.run('mem-corrupt-row', '{not valid json', 1_000);

  assert.deepEqual(await consolidateBot('mem-skip-room', { upTo: 2_000 }), { added: [], skipped: 0, considered: 0 });
  assert.deepEqual(await consolidateBot('mem-skip-hidden', { upTo: 2_000 }), { added: [], skipped: 0, considered: 0 });
  assert.equal(db.prepare('SELECT 1 FROM memory_jobs WHERE bot_id=?').get('mem-skip-room'), undefined);
  assert.equal(db.prepare('SELECT 1 FROM memory_jobs WHERE bot_id=?').get('mem-skip-hidden'), undefined);

  // Malformed JSON row is ignored safely (no user messages -> returns without calling LLM).
  assert.deepEqual(await consolidateBot('mem-corrupt-row', { upTo: 2_000 }), { added: [], skipped: 0, considered: 0 });
});

test('memoriesForPrompt handles missing bots and malformed row bodies safely', async () => {
  const { memoriesForPrompt } = await import('../server/dist/agent/memory.js');

  seedBot('mem-prompt-bot');
  db.prepare("INSERT INTO memories(id,bot_id,text,created_at,source) VALUES (?,?,?,?,'learned')")
    .run('m-1', 'mem-prompt-bot', 'Uses PostgreSQL for analytics.', 100);
  db.prepare("INSERT INTO memories(id,bot_id,text,created_at,source) VALUES (?,?,?,?,'learned')")
    .run('m-2', 'mem-prompt-bot', 'Prefers dark roast coffee.', 200);

  // Seed one corrupt JSON row and one valid user message mentioning PostgreSQL.
  db.prepare("INSERT INTO rows(bot_id,generation,seq,updated_seq,kind,body,created_at) VALUES (?,1,1,1,'message',?,100)")
    .run('mem-prompt-bot', '{corrupt');
  db.prepare("INSERT INTO rows(bot_id,generation,seq,updated_seq,kind,body,created_at) VALUES (?,1,2,2,'message',?,200)")
    .run('mem-prompt-bot', JSON.stringify({ type: 'message', role: 'user', text: 'Check our PostgreSQL schema' }));

  const res = memoriesForPrompt('mem-prompt-bot');
  assert.equal(res.omitted, 0);
  assert.equal(res.lines[0], '- Uses PostgreSQL for analytics.', 'keyword-overlapping memory should rank first despite corrupt row');

  // Orphaned memories for a non-existent bot must not throw on bot.generation.
  db.pragma('foreign_keys = OFF');
  try {
    db.prepare("INSERT INTO memories(id,bot_id,text,created_at,source) VALUES (?,?,?,?,'learned')")
      .run('m-orphan', 'non-existent-bot', 'Orphaned fact', 300);
    assert.deepEqual(memoriesForPrompt('non-existent-bot'), { lines: [], omitted: 1 });
  } finally {
    db.prepare('DELETE FROM memories WHERE id=?').run('m-orphan');
    db.pragma('foreign_keys = ON');
  }
});

