// Regression tests for RAK-32: event-trigger cleanup and routine schedule guards.
// Runs against the compiled server: `npm run build -w server` first.
// Isolated from live data via DB_PATH; never touches the network (no trigger
// with a real id is deleted through the default Composio path).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-routine-triggers-'));
process.env.DB_PATH = path.join(fixtures, 'test.db');
process.env.ENV_PATH = path.join(fixtures, '.env');
fs.writeFileSync(process.env.ENV_PATH, '');
const { db } = await import('../server/dist/db.js');
const { deleteEventTrigger, deleteEventTriggersForBot } = await import('../server/dist/triggers.js');
const { routineScheduleChangeError } = await import('../server/dist/routines.js');
const { findDueCheckinSlot, getCheckins, initProactive, noteCheckinOutcome, setCheckins } = await import('../server/dist/proactive.js');

after(() => {
  try { db.close(); } finally { fs.rmSync(fixtures, { recursive: true, force: true }); }
});

db.prepare("INSERT INTO users(id,email,name,created_at) VALUES ('u1','u1@test.local','U',1)").run();
db.prepare("INSERT INTO bots(id,user_id,name,created_at,updated_at) VALUES ('b1','u1','B',1,1)").run();
const insertRoutine = db.prepare(
  "INSERT INTO routines(id,bot_id,name,prompt,schedule,timezone,enabled,created_at,trigger_id,trigger_config) VALUES (?,?,?,?,?,'UTC',1,?,?,?)",
);
insertRoutine.run('rt_e1', 'b1', 'Email watcher', 'p', 'event:GMAIL_RECEIVED_EMAIL', 1, null, null);
insertRoutine.run('rt_e2', 'b1', 'No-trigger event', 'p', 'event:SLACK_RECEIVE_MESSAGE', 2, null, null);
db.prepare("UPDATE routines SET trigger_id='tg_1', trigger_config='{}' WHERE id='rt_e1'").run();
insertRoutine.run('rt_c', 'b1', 'Cron routine', 'p', '0 8 * * *', 3, null, null);

test('bot trigger cleanup selects only that bot event routines, in created order', async () => {
  const deleted = [];
  const ids = await deleteEventTriggersForBot('b1', async (id) => { deleted.push(id); });
  assert.deepEqual(deleted, ['rt_e1', 'rt_e2']);
  assert.deepEqual(ids, ['rt_e1', 'rt_e2']);

  db.prepare("INSERT INTO bots(id,user_id,name,created_at,updated_at) VALUES ('b2','u1','B2',1,1)").run();
  insertRoutine.run('rt_b2', 'b2', 'Other bot', 'p', 'event:GITHUB_PULL_REQUEST_EVENT', 4, null, null);
  const deleted2 = [];
  await deleteEventTriggersForBot('b1', async (id) => { deleted2.push(id); });
  assert.deepEqual(deleted2, ['rt_e1', 'rt_e2'], 'must not touch other bots routines');
});

test('deleting an event routine without a Composio trigger id is a safe no-op', async () => {
  await deleteEventTrigger('rt_e2');
  const row = db.prepare("SELECT enabled FROM routines WHERE id='rt_e2'").get();
  assert.ok(row, 'routine row untouched');
});

test('schedule conversion guard rejects event-schedule edits both ways', () => {
  assert.match(routineScheduleChangeError('0 8 * * *', 'event:GMAIL_RECEIVED_EMAIL'), /create_event_routine/);
  assert.match(routineScheduleChangeError('event:GMAIL_RECEIVED_EMAIL', '0 8 * * *'), /delete the routine/);
  assert.match(routineScheduleChangeError('event:A', 'event:B'), /delete the routine/);
  assert.equal(routineScheduleChangeError('0 8 * * *', '0 9 * * *'), null);
  assert.equal(routineScheduleChangeError('0 8 * * *', '0 8 * * *'), null);
});

