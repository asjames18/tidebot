// Regression tests for atomic .env key persistence (RAK-29).
// updateEnvFile must rewrite dotenv files via temp-file + rename, must not
// leave temp files behind, and must propagate write failures instead of
// silently succeeding.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { formatEnvValue, updateEnvFile } from '../server/dist/lib/envFile.js';

const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-envfile-'));
after(() => {
  fs.rmSync(fixtures, { recursive: true, force: true });
});

// Running as root bypasses read-only directory permissions, so the
// failed-write test below cannot force its rename to fail. Skip it there;
// the other two tests still exercise updateEnvFile as root.
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

test('creates the file when missing and rejects invalid keys and values', () => {
  const file = path.join(fixtures, 'a.env');
  updateEnvFile(file, 'COMPOSIO_API_KEY', 'k-123');
  assert.equal(fs.readFileSync(file, 'utf8'), 'COMPOSIO_API_KEY=k-123');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);

  assert.throws(() => updateEnvFile(file, 'bad-key', 'v'), /Invalid env key/);
  assert.throws(() => updateEnvFile(file, 'ORGO_API_KEY', 'a\nb'), /must not contain newlines/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'COMPOSIO_API_KEY=k-123');
});

test('updates an existing key in place and preserves other lines', () => {
  const file = path.join(fixtures, 'b.env');
  fs.writeFileSync(file, '# comment\nCOMPOSIO_API_KEY=old\nOTHER_KEY=keep\n');
  updateEnvFile(file, 'COMPOSIO_API_KEY', 'new');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  assert.deepEqual(lines, ['# comment', 'COMPOSIO_API_KEY=new', 'OTHER_KEY=keep', '']);
  assert.equal(fs.readdirSync(fixtures).filter((f) => f.includes('.tmp-')).length, 0);
});

test('a failed write propagates, keeps the original file intact, and leaves no temp files', {
  skip: isRoot ? 'root bypasses read-only directory permissions' : false,
}, () => {
  const dir = path.join(fixtures, 'ro');
  fs.mkdirSync(dir);
  const file = path.join(dir, 'c.env');
  fs.writeFileSync(file, 'ORGO_API_KEY=original\n');
  fs.chmodSync(dir, 0o500); // read-only directory: rename must fail
  try {
    assert.throws(() => updateEnvFile(file, 'ORGO_API_KEY', 'changed'));
    assert.equal(fs.readFileSync(file, 'utf8'), 'ORGO_API_KEY=original\n');
  } finally {
    fs.chmodSync(dir, 0o700);
  }
  assert.equal(fs.readdirSync(dir).filter((f) => f.includes('.tmp-')).length, 0);
});

test('quotes values containing #, outer whitespace, or leading quotes so util.parseEnv round-trips verbatim', () => {
  const file = path.join(fixtures, 'quoting.env');
  const cases = [
    ['HASH_SECRET', 'my#secret#123'],
    ['PADDED_VAL', '  keep spaces  '],
    ['LEAD_QUOTE', '"starts-with-quote'],
    ['SINGLE_AND_HASH', "it's#a#secret"],
    ['SINGLE_BACKTICK_HASH', "it's`#`still-safe"],
    ['PLAIN_KEY', 'sk-plain-123'],
  ];
  for (const [k, v] of cases) {
    updateEnvFile(file, k, v);
  }
  const parsed = parseEnv(fs.readFileSync(file, 'utf8'));
  for (const [k, v] of cases) {
    assert.equal(parsed[k], v, `round-trip mismatch for ${k}`);
  }
  assert.throws(
    () => formatEnvValue(`all-three#'"\``),
    /incompatible quote characters/,
  );
});

test('deduplicates export and duplicate KEY= definitions and avoids blank lines before appended keys', () => {
  const file = path.join(fixtures, 'dedup.env');
  fs.writeFileSync(file, [
    '# header',
    'COMPOSIO_API_KEY=first',
    'OTHER_KEY=keep',
    'export COMPOSIO_API_KEY=second',
    '  COMPOSIO_API_KEY = third',
    '',
  ].join('\n'));

  updateEnvFile(file, 'COMPOSIO_API_KEY', 'updated-key');
  const rawAfterUpdate = fs.readFileSync(file, 'utf8');
  assert.deepEqual(rawAfterUpdate.split('\n'), [
    '# header',
    'COMPOSIO_API_KEY=updated-key',
    'OTHER_KEY=keep',
    '',
  ]);
  assert.equal(parseEnv(rawAfterUpdate).COMPOSIO_API_KEY, 'updated-key');

  updateEnvFile(file, 'ORGO_API_KEY', 'orgo-1');
  assert.deepEqual(fs.readFileSync(file, 'utf8').split('\n'), [
    '# header',
    'COMPOSIO_API_KEY=updated-key',
    'OTHER_KEY=keep',
    'ORGO_API_KEY=orgo-1',
    '',
  ]);
});

