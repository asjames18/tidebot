// Phase 3.3 built-in-tools audit, summaries half: every built-in tool must
// return a non-empty summary on its success paths, and error paths must
// return a plain string output without throwing. Runs against the compiled
// server: `npm run build -w server` first. Isolated from live data via
// DB_PATH. No network: web_search / fetch_webpage are only exercised on
// their early-return paths; Composio / Orgo tools are not called (no keys
// in the sandbox) — their failure mode is covered by the loop's catch in
// loop.ts, which turns a thrown impl error into a 'Tool error' output row.
//
// Deliberately NOT asserted here: delete_routine's success path has no
// summary yet — its return sits inside PR #2's open hunk, so that one line
// lands after #2 merges instead of stacking a same-hunk edit on it.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-built-in-tools-'));
process.env.DB_PATH = path.join(fixtures, 'test.db');
const { db } = await import('../server/dist/db.js');
const { TOOLS, toolMap, functionSchemas } = await import('../server/dist/agent/tools.js');
const { initSubagents } = await import('../server/dist/agent/subagents.js');
const { initRooms } = await import('../server/dist/agent/rooms.js');
const { unscheduleRoutine } = await import('../server/dist/routines.js');

initSubagents();
initRooms();

after(() => {
  try { db.close(); } finally { fs.rmSync(fixtures, { recursive: true, force: true }); }
});

db.prepare("INSERT INTO users(id,email,name,created_at) VALUES ('u1','u1@test.local','U',1)").run();
db.prepare("INSERT INTO bots(id,user_id,name,created_at,updated_at) VALUES ('b1','u1','Alpha',1,1)").run();
db.prepare("INSERT INTO bots(id,user_id,name,created_at,updated_at) VALUES ('b2','u1','Beta',1,1)").run();

const sent = [];
const ctx = {
  userId: 'u1',
  botId: 'b1',
  enqueueBotMessage: (from, to, text, depth) => { sent.push({ from, to, text, depth }); },
  depth: 0,
};
const run = (name, args = {}) => toolMap.get(name).impl(args, ctx);
const hasSummary = (res) => {
  assert.equal(typeof res.summary, 'string', `missing summary: ${String(res.output).slice(0, 120)}`);
  assert.ok(res.summary.length > 0, 'empty summary');
};

test('tool definitions are consistent: 36 unique names, descriptions, labels, schemas', () => {
  assert.equal(TOOLS.length, 36, `expected 36 built-ins, got ${TOOLS.length}`);
  assert.equal(new Set(TOOLS.map((t) => t.name)).size, TOOLS.length, 'duplicate tool name');
  for (const t of TOOLS) {
    assert.equal(typeof t.description, 'string');
    assert.ok(t.description.trim().length >= 10, `${t.name}: description too short`);
    assert.equal(typeof t.label, 'string');
    assert.ok(t.label.trim().length > 0, `${t.name}: empty label`);
    assert.equal(t.parameters?.type, 'object', `${t.name}: parameters must be an object schema`);
    const props = Object.keys(t.parameters.properties ?? {});
    for (const req of t.parameters.required ?? []) {
      assert.ok(props.includes(req), `${t.name}: required arg "${req}" not in properties`);
    }
    assert.equal(t.parameters.additionalProperties, false, `${t.name}: additionalProperties must be false`);
  }
});

test('functionSchemas prunes exactly the 7 Orgo-only tools when no Orgo key is set', () => {
  const schemas = functionSchemas();
  const names = schemas.map((s) => s.name);
  const orgoOnly = ['computer_screenshot', 'computer_click', 'computer_type', 'computer_key', 'computer_scroll', 'computer_drag', 'open_browser'];
  if (process.env.ORGO_API_KEY) {
    assert.equal(names.length, 36);
  } else {
    assert.equal(names.length, 29);
    for (const n of orgoOnly) assert.ok(!names.includes(n), `${n} should be pruned without an Orgo key`);
  }
  for (const s of schemas) assert.ok(toolMap.has(s.name), `schema for unknown tool ${s.name}`);
});