test('proactive check-in store works before initProactive and validates inputs strictly', () => {
  // Without initProactive() (e.g. GROKBOT_NO_SCHEDULER=1), reads/writes must not crash with missing table.
  assert.deepEqual(getCheckins('u1'), { enabled: false, times: ['09:00', '16:30'], timezone: 'UTC' });

  const saved = setCheckins('u1', {
    enabled: true,
    times: [' 09:00 ', '09:00', 'invalid', 42, '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'],
    timezone: 'America/New_York',
  });
  assert.deepEqual(saved, {
    enabled: true,
    times: ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00'],
    timezone: 'America/New_York',
  });

  noteCheckinOutcome('u1', false);
  assert.equal(db.prepare("SELECT silent_streak FROM proactivity WHERE user_id='u1'").get().silent_streak, 1);
  noteCheckinOutcome('u1', true);
  assert.equal(db.prepare("SELECT silent_streak FROM proactivity WHERE user_id='u1'").get().silent_streak, 0);

  assert.throws(() => setCheckins('u1', { times: '09:00' }), /array/);
  assert.throws(() => setCheckins('u1', { enabled: 'yes' }), /boolean/);
  assert.throws(() => setCheckins('u1', { timezone: '' }), /Invalid timezone/);
  assert.throws(() => setCheckins('u1', { timezone: 'Mars/Olympus' }));
});

test('findDueCheckinSlot handles normal slots and midnight calendar wraparound', () => {
  assert.deepEqual(
    findDueCheckinSlot(['09:00', '16:30'], 'UTC', new Date('2026-05-10T09:03:00Z')),
    { slot: '09:00', key: '2026-05-10 09:00' },
  );
  assert.equal(findDueCheckinSlot(['09:00'], 'UTC', new Date('2026-05-10T09:05:00Z')), null);
  assert.equal(findDueCheckinSlot(['09:00'], 'UTC', new Date('2026-05-10T08:59:00Z')), null);

  // Midnight wraparound across month boundary (non-leap and leap year).
  assert.deepEqual(
    findDueCheckinSlot(['23:58'], 'UTC', new Date('2026-03-01T00:01:00Z')),
    { slot: '23:58', key: '2026-02-28 23:58' },
  );
  assert.deepEqual(
    findDueCheckinSlot(['23:58'], 'UTC', new Date('2028-03-01T00:01:00Z')),
    { slot: '23:58', key: '2028-02-29 23:58' },
  );
  assert.equal(findDueCheckinSlot(['23:58'], 'UTC', new Date('2026-03-01T00:03:00Z')), null);
});

test('checkins HTTP API rejects malformed JSON with 400 and reports /now scheduler/primary status', async () => {
  fs.writeFileSync(process.env.ENV_PATH, [
    'DEV_LOGIN=1',
    'STUDIO_EMAIL=owner@example.test',
    'STUDIO_PASSWORD=' + 'test-password',
  ].join('\n'));
  const { Hono } = await import('hono');
  const { api } = await import('../server/dist/routes.js');
  const { checkinsApi } = await import('../server/dist/routes-proactive.js');
  const app = new Hono();
  app.route('/api/checkins', checkinsApi);
  app.route('/api', api);

  const login = await app.request('/api/auth/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.test', password: 'test-password' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  // Malformed JSON and invalid types return 400 rather than 500.
  const badJson = await app.request('/api/checkins', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', cookie },
    body: '{bad json',
  });
  assert.equal(badJson.status, 400);

  const badTimes = await app.request('/api/checkins', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ times: '09:00' }),
  });
  assert.equal(badTimes.status, 400);

  // Before initProactive(), POST /now reports 503 instead of silently returning ok.
  const disabledNow = await app.request('/api/checkins/now', { method: 'POST', headers: { cookie } });
  assert.equal(disabledNow.status, 503);

  const queued = [];
  initProactive((botId, trigger) => { queued.push({ botId, trigger }); });

  // Once initialized, POST /now enqueues a check-in on the user's primary bot.
  const okNow = await app.request('/api/checkins/now', { method: 'POST', headers: { cookie } });
  assert.equal(okNow.status, 200);
  assert.deepEqual(await okNow.json(), { ok: true });
  assert.equal(queued.length, 1);
  assert.match(queued[0].trigger.text, /\[check-in\]/);
});
