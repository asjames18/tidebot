// Focused regression tests for the security audit fixes.
// Runs against the compiled server: `npm run build -w server` first, then `node --test tests/security.test.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isPrivateIp, isLoopbackHost, assertUrlHostAllowedSync, assertPublicUrl } from '../server/dist/lib/ssrf.js';
import { resolveWithinWorkspace } from '../server/dist/lib/files.js';

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-test-')), 'test.db');
const { validateRoutineSchedule } = await import('../server/dist/routines.js');
const { encryptSecret, decryptSecret } = await import('../server/dist/lib/secrets.js');
const { runShell, findBwrap } = await import('../server/dist/lib/sandbox.js');

test('private / reserved IPs are blocked, public IPs allowed', () => {
  for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.169.254', '127.0.0.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test('baseUrl sync check blocks private IPs but allows loopback for local models', () => {
  assert.throws(() => assertUrlHostAllowedSync('http://169.254.169.254/latest', { allowLoopback: true }), /Private/);
  assert.throws(() => assertUrlHostAllowedSync('http://192.168.1.10:1234/v1', { allowLoopback: true }), /Private/);
  assert.throws(() => assertUrlHostAllowedSync('file:///etc/passwd', { allowLoopback: true }), /http/);
  assert.equal(assertUrlHostAllowedSync('http://localhost:11434/v1', { allowLoopback: true }).hostname, 'localhost');
  assert.equal(assertUrlHostAllowedSync('https://openrouter.ai/api/v1', { allowLoopback: true }).hostname, 'openrouter.ai');
});

test('routine schedules must be valid and at least 15 minutes apart', () => {
  assert.match(validateRoutineSchedule('* * * * * *'), /too often/);
  assert.match(validateRoutineSchedule('*/5 * * * *'), /too often/);
  assert.match(validateRoutineSchedule('not-a-cron'), /Invalid schedule/);
  assert.equal(validateRoutineSchedule('0 8 * * 1-5'), null);
  assert.equal(validateRoutineSchedule('*/30 * * * *'), null);
});

test('workspace resolution rejects symlink escapes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-ws-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-out-'));
  fs.writeFileSync(path.join(root, 'ok.txt'), 'hi');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  assert.equal(resolveWithinWorkspace(root, 'link.txt'), null);
  assert.ok(resolveWithinWorkspace(root, 'ok.txt')?.endsWith('ok.txt'));
  assert.ok(resolveWithinWorkspace(root, 'new/deep/file.txt')?.endsWith(path.join('new', 'deep', 'file.txt')));
});

test('secrets encrypt at rest and decrypt back; legacy plaintext passes through', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-keys-'));
  const enc = encryptSecret(dir, 'sk-test-secret-value');
  assert.ok(enc.startsWith('enc:v1:'));
  assert.ok(!enc.includes('sk-test-secret-value'));
  assert.equal(decryptSecret(dir, enc), 'sk-test-secret-value');
  assert.equal(decryptSecret(dir, 'legacy-plain-key'), 'legacy-plain-key');
  assert.equal(fs.statSync(path.join(dir, '.secret-key')).mode & 0o777, 0o600);
});

test('shell cannot read outside its workspace or see server secrets', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-shell-'));
  const ws = path.join(base, 'data', 'workspaces', 'bot1');
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(base, 'data', 'secret.txt'), 'top-secret');
  process.env.OPENROUTER_API_KEY = 'sk-should-not-leak';
  const r = await runShell('echo marker-123; echo "env:$OPENROUTER_API_KEY up:$(cat ../../secret.txt 2>/dev/null)"', ws, 10);
  assert.ok(r.output.includes('marker-123'), r.output);
  assert.ok(!r.output.includes(process.env.OPENROUTER_API_KEY), r.output);
  if (r.sandboxed) assert.ok(!r.output.includes('top-secret'), r.output);
});

test('web fetch check blocks loopback and metadata hosts', async () => {
  assert.equal(isLoopbackHost('localhost'), true);
  await assert.rejects(() => assertPublicUrl('http://localhost:8787/api/health'), /Loopback/);
  await assert.rejects(() => assertPublicUrl('http://169.254.169.254/'), /Private/);
});