test('file tools: success paths carry summaries, missing files fail cleanly', async () => {
  const saved = await run('save_file', { filename: 'notes.md', content: 'hello' });
  assert.equal(JSON.parse(saved.output).ok, true);
  hasSummary(saved);
  assert.match(saved.summary, /Saved notes\.md/);

  const listed = await run('list_files');
  assert.equal(JSON.parse(listed.output).length, 1);
  hasSummary(listed);
  assert.match(listed.summary, /1 file/);

  const read = await run('read_file', { filename: 'notes.md' });
  assert.equal(read.output, 'hello');
  hasSummary(read);
  assert.match(read.summary, /Read notes\.md/);

  const missing = await run('read_file', { filename: 'nope.md' });
  assert.match(missing.output, /not found/i);
  assert.equal(missing.summary, undefined, 'error path needs no summary, just a readable output');

  const noPreview = await run('publish_preview', { path: 'missing.html' });
  assert.match(noPreview.output, /Not found/);

  const preview = await run('publish_preview', { path: 'notes.md' });
  assert.match(JSON.parse(preview.output).preview_url, /\/api\/preview\/b1\/notes\.md/);
  hasSummary(preview);
  assert.match(preview.summary, /Preview: notes\.md/);
});

test('memory tools: remember and recall summarise', async () => {
  const saved = await run('remember', { text: 'Antonio prefers concise replies' });
  hasSummary(saved);
  assert.equal(saved.summary, 'Saved a memory');

  const recalled = await run('recall', { query: 'concise replies' });
  assert.deepEqual(JSON.parse(recalled.output), ['Antonio prefers concise replies']);
  hasSummary(recalled);
  assert.match(recalled.summary, /1 memory found/);
});

test('routine tools: validation errors are strings, success paths summarise', async () => {
  const bad = await run('create_routine', { name: 'Bad', prompt: 'p', schedule: 'not-a-cron' });
  assert.equal(typeof bad.output, 'string');
  assert.match(bad.output, /schedule/i);

  const created = await run('create_routine', { name: 'Morning', prompt: 'say hi', schedule: '0 8 * * *' });
  const routine = JSON.parse(created.output).routine;
  assert.equal(routine.name, 'Morning');
  hasSummary(created);
  assert.match(created.summary, /Created routine Morning/);
  unscheduleRoutine(routine.id);

  const listed = await run('list_routines');
  assert.equal(JSON.parse(listed.output).length, 1);
  hasSummary(listed);
  assert.match(listed.summary, /1 routine/);

  const noSuch = await run('update_routine', { routine_id: 'rt_missing', name: 'X' });
  assert.equal(noSuch.output, 'No such routine.');

  const updated = await run('update_routine', { routine_id: routine.id, name: 'Morning v2' });
  assert.equal(JSON.parse(updated.output).routine.name, 'Morning v2');
  hasSummary(updated);
  assert.match(updated.summary, /Updated routine Morning v2/);

  const noDelete = await run('delete_routine', { routine_id: 'rt_missing' });
  assert.equal(noDelete.output, 'Routine not found.');

  const deleted = await run('delete_routine', { routine_id: routine.id });
  assert.equal(deleted.output, 'Deleted.');
});

test('task tools: create and update summarise', async () => {
  const created = await run('create_task', { title: 'Draft the follow-ups' });
  const taskId = JSON.parse(created.output).task_id;
  assert.ok(taskId);
  hasSummary(created);
  assert.match(created.summary, /Tracking Draft the follow-ups/);

  const updated = await run('update_task', { task_id: taskId, state: 'done' });
  assert.equal(updated.output, 'Updated.');
  hasSummary(updated);
  assert.equal(updated.summary, 'Updated task');
});

