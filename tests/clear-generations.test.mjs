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
