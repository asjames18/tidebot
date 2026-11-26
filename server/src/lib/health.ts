import fs from 'node:fs';
import path from 'node:path';
import { findBwrap } from './sandbox.js';

export interface DatabaseHealth {
  path: string;
  exists: boolean;
  readable: boolean;
  writable: boolean;
}

export interface SandboxHealth {
  bubblewrap: { installed: boolean; path: string | null };
}

export interface HealthDetail {
  ok: true;
  node: string;
  database: DatabaseHealth;
  sandbox: SandboxHealth;
  /** Provider keys configured — booleans only, never the keys themselves. */
  providers: Record<string, boolean>;
}

/**
 * Filesystem-level database check: opens the file read/write to prove
 * writability but writes nothing and touches no rows. When the file does
 * not exist yet (server creates it on first start), writability is the
 * parent directory's — WAL mode needs directory writes too.
 */
export function checkDatabaseFile(dbPath: string): DatabaseHealth {
  const exists = fs.existsSync(dbPath);
  let readable = false;
  let writable = false;
  if (exists) {
    try { fs.accessSync(dbPath, fs.constants.R_OK); readable = true; } catch { /* unreadable */ }
    try {
      const fd = fs.openSync(dbPath, 'r+');
      fs.closeSync(fd);
      writable = true;
    } catch { /* not writable */ }
  } else {
    try { fs.accessSync(path.dirname(dbPath), fs.constants.W_OK); writable = true; } catch { /* no */ }
  }
  return { path: dbPath, exists, readable, writable };
}

/** Sandbox status is Bubblewrap presence; the shell path probes usability lazily when a command runs. */
export function checkSandbox(): SandboxHealth {
  const bwrap = findBwrap();
  return { bubblewrap: { installed: bwrap !== null, path: bwrap } };
}

export function buildHealthDetail(input: {
  nodeVersion: string;
  dbPath: string;
  providers: Record<string, boolean>;
}): HealthDetail {
  return {
    ok: true,
    node: input.nodeVersion,
    database: checkDatabaseFile(input.dbPath),
    sandbox: checkSandbox(),
    providers: { ...input.providers },
  };
}
