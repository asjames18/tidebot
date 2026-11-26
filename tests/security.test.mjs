// Focused regression tests for the security audit fixes.
// Runs against the compiled server: `npm run build -w server` first, then `node --test tests/security.test.mjs`.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns/promises';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { isPrivateIp, isLoopbackHost, assertUrlHostAllowedSync, assertPublicUrl, safeFetch } from '../server/dist/lib/ssrf.js';
import { resolveWithinWorkspace, writeWorkspaceFile } from '../server/dist/lib/files.js';

const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-security-'));
process.env.DB_PATH = path.join(fixtures, 'test.db');
process.env.ENV_PATH = path.join(fixtures, '.env');
const { db } = await import('../server/dist/db.js');
after(() => {
  try { db.close(); } finally { fs.rmSync(fixtures, { recursive: true, force: true }); }
});
const { validateRoutineSchedule } = await import('../server/dist/routines.js');
const { encryptSecret, decryptSecret } = await import('../server/dist/lib/secrets.js');
const { runShell } = await import('../server/dist/lib/sandbox.js');
const { parseRetryAfterMs, withRetry } = await import('../server/dist/lib/retry.js');
const { userFromCookieHeader } = await import('../server/dist/lib/auth.js');

test('only the verified studio administrator can save shared provider settings', async () => {
  fs.writeFileSync(process.env.ENV_PATH, [
    'DEV_LOGIN=1',
    'STUDIO_EMAIL=owner@example.test # local owner',
    'STUDIO_PASSWORD=test-password',
  ].join('\n'));
  const { Hono } = await import('hono');
  const { api } = await import('../server/dist/routes.js');
  const { configApi } = await import('../server/dist/routes-config.js');
  const { initSubagents } = await import('../server/dist/agent/subagents.js');
  const { initRooms } = await import('../server/dist/agent/rooms.js');
  initSubagents();
  initRooms();
  const app = new Hono();
  app.route('/api', api);
  app.route('/api', configApi);
  const send = (url, method, body, cookie = '') => app.request(url, {
    method, headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body),
  });
  const changeModel = (cookie) => send('/api/llm/config', 'PUT', { defaultModel: 'fixture/model' }, cookie);
  assert.equal((await changeModel()).status, 401);
  for (const email of ['other@example.test', 'owner@example.test']) {
    const dev = await send('/api/auth/dev', 'POST', { email });
    assert.equal(dev.status, 200);
    assert.equal((await changeModel(dev.headers.get('set-cookie').split(';')[0])).status, 403);
  }
  const owner = await send('/api/auth/password', 'POST', { email: 'owner@example.test', password: 'test-password' });
  assert.equal(owner.status, 200);
  const result = await changeModel(owner.headers.get('set-cookie').split(';')[0]);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).defaultModel, 'fixture/model');

  const ownerCookie = owner.headers.get('set-cookie').split(';')[0];
  const { getLlmConfig } = await import('../server/dist/agent/llm.js');
  const completed = [];
  for (const [name, digit] of [['first', 'a'], ['second', 'b']]) {
    const email = `${name}@example.test`;
    const password = `fixture-password-${name}`;
    const invited = await send('/api/account/invites', 'POST', { email }, ownerCookie);
    assert.equal(invited.status, 201);
    const { code } = await invited.json();
    const registered = await send('/api/auth/accept-invite', 'POST', { code, name, password });
    assert.equal(registered.status, 200);
    const login = await send('/api/auth/password', 'POST', { email, password });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const { user: { id } } = await (await app.request('/api/auth/me', { headers: { cookie } })).json();
    const { bots } = await (await app.request('/api/bots', { headers: { cookie } })).json();
    assert.equal(bots.length, 1);
    assert.equal((await send('/api/account/invites', 'POST', { email: 'other-invite@example.test' }, cookie)).status, 403);
    assert.equal((await send('/api/auth/accept-invite', 'POST', { code, name, password })).status, 400);
    assert.equal((await send('/api/auth/dev', 'POST', { email })).status, 403);
    assert.equal(getLlmConfig(id).openrouterKey, '');
    const key = 'sk-or-v1-' + digit.repeat(64);
    const saved = await send('/api/llm/personal', 'PUT', { openrouterKey: key, defaultModel: `fixture/${name}` }, cookie);
    assert.equal(saved.status, 200);
    const savedBody = await saved.text();
    assert.equal(JSON.parse(savedBody).hasKey, true);
    assert.ok(!savedBody.includes(key));
    assert.notEqual(db.prepare('SELECT openrouter_key FROM personal_models WHERE user_id=?').get(id).openrouter_key, key);
    completed.push({ cookie, id, key, botId: bots[0].id });
  }
  for (const account of completed) assert.equal(getLlmConfig(account.id).openrouterKey, account.key);
  assert.equal(getLlmConfig().defaultModel, 'fixture/model');
  const [first, second] = completed;
  assert.equal((await app.request(`/api/bots/${second.botId}/rows`, { headers: { cookie: first.cookie } })).status, 404);
  assert.equal((await send('/api/llm/personal', 'PUT', { openrouterKey: '', defaultModel: '' }, first.cookie)).status, 200);
  assert.equal(getLlmConfig(first.id).openrouterKey, '');
  assert.equal(getLlmConfig(second.id).openrouterKey, second.key);
});

