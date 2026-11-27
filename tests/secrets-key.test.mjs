import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encryptSecret, decryptSecret } from '../server/src/lib/secrets.ts';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-secrets-'));

test('fresh dir: encrypt/decrypt round-trips and the key file is created 0600', t => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const enc = encryptSecret(dir, 'sk-test-key');
  assert.match(enc, /^enc:v1:/);
  assert.equal(decryptSecret(dir, enc), 'sk-test-key');
  const file = path.join(dir, '.secret-key');
  assert.equal(fs.readFileSync(file, 'utf8').trim().length, 43); // 32 bytes base64url
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('pre-seeded valid key file is used and left untouched', t => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const key = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(path.join(dir, '.secret-key'), key, { mode: 0o600 });
  const enc = encryptSecret(dir, 'hello');
  assert.equal(decryptSecret(dir, enc), 'hello');
  assert.equal(fs.readFileSync(path.join(dir, '.secret-key'), 'utf8'), key);
});

test('corrupt key file: encrypt throws, decrypt returns empty, file is untouched', t => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, '.secret-key');
  fs.writeFileSync(file, 'this-is-not-a-key', { mode: 0o600 });
  assert.throws(() => encryptSecret(dir, 'sk-x'), /corrupt/);
  assert.throws(() => encryptSecret(dir, 'sk-x'), new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(fs.readFileSync(file, 'utf8'), 'this-is-not-a-key');
  // Decrypt keeps its existing contract ('' = no key configured) — the loud
  // signal is the warning log plus the encrypt throw, not a decrypt throw.
  assert.equal(decryptSecret(dir, 'enc:v1:AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAA'), '');
});

test('corrupt key file: the warning is logged exactly once per process', t => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, '.secret-key'), 'garbage', { mode: 0o600 });
  const seen = [];
  const orig = console.error;
  console.error = (...args) => { seen.push(args.join(' ')); };
  t.after(() => { console.error = orig; });
  decryptSecret(dir, 'enc:v1:AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAA');
  decryptSecret(dir, 'enc:v1:AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAA');
  assert.equal(seen.filter(m => m.includes('SECURITY') && m.includes('.secret-key')).length, 1);
});

test('empty and short key files are corrupt, not silently replaced', t => {
  for (const contents of ['', 'aGVsbG8=']) { // '' and 5 bytes base64url
    const dir = tmpDir();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, '.secret-key'), contents, { mode: 0o600 });
    assert.throws(() => encryptSecret(dir, 'sk-x'), /corrupt/);
    assert.equal(fs.readFileSync(path.join(dir, '.secret-key'), 'utf8'), contents);
  }
});

test('legacy plaintext values pass through decrypt untouched', t => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(decryptSecret(dir, 'sk-plain-legacy'), 'sk-plain-legacy');
  assert.equal(decryptSecret(dir, ''), '');
  assert.equal(encryptSecret(dir, ''), '');
});

test('missing or read-only data dir fails loudly instead of encrypting under an unpersisted key', t => {
  const base = tmpDir();
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  const missingDir = path.join(base, 'does-not-exist');
  assert.throws(() => encryptSecret(missingDir, 'sk-secret'), /could not be created/);
  assert.equal(fs.existsSync(path.join(missingDir, '.secret-key')), false);

  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (!isRoot) {
    const roDir = path.join(base, 'readonly');
    fs.mkdirSync(roDir, { mode: 0o500 });
    t.after(() => { try { fs.chmodSync(roDir, 0o700); } catch {} });
    assert.throws(() => encryptSecret(roDir, 'sk-secret'), /could not be created/);
    assert.equal(fs.existsSync(path.join(roDir, '.secret-key')), false);
  }
});

test('non-base64url characters in .secret-key are rejected as corrupt even if decoded length is 32', t => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const valid = crypto.randomBytes(32).toString('base64url');
  const polluted = `!!!${valid}@@@`;
  assert.equal(Buffer.from(polluted, 'base64url').length, 32);
  fs.writeFileSync(path.join(dir, '.secret-key'), polluted, { mode: 0o600 });
  assert.throws(() => encryptSecret(dir, 'sk-secret'), /corrupt/);
});

test('decryptSecret rejects truncated GCM auth tags, wrong IV lengths, and extra segments', t => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const enc = encryptSecret(dir, 'sk-real-secret');
  const [ivB, tagB, ctB] = enc.slice('enc:v1:'.length).split('.');
  // Extra segment
  assert.equal(decryptSecret(dir, `${enc}.extra`), '');
  // Truncated 8-byte auth tag (even if forged/matching prefix)
  const shortTag = Buffer.from(tagB, 'base64url').subarray(0, 8).toString('base64url');
  assert.equal(decryptSecret(dir, `enc:v1:${ivB}.${shortTag}.${ctB}`), '');
  // Wrong IV length (8 bytes instead of 12)
  const shortIv = Buffer.from(ivB, 'base64url').subarray(0, 8).toString('base64url');
  assert.equal(decryptSecret(dir, `enc:v1:${shortIv}.${tagB}.${ctB}`), '');
  // Valid payload still decrypts cleanly
  assert.equal(decryptSecret(dir, enc), 'sk-real-secret');
});

