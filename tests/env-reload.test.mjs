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

test('deleting .env revokes all keys it provided while preserving external process.env keys', async () => {
  const file = path.join(fixtures, 'a.env');
  writeEnv(file, 'OPENROUTER_API_KEY=sk-revoked\nCOMPOSIO_API_KEY=comp-revoked\n');
  process.env.ORGO_API_KEY = 'external-orgo';
  const { env } = await import('../server/dist/env.js');

  assert.equal(env.openrouterKey, 'sk-revoked');
  assert.equal(env.composioKey, 'comp-revoked');
  assert.equal(env.orgoKey, 'external-orgo');

  fs.unlinkSync(file);

  assert.equal(env.openrouterKey, '');
  assert.equal(env.composioKey, '');
  assert.equal(process.env.OPENROUTER_API_KEY, undefined);
  assert.equal(process.env.COMPOSIO_API_KEY, undefined);
  assert.equal(env.orgoKey, 'external-orgo');
  delete process.env.ORGO_API_KEY;
});

test('reloads changes when file size changes even with an identical mtime', async () => {
  const file = path.join(fixtures, 'a.env');
  const fixedTime = new Date(mtimeSeq);
  fs.writeFileSync(file, 'OPENROUTER_API_KEY=sk-short\n');
  fs.utimesSync(file, fixedTime, fixedTime);
  const { env } = await import('../server/dist/env.js');
  assert.equal(env.openrouterKey, 'sk-short');

  fs.writeFileSync(file, 'OPENROUTER_API_KEY=sk-much-longer-key\n');
  fs.utimesSync(file, fixedTime, fixedTime);
  assert.equal(env.openrouterKey, 'sk-much-longer-key');
});

test('numeric and provider env getters normalize valid values and fall back safely on invalid input', async () => {
  const file = path.join(fixtures, 'a.env');
  const { env } = await import('../server/dist/env.js');

  writeEnv(file, [
    'PORT=not-a-port',
    'ORGO_RAM_GB=-4',
    'ORGO_CPU=0',
    'LLM_PROVIDER=XAI',
    'XAI_API_KEY=xai-1',
  ].join('\n') + '\n');

  assert.equal(env.port, 8787);
  assert.equal(env.serverUrl, 'http://localhost:8787');
  assert.equal(env.orgoRamGb, 8);
  assert.equal(env.orgoCpu, 2);
  assert.equal(env.llmProvider, 'xai');

  writeEnv(file, 'PORT=99999\nLLM_PROVIDER=bogus\nLLM_BASE_URL=http://localhost:11434/v1\n');
  assert.equal(env.port, 8787);
  assert.equal(env.llmProvider, 'custom');

  writeEnv(file, 'PORT=4000\nORGO_RAM_GB=16\nORGO_CPU=4\n');
  assert.equal(env.port, 4000);
  assert.equal(env.orgoRamGb, 16);
  assert.equal(env.orgoCpu, 4);
});

