// Regression tests for issue #34: Composio and Orgo API keys saved via UI
// must be AES-256-GCM encrypted in SQLite llm_settings with .env fallback,
// never written to .env in plaintext.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-composio-orgo-'));
const dbPath = path.join(fixtures, 'test.db');
const envPath = path.join(fixtures, '.env');
process.env.DB_PATH = dbPath;
process.env.ENV_PATH = envPath;
delete process.env.COMPOSIO_API_KEY;
delete process.env.ORGO_API_KEY;

const { db } = await import('../server/dist/db.js');
const {
  getComposioKey,
  getConfiguredProviders,
  getOrgoKey,
  getPublicLlmConfig,
  saveLlmConfig,
} = await import('../server/dist/agent/llm.js');

after(() => {
  try { db.close(); } finally { fs.rmSync(fixtures, { recursive: true, force: true }); }
});

test('saveLlmConfig encrypts Composio and Orgo keys in SQLite without writing plaintext to .env', () => {
  const initialEnv = 'DEV_LOGIN=1\n';
  fs.writeFileSync(envPath, initialEnv, 'utf8');

  const composioKey = 'ak_fixture_composio_secret_1234567890';
  const orgoKey = 'orgo_fixture_desktop_secret_0987654321';

  const pub = saveLlmConfig({ composioKey, orgoKey });
  assert.equal(pub.hasComposioKey, true);
  assert.equal(pub.hasOrgoKey, true);
  assert.ok(!JSON.stringify(pub).includes(composioKey));
  assert.ok(!JSON.stringify(pub).includes(orgoKey));
  assert.match(pub.composioKeyHint ?? '', /^ak_fix••••7890$/);
  assert.match(pub.orgoKeyHint ?? '', /^orgo_f••••4321$/);

  // .env must NOT be modified with plaintext keys
  assert.equal(fs.readFileSync(envPath, 'utf8'), initialEnv);

  // Raw DB columns must store AES-256-GCM ciphertext, not plaintext
  const row = db.prepare('SELECT composio_key, orgo_key FROM llm_settings WHERE id = 1').get();
  assert.ok(row.composio_key.startsWith('enc:v1:'), `expected encrypted composio_key, got ${row.composio_key}`);
  assert.ok(row.orgo_key.startsWith('enc:v1:'), `expected encrypted orgo_key, got ${row.orgo_key}`);
  assert.notEqual(row.composio_key, composioKey);
  assert.notEqual(row.orgo_key, orgoKey);

  // Runtime getters and provider flags reflect the decrypted keys
  assert.equal(getComposioKey(), composioKey);
  assert.equal(getOrgoKey(), orgoKey);
  const providers = getConfiguredProviders();
  assert.equal(providers.composio, true);
  assert.equal(providers.orgo, true);

  // Updating unrelated settings preserves the encrypted keys
  saveLlmConfig({ defaultModel: 'fixture/model' });
  assert.equal(getComposioKey(), composioKey);
  assert.equal(getOrgoKey(), orgoKey);
  const afterRow = db.prepare('SELECT composio_key, orgo_key FROM llm_settings WHERE id = 1').get();
  assert.equal(afterRow.composio_key, row.composio_key);
  assert.equal(afterRow.orgo_key, row.orgo_key);
});

test('.env COMPOSIO_API_KEY and ORGO_API_KEY serve as fallback when DB columns are empty', () => {
  const envComposio = 'ak_env_fallback_composio_key_1111';
  const envOrgo = 'orgo_env_fallback_key_2222';
  fs.writeFileSync(envPath, `COMPOSIO_API_KEY=${envComposio}\nORGO_API_KEY=${envOrgo}\n`, 'utf8');

  // DB values currently saved take precedence over .env
  assert.notEqual(getComposioKey(), envComposio);
  assert.notEqual(getOrgoKey(), envOrgo);

  // Clearing DB columns falls back cleanly to .env
  saveLlmConfig({ composioKey: '', orgoKey: '' });
  assert.equal(getComposioKey(), envComposio);
  assert.equal(getOrgoKey(), envOrgo);
  const pub = getPublicLlmConfig();
  assert.equal(pub.hasComposioKey, true);
  assert.equal(pub.hasOrgoKey, true);
});

test('migration adds composio_key and orgo_key columns to pre-existing llm_settings tables', () => {
  const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-legacy-llm-'));
  const legacyDbPath = path.join(legacyDir, 'legacy.db');
  try {
    const legacy = new Database(legacyDbPath);
    legacy.exec(`
      CREATE TABLE llm_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        provider TEXT NOT NULL DEFAULT 'openrouter',
        openrouter_key TEXT NOT NULL DEFAULT '',
        xai_key TEXT NOT NULL DEFAULT '',
        custom_base_url TEXT NOT NULL DEFAULT '',
        custom_api_key TEXT NOT NULL DEFAULT '',
        default_model TEXT NOT NULL DEFAULT '',
        shader_style TEXT NOT NULL DEFAULT 'aurora',
        updated_at INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO llm_settings (id, provider, default_model) VALUES (1, 'openrouter', 'legacy/model');
    `);
    legacy.close();

    const out = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { db } from './server/dist/db.js';
         import { saveLlmConfig, getComposioKey, getOrgoKey } from './server/dist/agent/llm.js';
         saveLlmConfig({ composioKey: 'ak_migrated_123456', orgoKey: 'orgo_migrated_654321' });
         const cols = db.prepare('PRAGMA table_info(llm_settings)').all().map((c) => c.name);
         console.log(JSON.stringify({ cols, composio: getComposioKey(), orgo: getOrgoKey() }));
         db.close();`,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, DB_PATH: legacyDbPath, ENV_PATH: path.join(legacyDir, '.env') },
        encoding: 'utf8',
      },
    );
    const parsed = JSON.parse(out.trim());
    assert.ok(parsed.cols.includes('composio_key'));
    assert.ok(parsed.cols.includes('orgo_key'));
    assert.equal(parsed.composio, 'ak_migrated_123456');
    assert.equal(parsed.orgo, 'orgo_migrated_654321');
  } finally {
    fs.rmSync(legacyDir, { recursive: true, force: true });
  }
});