test('bot-to-bot tools: unknown targets fail cleanly, real ones summarise', async () => {
  const unknown = await run('send_to_bot', { bot_name: 'Nobody', message: 'hi' });
  assert.match(unknown.output, /No bot named "Nobody"/);
  assert.match(unknown.output, /Alpha, Beta/);

  const self = await run('send_to_bot', { bot_name: 'Alpha', message: 'hi' });
  assert.equal(self.output, 'That is you.');

  const sentMsg = await run('send_to_bot', { bot_name: 'Beta', message: 'hello Beta' });
  hasSummary(sentMsg);
  assert.match(sentMsg.summary, /Messaged Beta/);
  assert.equal(sent[0].to, 'b2');

  const spawned = await run('spawn_subagent', { goal: 'Research Acme', label: 'Acme research' });
  const subId = JSON.parse(spawned.output).subagent_id;
  assert.ok(subId);
  hasSummary(spawned);
  assert.match(spawned.summary, /Started /);

  const listed = await run('list_subagents');
  assert.equal(JSON.parse(listed.output).length, 1);
  hasSummary(listed);
  assert.match(listed.summary, /1 subagent/);

  const noSub = await run('message_subagent', { subagent_id: 'sub_missing', message: 'hi' });
  assert.equal(noSub.output, 'No such subagent.');

  const messaged = await run('message_subagent', { subagent_id: subId, message: 'keep going' });
  assert.equal(messaged.output, 'Sent.');
  hasSummary(messaged);
  assert.equal(messaged.summary, 'Sent to subagent');

  const stopped = await run('stop_subagent', { subagent_id: subId });
  assert.equal(stopped.output, 'Stopped and removed.');

  const noStop = await run('stop_subagent', { subagent_id: 'sub_missing' });
  assert.equal(noStop.output, 'No such subagent.');
});

test('group tools: need two bots, then summarise', async () => {
  const tooFew = await run('create_group', { name: 'Solo', bot_names: ['Alpha'] });
  assert.match(tooFew.output, /at least 2 Bots/);

  const created = await run('create_group', { name: 'Team', bot_names: ['Alpha', 'Beta'] });
  assert.equal(JSON.parse(created.output).ok, true);
  hasSummary(created);
  assert.match(created.summary, /Created group Team/);

  const noGroup = await run('post_to_group', { group_name: 'Nope', text: 'hi' });
  assert.match(noGroup.output, /No group named/);

  const posted = await run('post_to_group', { group_name: 'Team', text: 'hello team' });
  assert.equal(posted.output, 'Posted to the group.');
  hasSummary(posted);
  assert.match(posted.summary, /Posted to Team/);
  assert.equal(posted.endTurn, true);
});

test('proactivity table exists on a fresh DB without server startup', () => {
  // set_checkins used to throw "no such table: proactivity" unless
  // initProactive() had run — the table now lives in db.ts migrations.
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='proactivity'").get();
  assert.ok(row, 'proactivity table missing from fresh DB');
});

test('user-facing tools: question, draft, connection ask, check-ins, silence', async () => {
  const asked = await run('ask_user', { question: 'Which one?', options: ['A', 'B'] });
  assert.equal(asked.endTurn, true);
  hasSummary(asked);
  assert.equal(asked.summary, 'Asked the user');

  const drafted = await run('draft_message', { channel: 'email', to: 'alex@acme.com', subject: 'Hi', text: 'Hello' });
  hasSummary(drafted);
  assert.match(drafted.summary, /Drafted email to alex@acme\.com/);

  const unknownApp = await run('request_app_connection', { toolkit: 'not_a_toolkit', reason: 'need it' });
  assert.match(unknownApp.output, /Unknown toolkit/);

  const checkins = await run('set_checkins', { enabled: false });
  assert.equal(JSON.parse(checkins.output).enabled, false);
  hasSummary(checkins);
  assert.equal(checkins.summary, 'Check-ins off');

  const silent = await run('stay_silent', { reason: 'nothing to say' });
  assert.equal(silent.endTurn, true);
  hasSummary(silent);
  assert.equal(silent.summary, 'Stayed silent');
});

test('web tools: early-return paths never touch the network', async () => {
  const empty = await run('web_search', { query: '   ' });
  assert.equal(empty.output, 'Empty query.');

  const badUrl = await run('fetch_webpage', { url: 'notaurl' });
  assert.match(badUrl.output, /must start with http/);
});

test('shell tool: returns a structured result with a summary either way', async () => {
  const r = await run('shell', { command: 'echo hi' });
  const parsed = JSON.parse(r.output);
  assert.equal(typeof parsed.exit_code, 'number');
  hasSummary(r);
  assert.match(r.summary, /exit -?\d+/);
});
