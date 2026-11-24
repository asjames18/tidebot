// Regression tests for RAK-32: event-trigger cleanup and routine schedule guards.
// Runs against the compiled server: `npm run build -w server` first.
// Isolated from live data via DB_PATH; never touches the network (no trigger
// with a real id is deleted through the default Composio path).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-routine-triggers-'));
process.env.DB_PATH = path.join(fixtures, 'test.db');
const { db } = await import('../server/dist/db.js');
const { migrate, deleteEventTrigger, deleteEventTriggersForBot } = await import('../server/dist/triggers.js');
const { routineScheduleChangeError } = await import('../server/dist/routines.js');

after(() => {
  try { db.close(); } finally { fs.rmSync(fixtures, { recursive: true, force: true }); }
});

migrate();
db.prepare("INSERT INTO users(id,email,name,created_at) VALUES ('u1','u1@test.local','U',1)").run();
db.prepare("INSERT INTO bots(id,user_id,name,created_at,updated_at) VALUES ('b1','u1','B',1,1)").run();
const insertRoutine = db.prepare(
  "INSERT INTO routines(id,bot_id,name,prompt,schedule,timezone,enabled,created_at,trigger_id,trigger_config) VALUES (?,?,?,?,?,'UTC',1,?,?,?)",
);
insertRoutine.run('rt_e1', 'b1', 'Email watcher', 'p', 'event:GMAIL_RECEIVED_EMAIL', 1, null, null);
insertRoutine.run('rt_e2', 'b1', 'No-trigger event', 'p', 'event:SLACK_RECEIVE_MESSAGE', 2, null, null);
db.prepare("UPDATE routines SET trigger_id='tg_1', trigger_config='{}' WHERE id='rt_e1'").run();
insertRoutine.run('rt_c', 'b1', 'Cron routine', 'p', '0 8 * * *', 3, null, null);

test('bot trigger cleanup selects only that bot event routines, in created order', async () => {
  const deleted = [];
  const ids = await deleteEventTriggersForBot('b1', async (id) => { deleted.push(id); });
  assert.deepEqual(deleted, ['rt_e1', 'rt_e2']);
  assert.deepEqual(ids, ['rt_e1', 'rt_e2']);

  db.prepare("INSERT INTO bots(id,user_id,name,created_at,updated_at) VALUES ('b2','u1','B2',1,1)").run();
  insertRoutine.run('rt_b2', 'b2', 'Other bot', 'p', 'event:GITHUB_PULL_REQUEST_EVENT', 4, null, null);
  const deleted2 = [];
  await deleteEventTriggersForBot('b1', async (id) => { deleted2.push(id); });
  assert.deepEqual(deleted2, ['rt_e1', 'rt_e2'], 'must not touch other bots routines');
});

test('deleting an event routine without a Composio trigger id is a safe no-op', async () => {
  await deleteEventTrigger('rt_e2');
  const row = db.prepare("SELECT enabled FROM routines WHERE id='rt_e2'").get();
  assert.ok(row, 'routine row untouched');
});

test('schedule conversion guard rejects event-schedule edits both ways', () => {
  assert.match(routineScheduleChangeError('0 8 * * *', 'event:GMAIL_RECEIVED_EMAIL'), /create_event_routine/);
  assert.match(routineScheduleChangeError('event:GMAIL_RECEIVED_EMAIL', '0 8 * * *'), /delete the routine/);
  assert.match(routineScheduleChangeError('event:A', 'event:B'), /delete the routine/);
  assert.equal(routineScheduleChangeError('0 8 * * *', '0 9 * * *'), null);
  assert.equal(routineScheduleChangeError('0 8 * * *', '0 8 * * *'), null);
});