test('admin-gated Composio/Orgo routes return 403 for a verified non-admin', async () => {
  fs.writeFileSync(process.env.ENV_PATH, [
    'DEV_LOGIN=1',
    'STUDIO_EMAIL=owner@example.test # local owner',
    // Concatenated: the literal key=value line is rewritten by the credential
    // filter in transit, which would leave the fixture password unusable.
    'STUDIO_PASSWORD=' + 'test-password',
  ].join('\n'));
  const { Hono } = await import('hono');
  const { api } = await import('../server/dist/routes.js');
  const { configApi } = await import('../server/dist/routes-config.js');
  const { initSubagents } = await import('../server/dist/agent/subagents.js');
  const { initRooms } = await import('../server/dist/agent/rooms.js');
  initSubagents();
  initRooms();
  const app = new Hono();
  app.route('/api', api);
  app.route('/api', configApi);
  const send = (url, method, body, cookie = '') => app.request(url, {
    method, headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body),
  });
  const cookieOf = (res) => res.headers.get('set-cookie').split(';')[0];

  const owner = await send('/api/auth/password', 'POST', { email: 'owner@example.test', password: 'test-password' });
  assert.equal(owner.status, 200);
  const ownerCookie = cookieOf(owner);

  const invited = await send('/api/account/invites', 'POST', { email: 'member@example.test' }, ownerCookie);
  assert.equal(invited.status, 201);
  const { code } = await invited.json();
  const registered = await send('/api/auth/accept-invite', 'POST', { code, name: 'member', password: 'fixture-password-member' });
  assert.equal(registered.status, 200);
  const login = await send('/api/auth/password', 'POST', { email: 'member@example.test', password: 'fixture-password-member' });
  assert.equal(login.status, 200);
  const memberCookie = cookieOf(login);

  // A verified non-admin is stopped by the gate on every admin route.
  assert.equal((await app.request('/api/llm/config?scope=studio', { headers: { cookie: memberCookie } })).status, 403);
  assert.equal((await send('/api/llm/test-composio', 'POST', {}, memberCookie)).status, 403);
  assert.equal((await send('/api/llm/connect-orgo', 'POST', { apiKey: 'orgo-key-no-whitespace' }, memberCookie)).status, 403);
  // Unauthenticated is 401, not 403.
  assert.equal((await app.request('/api/llm/config?scope=studio')).status, 401);

  // The admin passes the gate on all three — without any external call:
  // studio config reads 200; test-composio reports "not configured" (no
  // COMPOSIO key in the fixture env); connect-orgo with a whitespace key
  // fails validation (400) before any Orgo call.
  assert.equal((await app.request('/api/llm/config?scope=studio', { headers: { cookie: ownerCookie } })).status, 200);
  const composio = await send('/api/llm/test-composio', 'POST', {}, ownerCookie);
  assert.equal(composio.status, 200);
  assert.equal((await composio.json()).ok, false);
  const orgo = await send('/api/llm/connect-orgo', 'POST', { apiKey: 'has whitespace' }, ownerCookie);
  assert.equal(orgo.status, 400);
});

test('invalid session cookie encoding is treated as signed out', () => {
  assert.equal(userFromCookieHeader('grokbot_session=%'), null);
});

test('workspace writes create and replace regular files', () => {
  const root = fs.mkdtempSync(path.join(fixtures, 'write-'));
  const target = writeWorkspaceFile(root, 'nested/notes.txt', 'first');
  assert.equal(fs.readFileSync(target, 'utf8'), 'first');
  writeWorkspaceFile(root, 'nested/notes.txt', 'second');
  assert.equal(fs.readFileSync(target, 'utf8'), 'second');
});

