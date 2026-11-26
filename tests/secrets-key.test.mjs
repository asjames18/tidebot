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
