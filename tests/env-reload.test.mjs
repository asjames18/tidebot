// Regression tests for .env hot-reload key removal (Phase 5.2 secrets review).
// reloadEnvFromDisk must stop returning a key once it is deleted from .env:
// before this fix only STUDIO_ADMIN_EMAIL was cleared, so a deleted API key
// stayed live in process.env (and therefore in every opt() getter) until the
// next server restart.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-envreload-'));
after(() => {
  fs.rmSync(fixtures, { recursive: true, force: true });
  delete process.env.ENV_PATH;
});

let mtimeSeq = Date.now() + 10000;
function writeEnv(file, body) {
  fs.writeFileSync(file, body);
  // Force a strictly increasing mtime: back-to-back writes can share a
  // timestamp and the reload is keyed on mtimeMs.
  fs.utimesSync(file, new Date(mtimeSeq), new Date(mtimeSeq));
  mtimeSeq += 1000;
}

test('a key deleted from .env stops being returned and leaves process.env', async () => {
  const file = path.join(fixtures, 'a.env');
  writeEnv(file, 'OPENROUTER_API_KEY=sk-test-1\nSTUDIO_ADMIN_EMAIL=admin@example.com\n');
  process.env.ENV_PATH = file;
  const { env } = await import('../server/dist/env.js');

  assert.equal(env.openrouterKey, 'sk-test-1');
  assert.equal(process.env.OPENROUTER_API_KEY, 'sk-test-1');

  writeEnv(file, 'STUDIO_ADMIN_EMAIL=admin@example.com\n');
  assert.equal(env.openrouterKey, '');
  assert.equal(process.env.OPENROUTER_API_KEY, undefined);
  // The old STUDIO_ADMIN_EMAIL special case is subsumed by the general rule.
  writeEnv(file, '');
  assert.equal(env.openrouterKey, ''); // triggers the lazy reload first
  assert.equal(process.env.STUDIO_ADMIN_EMAIL, undefined);
});

test('a key that only ever lived in process.env is untouched by a reload', async () => {
  // Same module instance as test 1 (node caches the import): keep using the
  // same .env file, since envFilePath is captured at first import.
  const file = path.join(fixtures, 'a.env');
  writeEnv(file, 'OPENROUTER_API_KEY=sk-test-2\n');
  process.env.XAI_API_KEY = 'proc-only-key';
  const { env } = await import('../server/dist/env.js');

  assert.equal(env.openrouterKey, 'sk-test-2');
  assert.equal(env.xaiKey, 'proc-only-key');
  writeEnv(file, 'OPENROUTER_API_KEY=sk-test-3\n');
  assert.equal(env.openrouterKey, 'sk-test-3');
  assert.equal(env.xaiKey, 'proc-only-key');
  assert.equal(process.env.XAI_API_KEY, 'proc-only-key');
  delete process.env.XAI_API_KEY;
});
