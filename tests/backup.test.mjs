import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';

const run = promisify(execFile);
const script = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'scripts', 'backup.mjs');

/** Build a fake install root: data dir with a real SQLite db + a workspace file, plus a .env. */
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-backup-test-'));
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(path.join(dataDir, 'workspaces', 'bot-1'), { recursive: true });
  const db = new Database(path.join(dataDir, 'grokbot.db'));
  db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)');
  db.prepare('INSERT INTO notes (body) VALUES (?)').run('hello from the fixture');
  db.close();
  fs.writeFileSync(path.join(dataDir, 'workspaces', 'bot-1', 'notes.txt'), 'workspace file\n');
  fs.writeFileSync(path.join(root, '.env'), 'OPENROUTER_API_KEY=sk-fake-test-key\n');
  return { root, dataDir };
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('backup copies db + workspaces, excludes .env by default, and verifies', async () => {
  const { root, dataDir } = makeFixture();
  try {
    const out = path.join(root, 'out');
    const { stdout } = await run(process.execPath, [script, '--root', root, '--out', out]);
    assert.match(stdout, /backup: 2 file\(s\)/);
    assert.match(stdout, /\.env excluded \(default\)/);
    assert.match(stdout, /integrity_check ok/);
    assert.match(stdout, /backup: verified ok/);
    assert.equal(fs.existsSync(path.join(out, '.env')), false);
    const backupDb = new Database(path.join(out, 'data', 'grokbot.db'), { readonly: true });
    try {
      assert.equal(backupDb.prepare('SELECT body FROM notes').get().body, 'hello from the fixture');
    } finally {
      backupDb.close();
    }
    assert.equal(fs.readFileSync(path.join(out, 'data', 'workspaces', 'bot-1', 'notes.txt'), 'utf8'), 'workspace file\n');
  } finally {
    cleanup(root);
  }
});

test('--include-env copies .env and warns', async () => {
  const { root } = makeFixture();
  try {
    const out = path.join(root, 'out');
    const { stdout, stderr } = await run(process.execPath, [script, '--root', root, '--out', out, '--include-env']);
    assert.equal(fs.readFileSync(path.join(out, '.env'), 'utf8'), 'OPENROUTER_API_KEY=sk-fake-test-key\n');
    assert.match(stdout, /\.env INCLUDED \(--include-env\)/);
    assert.match(stderr, /warning: --include-env copied \.env/);
  } finally {
    cleanup(root);
  }
});

test('restore: copying a backup back yields a working database (tested restore)', async () => {
  const { root } = makeFixture();
  try {
    const out = path.join(root, 'out');
    await run(process.execPath, [script, '--root', root, '--out', out]);
    // Simulate a restore into a fresh data dir: copy the backup contents back.
    const restored = path.join(root, 'restored-data');
    fs.cpSync(path.join(out, 'data'), restored, { recursive: true });
    const db = new Database(path.join(restored, 'grokbot.db'), { readonly: true });
    try {
      assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(db.prepare('SELECT body FROM notes').get().body, 'hello from the fixture');
    } finally {
      db.close();
    }
    assert.equal(fs.readFileSync(path.join(restored, 'workspaces', 'bot-1', 'notes.txt'), 'utf8'), 'workspace file\n');
    // --verify passes on the restored directory itself.
    const { stdout } = await run(process.execPath, [script, '--verify', restored]);
    assert.match(stdout, /integrity_check ok/);
  } finally {
    cleanup(root);
  }
});

test('backup fails when the data directory is missing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-backup-test-'));
  try {
    await assert.rejects(run(process.execPath, [script, '--root', root, '--out', path.join(root, 'out')]));
  } finally {
    cleanup(root);
  }
});

test('--verify fails on a database with a bad header', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-backup-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'grokbot.db'), 'not a sqlite file at all');
    await assert.rejects(run(process.execPath, [script, '--verify', dir]));
  } finally {
    cleanup(dir);
  }
});
