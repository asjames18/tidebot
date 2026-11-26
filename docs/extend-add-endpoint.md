# Tutorial: add an API endpoint

> **Last verified:** 2026-11-26 · **Owner:** asjames18 (maintainer)

Add a read-only endpoint the studio can call. You will add
`GET /api/bots/:id/stats` — message, task, and memory counts for one of the
caller's own bots — and finish with a passing test and a live `curl` check.
No keys, no network, no new dependencies.

This is tutorial 2 of 4 in the Phase 4 extension series: built-in tool, API endpoint,
model provider, WebGL shader preset.

## How endpoints work

Four parts, and the route itself is the smallest:

1. **One route on the `api` Hono app** in `server/src/routes.ts` (chat, bots,
   routines, tasks) — or `server/src/routes-config.ts` for
   settings/library/BYOM endpoints, `server/src/routes-rooms.ts` for rooms.
   The app is mounted at `/api` in `server/src/index.ts`.
2. **Sessions are automatic.** Everything below the `api.use('/*', …)`
   middleware in `routes.ts` requires a session; `c.get('user')` is the
   signed-in user. The only skips are `/api/auth/*`, `/api/apps/callback`,
   and `/api/health`. No cookie means a 401 — there is nothing to add for
   auth on a normal endpoint.
3. **Ownership is one helper.** `ownBot(userId, id)` returns the bot row only
   when it belongs to the caller, otherwise `null`. A per-bot endpoint that
   skips it leaks other users' bots — return 404 on `null`, never a
   different user's data.
4. **A typed client method** in `web/src/lib/api.ts`, so the studio calls the
   endpoint through the same `req()` helper as every other call.

Conventions to follow: errors are `{ error: '…' }` with a status
(400 bad input, 404 not found, 409 conflict, 503 not configured); per-user
JSON responses carry `Cache-Control: no-store` (see `GET /projects`); POST
bodies that accept user data use `bodyLimit` (see the 384 KB project limit).
Plain GETs are not rate-limited — the limits in `index.ts` cover
`/api/auth/*`, `/api/llm/*`, and `/api/voice/*` only.

## Step 1 — Add the stats helper

Keep the SQL in its own module so the route stays a thin wrapper and the
logic is testable without HTTP. Create `server/src/bot-stats.ts`:

```ts
// Per-bot activity counts for the studio (used by GET /api/bots/:id/stats).
// Pure SQL over the same tables /system/status already aggregates — no new
// tables, no network, no model calls.
import { db } from './db.js';

export interface BotStats {
  messages: number;
  tasksOpen: number;
  tasksDone: number;
  memories: number;
}

/** Counts for one of the caller's own bots, or null when the bot does not
 *  exist or belongs to someone else. Callers turn null into a 404. */
export function botStats(userId: string, botId: string): BotStats | null {
  const bot = db.prepare('SELECT 1 FROM bots WHERE id=? AND user_id=?').get(botId, userId);
  if (!bot) return null;
  const count = (sql: string, ...params: unknown[]) =>
    (db.prepare(sql).get(...params) as { n: number }).n;
  return {
    messages: count("SELECT COUNT(*) n FROM rows WHERE bot_id=? AND kind='message'", botId),
    tasksOpen: count("SELECT COUNT(*) n FROM tasks WHERE bot_id=? AND state<>'done'", botId),
    tasksDone: count("SELECT COUNT(*) n FROM tasks WHERE bot_id=? AND state='done'", botId),
    memories: count('SELECT COUNT(*) n FROM memories WHERE bot_id=?', botId),
  };
}
```

Notes on the queries:

- `messages` counts only `kind='message'` rows. Tool-call and card rows live
  in the same table and must not inflate the count — the test pins this.
- Task states mirror `/system/status`: anything that is not `'done'` is open.
- The ownership check is the first query. The counts never run for a bot the
  caller does not own.

## Step 2 — Add the route

In `server/src/routes.ts`, import the helper next to the other imports and
add the route after `GET /releases/latest`:

```ts
import { botStats } from './bot-stats.js';
```

```ts
api.get('/bots/:id/stats', (c) => {
  const stats = botStats(c.get('user').id, c.req.param('id'));
  if (!stats) return c.json({ error: 'not found' }, 404);
  return c.json(stats);
});
```

That is the whole route. Session handling comes from the middleware above
it; `c.req.param('id')` is the `:id` segment.

## Step 3 — Add the typed client method

In `web/src/lib/api.ts`, add the response type next to `SearchResults` and
one line on the `api` object:

```ts
export interface BotStats {
  messages: number;
  tasksOpen: number;
  tasksDone: number;
  memories: number;
}
```

```ts
  botStats: (id: string) => req<BotStats>('GET', `/bots/${id}/stats`),
```

`req()` sends `credentials: 'include'`, parses the error JSON into an
`ApiError` on failure, and returns the parsed body on success. Components
call `api.botStats(bot.id)` and get a typed result — no raw `fetch` in UI
code.

## Step 4 — Add a test

Create `tests/bot-stats.test.mjs` and add it to the `test` script in
`package.json` (node `--test` list, next to `tests/release-notice.test.mjs`):