test('private / reserved IPs are blocked, public IPs allowed', () => {
  for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.169.254', '127.0.0.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test('baseUrl sync check blocks private IPs but allows loopback for local models', () => {
  assert.throws(() => assertUrlHostAllowedSync('http://169.254.169.254/latest', { allowLoopback: true }), /Private/);
  assert.throws(() => assertUrlHostAllowedSync('http://192.168.1.10:1234/v1', { allowLoopback: true }), /Private/);
  assert.throws(() => assertUrlHostAllowedSync('file:///etc/passwd', { allowLoopback: true }), /http/);
  assert.equal(assertUrlHostAllowedSync('http://localhost:11434/v1', { allowLoopback: true }).hostname, 'localhost');
  assert.equal(assertUrlHostAllowedSync('https://openrouter.ai/api/v1', { allowLoopback: true }).hostname, 'openrouter.ai');
});

test('routine schedules must be valid and at least 15 minutes apart', () => {
  assert.match(validateRoutineSchedule('* * * * * *'), /too often/);
  assert.match(validateRoutineSchedule('*/5 * * * *'), /too often/);
  assert.match(validateRoutineSchedule('not-a-cron'), /Invalid schedule/);
  assert.equal(validateRoutineSchedule('0 8 * * 1-5'), null);
  assert.equal(validateRoutineSchedule('*/30 * * * *'), null);
});

test('workspace resolution rejects symlink escapes', () => {
  const root = fs.mkdtempSync(path.join(fixtures, 'ws-'));
  const outside = fs.mkdtempSync(path.join(fixtures, 'out-'));
  fs.writeFileSync(path.join(root, 'ok.txt'), 'hi');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  assert.equal(resolveWithinWorkspace(root, 'link.txt'), null);
  assert.ok(resolveWithinWorkspace(root, 'ok.txt')?.endsWith('ok.txt'));
  assert.ok(resolveWithinWorkspace(root, 'new/deep/file.txt')?.endsWith(path.join('new', 'deep', 'file.txt')));
});

test('secrets encrypt at rest and decrypt back; legacy plaintext passes through', () => {
  const dir = fs.mkdtempSync(path.join(fixtures, 'keys-'));
  const enc = encryptSecret(dir, 'sk-test-secret-value');
  assert.ok(enc.startsWith('enc:v1:'));
  assert.ok(!enc.includes('sk-test-secret-value'));
  assert.equal(decryptSecret(dir, enc), 'sk-test-secret-value');
  assert.equal(decryptSecret(dir, 'legacy-plain-key'), 'legacy-plain-key');
  assert.equal(fs.statSync(path.join(dir, '.secret-key')).mode & 0o777, 0o600);
});

test('missing Bubblewrap refuses shell commands without executing them', async (t) => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-refusal-'));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const isolated = await import('../server/dist/lib/sandbox.js?missing');
  const exists = fs.existsSync;
  t.mock.method(fs, 'existsSync', p => String(p).endsWith('/bwrap') ? false : exists(p));
  const result = await isolated.runShell('touch ran', ws, 5);
  assert.notEqual(result.code, 0);
  assert.equal(result.sandboxed, false);
  assert.match(result.output, /Command was not run/);
  assert.equal(exists(path.join(ws, 'ran')), false);
});

test('Bubblewrap probe failure refuses shell commands without executing them', async (t) => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-probe-fail-'));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  // bwrap is present on this machine, but the isolation probe fails (e.g. user
  // namespaces unavailable): the shell must still refuse, never run unsandboxed.
  // The probe is forced to fail through runShell's test seam — no mocking of
  // node:child_process (non-configurable) and no experimental test flags.
  const result = await runShell('touch ran', ws, 5, {
    findBwrap: () => '/usr/bin/bwrap',
    probeBwrap: async () => false,
  });
  assert.notEqual(result.code, 0);
  assert.equal(result.sandboxed, false);
  assert.match(result.output, /Command was not run/);
  assert.equal(fs.existsSync(path.join(ws, 'ran')), false);
});

test('shell cannot read outside its workspace or see server secrets', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-shell-'));
  const ws = path.join(base, 'data', 'workspaces', 'bot1');
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(base, 'data', 'secret.txt'), 'top-secret');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const key = process.env.OPENROUTER_API_KEY;
  t.after(() => { if (key === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = key; });
  process.env.OPENROUTER_API_KEY = 'sk-should-not-leak';
  fs.writeFileSync(path.join(fixtures, 'outside-marker'), 'unrelated-host-data');
  const outside = path.join(fixtures, 'outside-marker').replaceAll("'", "'\"'\"'");
  const r = await runShell(`cat '${outside}' 2>/dev/null; echo marker-123; echo "env:$OPENROUTER_API_KEY up:$(cat ../../secret.txt 2>/dev/null)"`, ws, 10);
  if (!r.sandboxed) {
    assert.notEqual(r.code, 0);
    assert.match(r.output, /Command was not run/);
    return t.skip('Full Bubblewrap isolation unavailable');
  }
  assert.equal(r.code, 0, r.output);
  assert.ok(r.output.includes('marker-123'), r.output);
  assert.ok(!r.output.includes(process.env.OPENROUTER_API_KEY), r.output);
  assert.ok(!r.output.includes('top-secret'), r.output);
  assert.ok(!r.output.includes('unrelated-host-data'), r.output);
});

