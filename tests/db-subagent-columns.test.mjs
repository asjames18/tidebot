// Regression tests: subagent/room columns on bots must exist on any fresh DB
// that imports db.ts — they used to be created lazily by initSubagents() /
// initRooms() at server startup only, so tests and scripts that skipped
// index.ts hit "no such column: hidden" and every agent turn failed.
// Runs against the compiled server: `npm run build -w server` first.
// Isolated from live data via DB_PATH; never touches the network.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-db-columns-'));
process.env.DB_PATH = path.join(fixtures, 'test.db');
const { db } = await import('../server/dist/db.js');

after(() => {
  try { db.close(); } finally { fs.rmSync(fixtures, { recursive: true, force: true }); }
});

function botColumns() {
  return Object.fromEntries(
    (db.prepare('PRAGMA table_info(bots)').all())
      .map((c) => [c.name, c.dflt_value]),
  );
}

test('fresh DB has the subagent/room columns without initSubagents/initRooms', () => {
  const cols = botColumns();
  assert.equal(cols.hidden, '0'); // PRAGMA reports defaults as strings
  assert.ok('parent_bot_id' in cols, 'parent_bot_id missing');
  assert.equal(cols.kind, "'agent'");
  assert.ok('members' in cols, 'members missing');
});

test('bot rows can use the subagent and room shapes directly', () => {
  db.prepare("INSERT INTO users(id,email,name,created_at) VALUES ('u1','u1@test.local','U',1)").run();
  const insert = db.prepare(
    "INSERT INTO bots(id,user_id,name,created_at,updated_at,hidden,parent_bot_id,kind,members) VALUES (?,?,?,?,?,?,?,?,?)",
  );
  insert.run('p1', 'u1', 'Parent', 1, 1, 0, null, 'agent', null);
  insert.run('s1', 'u1', 'Sub', 1, 1, 1, 'p1', 'agent', null);
  insert.run('r1', 'u1', 'Room', 1, 1, 0, null, 'room', '["p1","s1"]');
  const sub = db.prepare('SELECT hidden, parent_bot_id FROM bots WHERE id=?').get('s1');
  assert.equal(sub.hidden, 1);
  assert.equal(sub.parent_bot_id, 'p1');
  const room = db.prepare('SELECT kind, members FROM bots WHERE id=?').get('r1');
  assert.equal(room.kind, 'room');
  assert.deepEqual(JSON.parse(room.members), ['p1', 's1']);
  const visible = db.prepare('SELECT id FROM bots WHERE user_id=? AND COALESCE(hidden,0)=0 ORDER BY id').all('u1');
  assert.deepEqual(visible.map((r) => r.id), ['p1', 'r1']);
});

test('initSubagents/initRooms stay safe no-ops after the migration', async () => {
  const { initSubagents } = await import('../server/dist/agent/subagents.js');
  const { initRooms } = await import('../server/dist/agent/rooms.js');
  initSubagents();
  initRooms();
  const cols = botColumns();
  assert.equal(cols.hidden, '0');
  assert.equal(cols.kind, "'agent'");
});
