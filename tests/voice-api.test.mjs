// Regression tests for voice API input validation, callId ownership, LIKE
// backslash escaping, regional STT language normalization, and error redaction.
// Runs against the compiled server with mocked fetch — no live keys, no network.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-voice-api-'));
process.env.DB_PATH = path.join(fixtures, 'test.db');
process.env.ENV_PATH = path.join(fixtures, '.env');
fs.writeFileSync(process.env.ENV_PATH, [
  'DEV_LOGIN=1',
  'STUDIO_EMAIL=owner@example.test',
  'STUDIO_PASSWORD=' + 'test-password',
  'XAI_API_KEY=xai-fixture-secret-key-987654',
].join('\n'));

const { Hono } = await import('hono');
const { db } = await import('../server/dist/db.js');
const { api } = await import('../server/dist/routes.js');
const { appendRow } = await import('../server/dist/store.js');
const { escapeLikeQuery, normalizeSttLanguage } = await import('../server/dist/voice.js');

after(() => {
  try { db.close(); } finally { fs.rmSync(fixtures, { recursive: true, force: true }); }
});

const app = new Hono();
app.route('/api', api);

async function signInOwner() {
  const res = await app.request('/api/auth/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.test', password: 'test-password' }),
  });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const botsRes = await app.request('/api/bots', { headers: { cookie } });
  const { bots } = await botsRes.json();
  return { cookie, botId: bots[0].id };
}

test('escapeLikeQuery escapes backslashes and wildcards, and normalizeSttLanguage handles regional codes', () => {
  assert.equal(escapeLikeQuery('C:\\Users\\100%_test'), 'C:\\\\Users\\\\100\\%\\_test');
  assert.equal(normalizeSttLanguage('es-MX'), 'es');
  assert.equal(normalizeSttLanguage('pt-BR'), 'pt');
  assert.equal(normalizeSttLanguage('ar-EG'), 'ar');
  assert.equal(normalizeSttLanguage('EN'), 'en');
  assert.equal(normalizeSttLanguage('auto'), null);
  assert.equal(normalizeSttLanguage(''), null);
  assert.equal(normalizeSttLanguage('invalid!lang'), null);
});

test('voice /tool and /end reject malformed JSON with 400 and search_conversations escapes backslashes', async () => {
  const { cookie, botId } = await signInOwner();

  const badTool = await app.request('/api/voice/tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: '{bad json',
  });
  assert.equal(badTool.status, 400);

  const badEnd = await app.request('/api/voice/end', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: '{bad json',
  });
  assert.equal(badEnd.status, 400);

  appendRow(botId, 'message', { type: 'message', role: 'user', text: 'Saved to C:\\Users\\demo\\100%_report.txt' });
  appendRow(botId, 'message', { type: 'message', role: 'user', text: 'Saved to C:XUsersXdemoX100ZZreport.txt' });

  const searchRes = await app.request('/api/voice/tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ botId, name: 'search_conversations', args: { query: 'C:\\Users\\demo\\100%_' } }),
  });
  assert.equal(searchRes.status, 200);
  const { output } = await searchRes.json();
  assert.match(output, /100%_report\.txt/);
  assert.doesNotMatch(output, /100ZZreport\.txt/);
});

test('voice /tool enforces callId ownership so another bot cannot inject tasks into an active call', async (t) => {
  const { cookie, botId } = await signInOwner();
  const bot2Res = await app.request('/api/bots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ name: 'SecondBot', description: 'Helper', instructions: 'Help' }),
  });
  assert.equal(bot2Res.status, 200);
  const { bot: { id: bot2Id } } = await bot2Res.json();

  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ value: 'ek_test', expires_at: Date.now() + 60_000 }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }));

  const sessionRes = await app.request('/api/voice/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ botId }),
  });
  assert.equal(sessionRes.status, 200);
  const { callId } = await sessionRes.json();

  // Attempt to inject a task into bot1's active call while invoking /tool for bot2.
  const spoofed = await app.request('/api/voice/tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ botId: bot2Id, callId, name: 'send_task', args: { request: 'injected task' } }),
  });
  assert.equal(spoofed.status, 200);

  // End bot1's call and verify its call record has zero injected tasks.
  const endRes = await app.request('/api/voice/end', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ botId, callId, transcript: [] }),
  });
  assert.equal(endRes.status, 200);
  const { seq } = await endRes.json();
  const row = db.prepare('SELECT body FROM rows WHERE bot_id=? AND seq=?').get(botId, seq);
  const parsed = JSON.parse(row.body);
  assert.deepEqual(parsed.call.tasks, []);
});

test('voice /preview and /stt redact xAI key from failure logs and /stt normalizes regional languages', async (t) => {
  const { cookie, botId } = await signInOwner();
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));

  // Mock failed TTS response echoing the secret key.
  t.mock.method(globalThis, 'fetch', async () => new Response('auth failed for xai-fixture-secret-key-987654', { status: 401 }));
  const preview = await app.request('/api/voice/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ botId, text: 'hello' }),
  });
  assert.equal(preview.status, 502);
  assert.ok(warnings.some((w) => w.includes('[redacted]')));
  assert.ok(warnings.every((w) => !w.includes('xai-fixture-secret-key-987654')));

  // Mock STT: verify regional language 'es-MX' is normalized to 'es' on upstream FormData, and failure logs are redacted.
  let sentLanguage = null;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    sentLanguage = init.body.get('language');
    return new Response('stt rejected xai-fixture-secret-key-987654', { status: 401 });
  });
  const form = new FormData();
  form.append('language', 'es-MX');
  form.append('file', new Blob([Buffer.alloc(400, 1)], { type: 'audio/webm' }), 'clip.webm');
  const stt = await app.request('/api/voice/stt', {
    method: 'POST',
    headers: { cookie },
    body: form,
  });
  assert.equal(stt.status, 502);
  assert.equal(sentLanguage, 'es');
  assert.ok(warnings.every((w) => !w.includes('xai-fixture-secret-key-987654')));
});