```js
// Regression tests for the "Add an API endpoint" tutorial
// (docs/extend-add-endpoint.md). The stats helper is pure SQL over the
// tables /system/status already aggregates — no network, no model calls.
// Runs against a throwaway DB via DB_PATH, never the dev database.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// One throwaway DB for the whole file: db.js opens the database at import
// time, so the path must be set before the first import and shared after.
const dir = await mkdtemp(path.join(tmpdir(), 'tidebot-stats-'));
after(() => rm(dir, { recursive: true, force: true }));
process.env.DB_PATH = path.join(dir, 'test.db');
const { db } = await import('../server/dist/db.js');
const { botStats } = await import('../server/dist/bot-stats.js');

const now = Date.now();
db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run('usr_1', 'a@example.com', 'A', now);
db.prepare('INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)').run('usr_2', 'b@example.com', 'B', now);
db.prepare(
  'INSERT INTO bots(id,user_id,name,label,description,instructions,avatar_shape,avatar_color,mode,model,is_primary,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
).run('bot_1', 'usr_1', 'Quinn', '', '', '', 'blob', 'blue', 'personal', '', 1, now, now);
const row = db.prepare(
  'INSERT INTO rows(bot_id,generation,seq,updated_seq,kind,body,created_at,run_id) VALUES (?,?,?,?,?,?,?,?)',
);
row.run('bot_1', 1, 1, 1, 'message', '{"type":"message","role":"user","text":"hi"}', now, null);
row.run('bot_1', 1, 2, 2, 'message', '{"type":"message","role":"assistant","text":"hello"}', now, null);
row.run('bot_1', 1, 3, 3, 'message', '{"type":"message","role":"user","text":"again"}', now, null);
row.run('bot_1', 1, 4, 4, 'tool-call', '{"type":"tool-call","name":"read_file"}', now, null);
row.run('bot_1', 1, 5, 5, 'card', '{"type":"card"}', now, null);
const task = db.prepare(
  'INSERT INTO tasks(id,bot_id,title,state,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
);
task.run('tsk_1', 'bot_1', 'Open one', 'working', '', now, now);
task.run('tsk_2', 'bot_1', 'Open two', 'working', '', now, now);
task.run('tsk_3', 'bot_1', 'Done one', 'done', '', now, now);
db.prepare('INSERT INTO memories(id,bot_id,text,created_at) VALUES (?,?,?,?)').run('mem_1', 'bot_1', 'likes tea', now);
db.prepare('INSERT INTO memories(id,bot_id,text,created_at) VALUES (?,?,?,?)').run('mem_2', 'bot_1', 'prefers mornings', now);

test('botStats counts messages, tasks, and memories for your own bot', () => {
  // Only kind='message' rows count — the tool-call and card rows do not.
  assert.deepEqual(botStats('usr_1', 'bot_1'), { messages: 3, tasksOpen: 2, tasksDone: 1, memories: 2 });
});

test('botStats returns null for another user’s bot and for an unknown bot', () => {
  assert.equal(botStats('usr_2', 'bot_1'), null);
  assert.equal(botStats('usr_1', 'bot_nope'), null);
});

test('botStats reports all zeros for a bot with no activity', () => {
  db.prepare(
    'INSERT INTO bots(id,user_id,name,label,description,instructions,avatar_shape,avatar_color,mode,model,is_primary,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run('bot_2', 'usr_1', 'Empty', '', '', '', 'blob', 'blue', 'personal', '', 0, now, now);
  assert.deepEqual(botStats('usr_1', 'bot_2'), { messages: 0, tasksOpen: 0, tasksDone: 0, memories: 0 });
});
```

Two things the test taught us, kept as comments in the file: `db.js` opens
the database at import time, so `DB_PATH` must be set first and the whole
file shares one throwaway DB (a `?query` re-import does not give a fresh
database, because the helper imports `./db.js` without the query). And the
seed data must use the real column lists — `rows` has a `run_id` column added
by migration, not just the `CREATE TABLE` list.

## Step 5 — Verify live

Run `npm run typecheck && npm run build && npm test`, then check the
endpoint over HTTP against a throwaway database. `DEV_LOGIN=1` enables the
dev sign-in used for local testing only:

```bash
DB_PATH=/tmp/tidebot-stats.db DEV_LOGIN=1 PORT=8899 node server/dist/index.js &
curl -s -c cookies.txt -X POST http://127.0.0.1:8899/api/auth/dev \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","name":"You"}'
BOTID=$(curl -s -b cookies.txt -X POST http://127.0.0.1:8899/api/bots \
  -H 'Content-Type: application/json' -d '{"name":"SmokeBot"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['bot']['id'])")
curl -s -b cookies.txt http://127.0.0.1:8899/api/bots/$BOTID/stats
# {"messages":0,"tasksOpen":0,"tasksDone":0,"memories":0}
curl -s -o /dev/null -w "%{http_code}\n" -b cookies.txt \
  http://127.0.0.1:8899/api/bots/bot_nope/stats
# 404
curl -s -o /dev/null -w "%{http_code}\n" \
  http://127.0.0.1:8899/api/bots/$BOTID/stats
# 401 — no session cookie
```

Expected: a fresh bot reports all zeros, an unknown bot is a 404, and the
same request without a cookie is a 401. Seeding one message row and one open
task in the throwaway DB should move the response to
`{"messages":1,"tasksOpen":1,"tasksDone":0,"memories":0}`. Kill the server
and delete the throwaway DB when done — never run this against your real
`data/grokbot.db`.

## What this tutorial does not cover

- **Mutating endpoints.** A POST/PATCH/DELETE follows the same shape, but
  validate the body (see `emailAddress()` and the invite route), use
  `bodyLimit`, and return 201 for a created resource.
- **New route files.** Split a route out of `routes.ts` only when it owns a
  whole area (rooms, proactive check-ins) — a single endpoint stays in the
  file its neighbours live in.
- **Realtime updates.** If the UI must refresh when the counts change, emit
  through `hub` and listen on the SSE stream (`GET /api/events`) instead of
  polling the endpoint.
