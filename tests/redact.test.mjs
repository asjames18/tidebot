// Regression tests for the central log-redaction helper (Phase 5.2, issue #35)
// and Orgo computer lifecycle error redaction / screen ID safety.
// redactSecrets must replace every known key value — env keys and extra
// (DB-decrypted) values passed by the caller — with [redacted], including
// inside Error messages/stacks, and must never throw.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-redact-'));
process.env.DB_PATH = path.join(fixtures, 'test.db');
process.env.ENV_PATH = path.join(fixtures, '.env');
fs.writeFileSync(process.env.ENV_PATH, '');

const { redactSecrets } = await import('../server/dist/lib/redact.js');
const { db } = await import('../server/dist/db.js');
const { hub } = await import('../server/dist/lib/hub.js');
const { orgo } = await import('../server/dist/orgo.js');
const { computerState, ensureComputer, formatComputerError, parseScreenDisplayNumber, screenFor } = await import('../server/dist/computer.js');

after(() => {
  try { db.close(); } finally { fs.rmSync(fixtures, { recursive: true, force: true }); }
});

test('redacts an env key value from plain text', () => {
  process.env.OPENROUTER_API_KEY = 'sk-or-fake-key-0123456789';
  const out = redactSecrets('mint failed: bad key sk-or-fake-key-0123456789 here');
  assert.equal(out, 'mint failed: bad key [redacted] here');
  delete process.env.OPENROUTER_API_KEY;
});

test('redacts an extra (DB-decrypted) secret passed by the caller', () => {
  const out = redactSecrets('error body mentions db-key-abcdef123456', ['db-key-abcdef123456']);
  assert.equal(out, 'error body mentions [redacted]');
});

test('leaves short values alone', () => {
  const out = redactSecrets('the word short stays', ['short']);
  assert.equal(out, 'the word short stays');
});

test('redacts inside an Error message', () => {
  process.env.XAI_API_KEY = 'xai-fake-key-9876543210';
  const err = new Error('mint failed for xai-fake-key-9876543210');
  const out = redactSecrets(err);
  assert.match(out, /Error: mint failed for \[redacted\]/);
  assert.doesNotMatch(out, /xai-fake-key-9876543210/);
  delete process.env.XAI_API_KEY;
});

test('longest secret wins when one contains the other', () => {
  const out = redactSecrets('key=abcdefghijklmnop end', ['abcdefghij', 'abcdefghijklmnop']);
  assert.equal(out, 'key=[redacted] end');
});

test('stringifies non-string input and never throws', () => {
  assert.equal(redactSecrets(42), '42');
  assert.equal(redactSecrets(null), '');
  assert.equal(redactSecrets(undefined), '');
});

test('parseScreenDisplayNumber strictly accepts numeric screen IDs only', () => {
  assert.equal(parseScreenDisplayNumber('screen-2'), '2');
  assert.equal(parseScreenDisplayNumber('12'), '12');
  assert.equal(parseScreenDisplayNumber('default'), null);
  assert.equal(parseScreenDisplayNumber('screen-1; rm -rf /'), null);
  assert.equal(parseScreenDisplayNumber('$(whoami)'), null);
  assert.equal(parseScreenDisplayNumber(''), null);
});

test('formatComputerError redacts ORGO_API_KEY and caps error length', () => {
  process.env.ORGO_API_KEY = 'orgo-secret-key-999999';
  try {
    const out = formatComputerError(new Error('Orgo rejected orgo-secret-key-999999\nwith details'));
    assert.equal(out, 'Orgo rejected [redacted] with details');
    assert.ok(!out.includes('orgo-secret-key-999999'));
    const longOut = formatComputerError('x'.repeat(500), 100);
    assert.equal(longOut.length, 100);
    assert.ok(longOut.endsWith('…'));
  } finally {
    delete process.env.ORGO_API_KEY;
  }
});

test('ensureComputer redacts persisted/SSE errors and fails fast on error status', async (t) => {
  db.prepare("INSERT INTO users(id,email,name,created_at) VALUES ('u_comp','c@test.local','C',1)").run();
  process.env.ORGO_API_KEY = 'orgo-leak-test-key-12345';
  const sseEvents = [];
  const unsub = hub.subscribe('u_comp', (ev) => sseEvents.push(ev));
  t.after(() => {
    unsub();
    delete process.env.ORGO_API_KEY;
  });

  t.mock.method(orgo, 'workspaces', async () => {
    throw new Error('upstream auth failed for orgo-leak-test-key-12345');
  });
  await assert.rejects(() => ensureComputer('u_comp'), /upstream auth failed/);
  const st = computerState('u_comp');
  assert.equal(st.status, 'error');
  assert.match(st.error, /\[redacted\]/);
  assert.ok(!st.error.includes('orgo-leak-test-key-12345'));
  assert.ok(sseEvents.every((ev) => !JSON.stringify(ev).includes('orgo-leak-test-key-12345')));

  // Fail fast when VM transitions to 'error' during boot instead of waiting 240s.
  t.mock.method(orgo, 'workspaces', async () => [{ id: 'ws_1' }]);
  t.mock.method(orgo, 'createComputer', async () => ({ id: 'vm_1', status: 'creating' }));
  t.mock.method(orgo, 'getComputer', async () => ({ id: 'vm_1', status: 'error' }));
  const started = Date.now();
  await assert.rejects(() => ensureComputer('u_comp'), /entered an error state/);
  assert.ok(Date.now() - started < 1000, 'waitRunning must fail immediately on error status');
});

test('screenFor skips prepareScreen bash when Orgo returns a non-numeric screen ID', async (t) => {
  db.prepare("INSERT INTO users(id,email,name,created_at) VALUES ('u_scr','s@test.local','S',1)").run();
  db.prepare("INSERT INTO bots(id,user_id,name,is_primary,created_at,updated_at) VALUES ('b_scr','u_scr','Bot',0,1,1)").run();
  db.prepare("INSERT INTO computers(user_id,orgo_id,status,updated_at) VALUES ('u_scr','vm_ok','running',1)").run();

  const bashCalls = [];
  t.mock.method(orgo, 'getComputer', async () => ({ id: 'vm_ok', status: 'running' }));
  t.mock.method(orgo, 'listScreens', async () => []);
  t.mock.method(orgo, 'createScreen', async () => ({ id: 'screen-1;touch /tmp/pwn' }));
  t.mock.method(orgo, 'bash', async (_cid, _sid, cmd) => { bashCalls.push(cmd); return { exit_code: 0, output: '' }; });

  const leased = await screenFor('u_scr', 'b_scr');
  assert.equal(leased.screenId, 'screen-1;touch /tmp/pwn');
  assert.deepEqual(bashCalls, [], 'prepareScreen must not run bash for a non-numeric screen ID');
});
