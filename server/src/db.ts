import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.js';

fs.mkdirSync(path.dirname(env.dbPath), { recursive: true });
export const db = new Database(env.dbPath);
try { fs.chmodSync(path.dirname(env.dbPath), 0o700); } catch { /* best effort */ }
try { fs.chmodSync(env.dbPath, 0o600); } catch { /* best effort */ }
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS login_attempts (
  id TEXT PRIMARY KEY,
  provisional_user_id TEXT NOT NULL,
  connected_account_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS computers (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  orgo_id TEXT,
  status TEXT NOT NULL DEFAULT 'absent',
  error TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS screens (
  bot_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  screen_id TEXT NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  avatar_shape TEXT NOT NULL DEFAULT 'blob',
  avatar_color TEXT NOT NULL DEFAULT 'blue',
  mode TEXT NOT NULL DEFAULT 'personal',
  is_primary INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  effort TEXT NOT NULL DEFAULT 'medium',
  generation INTEGER NOT NULL DEFAULT 1,
  next_seq INTEGER NOT NULL DEFAULT 1,
  rev INTEGER NOT NULL DEFAULT 0,
  unread INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rows (
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  updated_seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (bot_id, generation, seq)
);
CREATE INDEX IF NOT EXISTS rows_rev ON rows(bot_id, updated_seq);
CREATE TABLE IF NOT EXISTS llm_items (
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  item TEXT NOT NULL,
  PRIMARY KEY (bot_id, generation, idx)
);
CREATE TABLE IF NOT EXISTS pending_turns (
  bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
  state TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  row_seq INTEGER NOT NULL,
  call_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE TABLE IF NOT EXISTS policies (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  mode TEXT NOT NULL,
  PRIMARY KEY (user_id, tool)
);
CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  schedule TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'working',
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS composio_sessions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL
);
`);

// Idempotent column migrations for tables that predate a column.
function addColumn(table: string, col: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
}
db.exec(`
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  routine_id TEXT,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  summary TEXT
);
CREATE INDEX IF NOT EXISTS agent_runs_bot ON agent_runs(bot_id);
`);
addColumn('rows', 'run_id', 'TEXT');
db.exec('CREATE INDEX IF NOT EXISTS rows_run ON rows(bot_id, run_id, seq) WHERE run_id IS NOT NULL');
db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  instructions TEXT NOT NULL,
  files TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_owner ON projects(user_id);
`);
addColumn('bots', 'project_id', 'TEXT REFERENCES projects(id) ON DELETE SET NULL');
addColumn('bots', 'voice', "TEXT NOT NULL DEFAULT 'luna'");
addColumn('bots', 'voice_speed', 'REAL NOT NULL DEFAULT 1');
addColumn('bots', 'voice_language', "TEXT NOT NULL DEFAULT 'auto'");
addColumn('bots', 'model', "TEXT NOT NULL DEFAULT ''");
// Subagent/room columns used to be created lazily by initSubagents() /
// initRooms() at server startup, so any entry point that skips index.ts
// (tests, scripts) hit "no such column: hidden" on a fresh DB and every
// agent turn failed in systemPrompt. Create them with the other migrations
// instead; the lazy ALTERs remain as harmless no-ops.
addColumn('bots', 'hidden', 'INTEGER NOT NULL DEFAULT 0');
addColumn('bots', 'parent_bot_id', 'TEXT');
addColumn('bots', 'kind', "TEXT NOT NULL DEFAULT 'agent'");
addColumn('bots', 'members', 'TEXT');
addColumn('auth_sessions', 'verified', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'verified_account', 'INTEGER NOT NULL DEFAULT 0');
addColumn('routines', 'trigger_id', 'TEXT');
addColumn('routines', 'trigger_config', 'TEXT');
db.exec('UPDATE users SET verified_account=1 WHERE verified_account=0 AND id IN (SELECT user_id FROM auth_sessions WHERE verified=1)');
db.exec(`
  CREATE TABLE IF NOT EXISTS local_passwords (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS account_invites (
    token_hash TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS personal_models (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    openrouter_key TEXT NOT NULL DEFAULT '',
    default_model TEXT NOT NULL DEFAULT ''
  );
`);
addColumn('local_passwords', 'desktop_only', 'INTEGER NOT NULL DEFAULT 0');
db.exec(`
  CREATE TABLE IF NOT EXISTS desktop_owner (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    user_id TEXT REFERENCES local_passwords(user_id) ON DELETE SET NULL
  );
`);
if (env.desktopSignupOrigin) {
  // Existing desktop installs keep the first local password account as their owner.
  db.exec(`
    INSERT OR IGNORE INTO desktop_owner (id, user_id)
    SELECT 1, user_id FROM local_passwords WHERE desktop_only = 1 ORDER BY rowid LIMIT 1;
  `);
}
// Older builds could attach an existing workspace desktop to more than one account.
// Disconnect those ambiguous assignments without touching the remote desktops.
db.transaction(() => {
  const shared = db.prepare('SELECT orgo_id FROM computers WHERE orgo_id IS NOT NULL GROUP BY orgo_id HAVING COUNT(*) > 1').all() as { orgo_id: string }[];
  const clearScreens = db.prepare('DELETE FROM screens WHERE user_id IN (SELECT user_id FROM computers WHERE orgo_id=?)');
  const detach = db.prepare("UPDATE computers SET orgo_id=NULL,status='absent',error=NULL WHERE orgo_id=?");
  for (const { orgo_id } of shared) {
    clearScreens.run(orgo_id);
    detach.run(orgo_id);
  }
})();

db.exec(`
CREATE TABLE IF NOT EXISTS llm_settings (
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
`);

export const now = () => Date.now();