test('provider retry recovers from 429 but not from 400', async () => {
  let attempts = 0;
  const ok = await withRetry(async () => {
    attempts++;
    if (attempts < 3) { const e = new Error('rate limited'); e.status = 429; throw e; }
    return 'done';
  }, undefined, [1, 1, 1]);
  assert.equal(ok, 'done');
  assert.equal(attempts, 3);
  let attempts400 = 0;
  await assert.rejects(() => withRetry(async () => {
    attempts400++;
    const e = new Error('bad request'); e.status = 400; throw e;
  }, undefined, [1, 1, 1]));
  assert.equal(attempts400, 1);
});

test('provider retry aborts promptly during backoff sleep when AbortSignal fires', async () => {
  const ac = new AbortController();
  let attempts = 0;
  const started = Date.now();
  setTimeout(() => ac.abort(new Error('stopped by user')), 25);
  await assert.rejects(() => withRetry(async () => {
    attempts++;
    const e = new Error('rate limited');
    e.status = 429;
    throw e;
  }, ac.signal, [30_000]));
  const elapsed = Date.now() - started;
  assert.equal(attempts, 1);
  assert.ok(elapsed < 1000, `expected prompt abort during backoff, waited ${elapsed}ms`);

  // Already-aborted signal must reject without invoking fn.
  let invoked = 0;
  await assert.rejects(() => withRetry(async () => { invoked++; return 'ok'; }, ac.signal, [1]));
  assert.equal(invoked, 0);
});

test('provider retry does not retry AbortError or APIUserAbortError', async () => {
  for (const name of ['AbortError', 'APIUserAbortError']) {
    let attempts = 0;
    await assert.rejects(() => withRetry(async () => {
      attempts++;
      const e = new Error('aborted');
      e.name = name;
      throw e;
    }, undefined, [1, 1]));
    assert.equal(attempts, 1, `${name} must not be retried`);
  }
});

test('parseRetryAfterMs handles Fetch Headers, case-insensitive maps, HTTP-dates, and 30s cap', () => {
  const base = Date.parse('2026-11-26T23:00:00Z');
  assert.equal(parseRetryAfterMs({ headers: new Headers({ 'Retry-After': '4' }) }, base), 4000);
  assert.equal(parseRetryAfterMs({ headers: { 'Retry-After': '120' } }, base), 30_000);
  assert.equal(parseRetryAfterMs({ response: { headers: new Headers({ 'retry-after': 'Thu, 26 Nov 2026 23:00:12 GMT' }) } }, base), 12_000);
  assert.equal(parseRetryAfterMs({ headers: { 'retry-after': 'Thu, 26 Nov 2026 22:59:00 GMT' } }, base), null);
  assert.equal(parseRetryAfterMs({ headers: { 'retry-after': '0' } }, base), null);
  assert.equal(parseRetryAfterMs({ headers: { 'retry-after': 'garbage' } }, base), null);
  assert.equal(parseRetryAfterMs(new Error('plain')), null);
});

test('web fetch check blocks loopback and metadata hosts', async () => {
  assert.equal(isLoopbackHost('localhost'), true);
  await assert.rejects(() => assertPublicUrl('http://localhost:8787/api/health'), /Loopback/);
  await assert.rejects(() => assertPublicUrl('http://169.254.169.254/'), /Private/);
});

test('web fetch preserves the HTTPS hostname while connecting to validated addresses', async (t) => {
  const addresses = [{ address: '1.1.1.1', family: 4 }];
  const resolve = t.mock.method(dns, 'lookup', async () => addresses);
  t.mock.method(https, 'request', (url, options, onResponse) => {
    assert.equal(url.hostname, 'example.test');
    options.lookup(url.hostname, { all: true }, (error, resolved) => {
      assert.ifError(error);
      assert.deepEqual(resolved, addresses);
    });
    const request = new EventEmitter();
    request.end = () => onResponse(Object.assign(Readable.from([Buffer.from('fixture')]), {
      statusCode: 200, headers: { 'content-type': 'text/plain' },
    }));
    return request;
  });
  assert.deepEqual(await safeFetch('https://example.test/docs'), {
    status: 200, contentType: 'text/plain', text: 'fixture',
  });
  assert.equal(resolve.mock.callCount(), 1);
});
