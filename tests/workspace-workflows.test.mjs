import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';

const fixture = await mkdtemp(join(tmpdir(), 'tidebot-workspace-workflows-'));
Object.assign(process.env, {
  DB_PATH: join(fixture, 'workspace.db'),
  ENV_PATH: join(fixture, '.env'),
  STUDIO_EMAIL: 'tester@example.test',
  STUDIO_PASSWORD: 'workspace-fixture-password',
  TIDEBOT_DESKTOP_SIGNUP_ORIGIN: 'http://127.0.0.1:8787',
  ORGO_API_KEY: '',
});
const { db } = await import('../server/dist/db.js');
const { api } = await import('../server/dist/routes.js');
const { configApi } = await import('../server/dist/routes-config.js');
const { roomsApi } = await import('../server/dist/routes-rooms.js');
const { initSubagents } = await import('../server/dist/agent/subagents.js');
const { initRooms } = await import('../server/dist/agent/rooms.js');
initSubagents();
initRooms();

after(async () => {
  db.close();
  await rm(fixture, { recursive: true, force: true });
});

const app = new Hono();
app.route('/api/rooms', roomsApi);
app.route('/api', api);
app.route('/api', configApi);

const login = await app.request('/api/auth/password', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: process.env.STUDIO_EMAIL, password: process.env.STUDIO_PASSWORD }),
});
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie').split(';')[0];
const call = (path, method = 'GET', body) => app.request(`/api${path}`, {
  method, headers: { cookie, 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

test('the first desktop account manages local provider settings without a studio administrator', async (t) => {
  const configuredAdmin = process.env.STUDIO_EMAIL;
  delete process.env.STUDIO_EMAIL;
  t.after(async () => {
    process.env.STUDIO_EMAIL = configuredAdmin;
    await rm(process.env.ENV_PATH, { force: true });
  });

  const origin = process.env.TIDEBOT_DESKTOP_SIGNUP_ORIGIN;
  const request = (path, { method = 'GET', body, cookie = '' } = {}) =>
    app.request(`${origin}/api${path}`, {
      method, headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  const signUp = async (email) => {
    const response = await request('/auth/create-local-account', {
      method: 'POST', body: { email, password: 'local-fixture-password' },
    });
    assert.equal(response.status, 201);
    return response.headers.get('set-cookie').split(';')[0];
  };
  const owner = await signUp('desktop-first@example.test');
  const member = await signUp('desktop-second@example.test');
  const settings = (cookie) => request('/llm/config?scope=studio', { cookie });
  assert.equal((await settings(owner)).status, 200);
  assert.equal((await settings(member)).status, 403);
  const capabilities = await (await request('/llm/personal', { cookie: owner })).json();
  assert.equal(capabilities.canManageStudio, true);
  assert.equal(capabilities.canInvite, false);

  const key = 'fixture-composio-key';
  const save = (cookie) => request('/llm/config', {
    method: 'PUT', body: { composioKey: key }, cookie,
  });
  assert.equal((await save(member)).status, 403);
  const saved = await save(owner);
  assert.equal(saved.status, 200);
  const publicConfig = await saved.text();
  assert.equal(JSON.parse(publicConfig).hasComposioKey, true);
  assert.ok(!publicConfig.includes(key));

  process.env.STUDIO_EMAIL = configuredAdmin;
  assert.equal((await settings(owner)).status, 403);
  assert.equal((await call('/llm/config?scope=studio')).status, 200);
});

test('desktop upgrade assigns the oldest existing local password account', () => {
  const legacyPath = join(fixture, 'legacy-desktop.db');
  const legacy = new Database(legacyPath);
  legacy.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, avatar_url TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE local_passwords (user_id TEXT PRIMARY KEY REFERENCES users(id), password_hash TEXT NOT NULL, desktop_only INTEGER NOT NULL DEFAULT 0);
    INSERT INTO users (id,email,name,created_at) VALUES
      ('member', 'member@example.test', 'Member', 1),
      ('owner', 'owner@example.test', 'Owner', 2),
      ('other', 'other@example.test', 'Other', 3);
    INSERT INTO local_passwords VALUES ('member', 'fixture-hash', 0), ('owner', 'fixture-hash', 1), ('other', 'fixture-hash', 1);
  `);
  legacy.close();
  const owner = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { db } from './server/dist/db.js';
    process.stdout.write(db.prepare('SELECT user_id FROM desktop_owner').get().user_id);
    db.close();
  `], { env: { ...process.env, DB_PATH: legacyPath }, cwd: new URL('../', import.meta.url), encoding: 'utf8' });
  assert.equal(owner, 'owner');
});
const { bots: [primary] } = await (await call('/bots')).json();

test('Library downloads preserve a Unicode name and report missing local files', async () => {
  const files = `/bots/${primary.id}/files`;
  const name = 'notes/测试 café.md';
  const content = 'Keep this note.';
  assert.equal((await call(files, 'POST', { path: name, content })).status, 200);
  const link = await call(files + '/download', 'POST', { path: name });
  assert.equal(link.status, 200);
  const { url } = await link.json();
  const download = await app.request(url, { headers: { cookie } });
  assert.equal(download.status, 200);
  assert.ok(download.headers.get('content-disposition').includes("filename*=UTF-8''" + encodeURIComponent('测试 café.md')));
  assert.equal(await download.text(), content);
  assert.equal((await call(files + '/download', 'POST', { path: 'missing.txt' })).status, 404);
});

test('group creation and updates require two different operators', async () => {
  const duplicate = await call('/rooms', 'POST', { name: 'Duplicate', botIds: [primary.id, primary.id] });
  assert.equal(duplicate.status, 400);
  const { bot: teammate } = await (await call('/bots', 'POST', { name: 'Teammate' })).json();
  const room = await call('/rooms', 'POST', { name: 'Workroom', botIds: [primary.id, teammate.id] });
  assert.equal(room.status, 200);
  const { id } = await room.json();
  assert.equal((await call(`/rooms/${id}/members`, 'PUT', { botIds: [teammate.id] })).status, 400);
  const { members } = await (await call(`/rooms/${id}/members`)).json();
  assert.equal(members.length, 2);
});

test('a new database supports deleting a routine without starting the scheduler', async () => {
  const path = `/bots/${primary.id}/routines`;
  const response = await call(path, 'POST', { name: 'Notes', prompt: 'Write a note', schedule: '0 9 * * *', timezone: 'UTC' });
  assert.equal(response.status, 200);
  const { routine } = await response.json();
  assert.equal((await call(`/routines/${routine.id}`, 'DELETE')).status, 200);
  assert.equal((await (await call(path)).json()).routines.length, 0);
});

test('setup verifies a new OpenRouter key before storing it', async (t) => {
  const { getLlmConfig } = await import('../server/dist/agent/llm.js');
  const { user } = await (await call('/auth/me')).json();
  const sampleKey = 'sk-or-v1-' + 'a'.repeat(64);
  const rejectedKey = 'sk-or-v1-' + 'b'.repeat(64);
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.origin, 'https://openrouter.ai');
    assert.equal(url.pathname, '/api/v1/chat/completions');
    const body = options?.body ? JSON.parse(options.body) : await input.clone().json();
    assert.equal(body.model, 'openrouter/free');
    const headers = new Headers(options?.headers ?? input.headers);
    if (headers.get('authorization') === 'Bearer ' + rejectedKey) {
      return Response.json({ error: { message: 'Rejected fixture key: ' + rejectedKey } }, { status: 401 });
    }
    assert.equal(headers.get('authorization'), 'Bearer ' + sampleKey);
    return Response.json({ choices: [{ message: { content: 'Fixture reply.' } }] });
  });
  const connect = (openrouterKey) => call('/llm/personal/connect', 'POST', { openrouterKey, defaultModel: 'thinkingmachines/inkling-2-small:free' });
  assert.equal((await (await connect(sampleKey)).json()).ok, true);
  assert.equal(getLlmConfig(user.id).openrouterKey, sampleKey);
  assert.equal(getLlmConfig(user.id).defaultModel, 'openrouter/free');
  const rejected = await (await connect(rejectedKey)).json();
  assert.equal(rejected.ok, false);
  assert.ok(!rejected.error.includes(rejectedKey));
  assert.equal(getLlmConfig(user.id).openrouterKey, sampleKey);
});
