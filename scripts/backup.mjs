#!/usr/bin/env node
/**
 * Back up TideBot's local state (Phase 2.3 plan item: one-click export /
 * backup of the full local state, keys excluded by default, tested restore).
 *
 * What it copies: everything under the data directory — the SQLite database
 * (grokbot.db plus its -wal/-shm sidecars when present), workspaces, and any
 * other files the server keeps there. Settings live in the database, so they
 * come along with it.
 *
 * What it does NOT copy by default: `.env` (provider keys, session secret,
 * passwords). Pass `--include-env` only if you deliberately want the keys in
 * the backup — the script prints a warning when you do, and the backup
 * directory must then be stored somewhere private.
 *
 * Usage:
 *   npm run backup [-- --root <install root>] [--data-dir <dir>] [--out <dir>] [--include-env]
 *   node scripts/backup.mjs --verify <backup-or-data dir>
 *
 * Defaults: root is the checkout this script lives in; data dir is $DB_PATH
 * or <root>/data (the same resolution server/src/env.ts uses); output is
 * <root>/backups/tidebot-YYYYMMDD-HHMMSS.
 *
 * Stop the server first for a consistent backup. If grokbot.db-wal is
 * non-empty the server may still be running and the copy may be
 * inconsistent — the script warns and continues so a scheduled backup is
 * still attempted, but do not trust that copy until --verify passes.
 *
 * Verification runs automatically after every backup: file inventory
 * (count + bytes) is compared source vs copy, the database header is
 * checked, and PRAGMA integrity_check runs against the COPY when
 * better-sqlite3 is installed (skipped with a note otherwise). Restore is
 * the reverse copy: stop the server, copy the backup contents back over
 * the data directory, run --verify on it, start the server.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usageError(message) {
  console.error(`error: ${message}`);
  console.error('usage: node scripts/backup.mjs [--root <dir>] [--data-dir <dir>] [--out <dir>] [--include-env]');
  console.error('       node scripts/backup.mjs --verify <backup-or-data dir>');
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { root: repoRoot, dataDir: null, out: null, includeEnv: false, verify: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--include-env') opts.includeEnv = true;
    else if (arg === '--root' || arg === '--data-dir' || arg === '--out' || arg === '--verify') {
      const value = argv[++i];
      if (!value) usageError(`${arg} needs a value`);
      if (arg === '--root') opts.root = path.resolve(value);
      else if (arg === '--data-dir') opts.dataDir = path.resolve(value);
      else if (arg === '--out') opts.out = path.resolve(value);
      else opts.verify = path.resolve(value);
    } else if (arg === '--help' || arg === '-h') {
      console.log('Backs up TideBot local state (database + workspaces). See the header comment for details.');
      process.exit(0);
    } else {
      usageError(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

function inventory(dir) {
  const files = listFiles(dir);
  let bytes = 0;
  for (const f of files) bytes += fs.statSync(f).size;
  return { files, count: files.length, bytes };
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
    // Symlinks and special files are not part of TideBot state; skip them.
  }
}

/** Check a database file: SQLite magic header, then integrity_check when possible. */
async function checkDatabase(dbPath) {
  const header = fs.readFileSync(dbPath).subarray(0, 16).toString('latin1');
  if (header !== 'SQLite format 3\0') return { ok: false, detail: 'bad SQLite header' };
  let Database;
  try {
    ({ default: Database } = await import('better-sqlite3'));
  } catch {
    return { ok: true, detail: 'header ok (integrity_check skipped: better-sqlite3 not installed)' };
  }
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare('PRAGMA integrity_check').get();
    if (row?.integrity_check === 'ok') return { ok: true, detail: 'integrity_check ok' };
    return { ok: false, detail: `integrity_check failed: ${JSON.stringify(row)}` };
  } finally {
    db.close();
  }
}

async function verifyDir(dir) {
  const inv = inventory(dir);
  console.log(`verify: ${inv.count} file(s), ${inv.bytes} byte(s) in ${dir}`);
  const dbPath = path.join(dir, 'grokbot.db');
  if (!fs.existsSync(dbPath)) {
    console.log('verify: no grokbot.db in this directory (nothing database-shaped to check)');
    return true;
  }
  const check = await checkDatabase(dbPath);
  console.log(`verify: grokbot.db ${check.detail}`);
  return check.ok;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.verify) {
    if (!fs.existsSync(opts.verify) || !fs.statSync(opts.verify).isDirectory()) {
      usageError(`--verify target is not a directory: ${opts.verify}`);
    }
    process.exit((await verifyDir(opts.verify)) ? 0 : 1);
  }

  const dataDir = opts.dataDir ?? (process.env.DB_PATH
    ? path.dirname(path.resolve(process.env.DB_PATH))
    : path.join(opts.root, 'data'));
  if (!fs.existsSync(dataDir) || !fs.statSync(dataDir).isDirectory()) {
    usageError(`data directory not found: ${dataDir}`);
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const outDir = opts.out ?? path.join(opts.root, 'backups', `tidebot-${stamp}`);
  if (path.resolve(outDir) === path.resolve(dataDir) || path.resolve(outDir).startsWith(path.resolve(dataDir) + path.sep)) {
    usageError('backup output must not live inside the data directory');
  }
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0) {
    usageError(`backup output already exists and is not empty: ${outDir}`);
  }

  const walPath = path.join(dataDir, 'grokbot.db-wal');
  if (fs.existsSync(walPath) && fs.statSync(walPath).size > 0) {
    console.error('warning: grokbot.db-wal is non-empty — the server may still be running.');
    console.error('warning: stop the server first for a consistent backup; verifying the copy below.');
  }

  const sourceInv = inventory(dataDir);
  copyTree(dataDir, path.join(outDir, 'data'));

  const envPath = path.join(opts.root, '.env');
  let envIncluded = false;
  if (opts.includeEnv) {
    if (fs.existsSync(envPath)) {
      fs.copyFileSync(envPath, path.join(outDir, '.env'));
      envIncluded = true;
      console.error('warning: --include-env copied .env (provider keys, session secret, passwords) into the backup.');
      console.error('warning: store this backup somewhere private — anyone with it has your keys.');
    } else {
      console.error('warning: --include-env given but no .env found at the install root; nothing extra copied.');
    }
  }

  const backupDataDir = path.join(outDir, 'data');
  const backupInv = inventory(backupDataDir);
  if (backupInv.count !== sourceInv.count || backupInv.bytes !== sourceInv.bytes) {
    console.error(`error: inventory mismatch after copy (source ${sourceInv.count} files/${sourceInv.bytes} bytes, backup ${backupInv.count} files/${backupInv.bytes} bytes)`);
    process.exit(1);
  }

  console.log(`backup: ${backupInv.count} file(s), ${backupInv.bytes} byte(s) -> ${outDir}`);
  console.log(`backup: .env ${envIncluded ? 'INCLUDED (--include-env)' : 'excluded (default)'}`);
  const verified = await verifyDir(backupDataDir);
  if (!verified) {
    console.error('error: backup verification failed — do not trust this copy');
    process.exit(1);
  }
  console.log('backup: verified ok');
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
