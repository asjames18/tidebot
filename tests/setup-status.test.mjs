// Tests for the first-run wizard setup-status helper (plan §2.2).
// The helper is pure reads over the tables the wizard steps already depend
// on — no network, no model calls. Runs against a throwaway DB via DB_PATH
// and an empty .env via ENV_PATH, never the dev database.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = await mkdtemp(path.join(tmpdir(), 'tidebot-setup-'));
after(() => rm(dir, { recursive: true, force: true }));
process.env.DB_PATH = path.join(dir, 'test.db');
const envFile = path.join(dir, '.env');
await writeFile(envFile, '');
process.env.ENV_PATH = envFile;
// A studio-wide OpenRouter key counts as "model configured" for any user.
process.env.OPENROUTER_API_KEY = 'test-openrouter-key-not-a-real-key';
const { db } = await import('../server/dist/db.js');
const { setupStatus } = await import('../server/dist/setup-status.js');

const now = Date.now();
db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run('usr_1', 'a@example.com', 'A', now);
db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run('usr_2', 'b@example.com', 'B', now);
const addBot = db.prepare(
  'INSERT INTO bots(id,user_id,name,label,description,instructions,avatar_shape,avatar_color,mode,model,is_primary,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
);
const addRun = db.prepare(
  'INSERT INTO agent_runs(id,bot_id,source,title,routine_id,state,created_at,started_at,finished_at,summary) VALUES (?,?,?,?,?,?,?,?,?,?)',
);

test('setupStatus reports model configured but nothing else for a fresh user', () => {
  assert.deepEqual(setupStatus('usr_1'), {
    modelConfigured: true,
    provider: 'openrouter',
    defaultModel: 'openrouter/free',
    hasOperator: false,
    hasCompletedRun: false,
    setupComplete: false,
  });
});

test('setupStatus flips hasOperator when the user creates an Operator', () => {
  addBot.run('bot_1', 'usr_1', 'Quinn', '', '', '', 'blob', 'blue', 'personal', '', 1, now, now);
  const s = setupStatus('usr_1');
  assert.equal(s.hasOperator, true);
  assert.equal(s.hasCompletedRun, false);
  assert.equal(s.setupComplete, false);
});

test('setupStatus counts only finished runs, and only for your own bots', () => {
  // A still-running run does not count.
  addRun.run('run_1', 'bot_1', 'chat', 'Hello', null, 'running', now, now, null, null);
  assert.equal(setupStatus('usr_1').hasCompletedRun, false);
  // A finished run does.
  addRun.run('run_2', 'bot_1', 'chat', 'Hello', null, 'done', now, now, now, 'did it');
  assert.equal(setupStatus('usr_1').hasCompletedRun, true);
  assert.equal(setupStatus('usr_1').setupComplete, true);
  // Another user's Operator and finished run do not leak into your status.
  addBot.run('bot_2', 'usr_2', 'Other', '', '', '', 'blob', 'blue', 'personal', '', 1, now, now);
  addRun.run('run_3', 'bot_2', 'chat', 'Hello', null, 'done', now, now, now, 'did it');
  assert.deepEqual(setupStatus('usr_2'), {
    modelConfigured: true,
    provider: 'openrouter',
    defaultModel: 'openrouter/free',
    hasOperator: true,
    hasCompletedRun: true,
    setupComplete: true,
  });
  assert.equal(setupStatus('usr_1').hasCompletedRun, true);
});

test('setupStatus reports model unconfigured once the key is gone', () => {
  delete process.env.OPENROUTER_API_KEY;
  const s = setupStatus('usr_1');
  assert.equal(s.modelConfigured, false);
  assert.equal(s.setupComplete, false);
  assert.equal(s.hasOperator, true);
  assert.equal(s.hasCompletedRun, true);
});
