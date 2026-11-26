// After npm ci && npm run build: tsx --tsconfig web/tsconfig.json --test tests/pending-approvals.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pendingApprovalCounts } from '../server/src/lib/approvals.ts';

function seed() {
  const dir = mkdtempSync(join(tmpdir(), 'tidebot-pending-'));
  const db = new Database(join(dir, 'test.db'));
  db.exec(`CREATE TABLE bots (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE approvals (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, row_seq INTEGER NOT NULL, call_id TEXT NOT NULL, tool TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, resolved_at INTEGER);`);
  return { dir, db };
}

function addBot(db, id, userId) {
  db.prepare('INSERT INTO bots(id, user_id) VALUES (?, ?)').run(id, userId);
}

function addApproval(db, id, botId, status = 'pending') {
  db.prepare("INSERT INTO approvals(id, bot_id, row_seq, call_id, tool, status, created_at) VALUES (?, ?, 1, 'c1', 'shell', ?, 1)").run(id, botId, status);
}

test('counts pending approvals per bot', (t) => {
  const { dir, db } = seed();
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  addBot(db, 'bot-a', 'u1');
  addBot(db, 'bot-b', 'u1');
  addApproval(db, 'apr-1', 'bot-a');
  addApproval(db, 'apr-2', 'bot-a');
  addApproval(db, 'apr-3', 'bot-b');
  assert.deepEqual(pendingApprovalCounts(db, 'u1'), { 'bot-a': 2, 'bot-b': 1 });
});

test('resolved, expired, and denied approvals are not counted', (t) => {
  const { dir, db } = seed();
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  addBot(db, 'bot-a', 'u1');
  addApproval(db, 'apr-1', 'bot-a', 'pending');
  addApproval(db, 'apr-2', 'bot-a', 'allowed');
  addApproval(db, 'apr-3', 'bot-a', 'expired');
  addApproval(db, 'apr-4', 'bot-a', 'denied');
  assert.deepEqual(pendingApprovalCounts(db, 'u1'), { 'bot-a': 1 });
});

test('another user’s bots are not counted', (t) => {
  const { dir, db } = seed();
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  addBot(db, 'bot-a', 'u1');
  addBot(db, 'bot-b', 'u2');
  addApproval(db, 'apr-1', 'bot-a');
  addApproval(db, 'apr-2', 'bot-b');
  assert.deepEqual(pendingApprovalCounts(db, 'u1'), { 'bot-a': 1 });
  assert.deepEqual(pendingApprovalCounts(db, 'u2'), { 'bot-b': 1 });
});

test('no pending approvals returns an empty map', (t) => {
  const { dir, db } = seed();
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  addBot(db, 'bot-a', 'u1');
  addApproval(db, 'apr-1', 'bot-a', 'allowed');
  assert.deepEqual(pendingApprovalCounts(db, 'u1'), {});
  assert.deepEqual(pendingApprovalCounts(db, 'nobody'), {});
});
