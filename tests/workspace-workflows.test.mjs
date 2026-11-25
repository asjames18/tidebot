import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';

const fixture = await mkdtemp(join(tmpdir(), 'tidebot-workspace-workflows-'));
Object.assign(process.env, {
  DB_PATH: join(fixture, 'workspace.db'),
  ENV_PATH: join(fixture, '.env'),
  STUDIO_EMAIL: 'tester@example.test',
  STUDIO_PASSWORD: 'workspace-fixture-password',
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
