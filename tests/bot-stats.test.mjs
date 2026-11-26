// Regression tests for the "Add an API endpoint" tutorial
// (docs/extend-add-endpoint.md). The stats helper is pure SQL over the
// tables /system/status already aggregates — no network, no model calls.
// Runs against a throwaway DB via DB_PATH, never the dev database.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// One throwaway DB for the whole file: db.js opens the database at import
// time, so the path must be set before the first import and shared after.
const dir = await mkdtemp(path.join(tmpdir(), 'tidebot-stats-'));
after(() => rm(dir, { recursive: true, force: true }));
process.env.DB_PATH = path.join(dir, 'test.db');
const { db } = await import('../server/dist/db.js');
const { botStats } = await import('../server/dist/bot-stats.js');

const now = Date.now();
db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run('usr_1', 'a@example.com', 'A', now);
db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run('usr_2', 'b@example.com', 'B', now);
db.prepare(
  'INSERT INTO bots(id,user_id,name,label,description,instructions,avatar_shape,avatar_color,mode,model,is_primary,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
).run('bot_1', 'usr_1', 'Quinn', '', '', '', 'blob', 'blue', 'personal', '', 1, now, now);
const row = db.prepare(
  'INSERT INTO rows(bot_id,generation,seq,updated_seq,kind,body,created_at,run_id) VALUES (?,?,?,?,?,?,?,?)',
);
row.run('bot_1', 1, 1, 1, 'message', '{"type":"message","role":"user","text":"hi"}', now, null);
row.run('bot_1', 1, 2, 2, 'message', '{"type":"message","role":"assistant","text":"hello"}', now, null);
row.run('bot_1', 1, 3, 3, 'message', '{"type":"message","role":"user","text":"again"}', now, null);
row.run('bot_1', 1, 4, 4, 'tool-call', '{"type":"tool-call","name":"read_file"}', now, null);
row.run('bot_1', 1, 5, 5, 'card', '{"type":"card"}', now, null);
const task = db.prepare(
  'INSERT INTO tasks(id,bot_id,title,state,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
);
task.run('tsk_1', 'bot_1', 'Open one', 'working', '', now, now);
task.run('tsk_2', 'bot_1', 'Open two', 'working', '', now, now);
task.run('tsk_3', 'bot_1', 'Done one', 'done', '', now, now);
db.prepare('INSERT INTO memories(id,bot_id,text,created_at) VALUES (?,?,?,?)').run('mem_1', 'bot_1', 'likes tea', now);
db.prepare('INSERT INTO memories(id,bot_id,text,created_at) VALUES (?,?,?,?)').run('mem_2', 'bot_1', 'prefers mornings', now);

test('botStats counts messages, tasks, and memories for your own bot', () => {
  // Only kind='message' rows count — the tool-call and card rows do not.
  assert.deepEqual(botStats('usr_1', 'bot_1'), { messages: 3, tasksOpen: 2, tasksDone: 1, memories: 2 });
});

test('botStats returns null for another user’s bot and for an unknown bot', () => {
  assert.equal(botStats('usr_2', 'bot_1'), null);
  assert.equal(botStats('usr_1', 'bot_nope'), null);
});

test('botStats reports all zeros for a bot with no activity', () => {
  db.prepare(
    'INSERT INTO bots(id,user_id,name,label,description,instructions,avatar_shape,avatar_color,mode,model,is_primary,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run('bot_2', 'usr_1', 'Empty', '', '', '', 'blob', 'blue', 'personal', '', 0, now, now);
  assert.deepEqual(botStats('usr_1', 'bot_2'), { messages: 0, tasksOpen: 0, tasksDone: 0, memories: 0 });
});
