// Regression tests for session rotation, expired-session pruning, RFC 6265
// cookie parsing, matching logout cookie attributes, and password hash format
// validation in server/src/lib/auth.ts and server/src/lib/passwords.ts.
// Runs against an isolated temp DB/env; never touches live data or the network.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';

const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-auth-'));
process.env.DB_PATH = path.join(fixtures, 'test.db');
process.env.ENV_PATH = path.join(fixtures, '.env');
fs.writeFileSync(process.env.ENV_PATH, 'STUDIO_ADMIN_EMAIL=admin@example.test\n');

const { db, now } = await import('../server/dist/db.js');
const {
  createSession,
  destroySession,
  requireUser,
  sessionTokensFromCookieHeader,
  userFromCookieHeader,
} = await import('../server/dist/lib/auth.js');
const { sha256 } = await import('../server/dist/lib/ids.js');
const { hashPassword, verifyPassword } = await import('../server/dist/lib/passwords.js');

after(() => {
  try { db.close(); } finally { fs.rmSync(fixtures, { recursive: true, force: true }); }
});

db.prepare("INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)")
  .run('u-admin', 'admin@example.test', 'Admin', 1);
db.prepare("INSERT INTO users(id,email,name,created_at) VALUES (?,?,?,?)")
  .run('u-member', 'member@example.test', 'Member', 1);

function extractSessionToken(res) {
  const header = res.headers.get('set-cookie') ?? '';
  const match = header.match(/grokbot_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

test('sessionTokensFromCookieHeader parses leading whitespace, quoted values, and multiple cookies safely', () => {
  assert.deepEqual(sessionTokensFromCookieHeader(undefined), []);
  assert.deepEqual(sessionTokensFromCookieHeader('  grokbot_session=tok-1  '), ['tok-1']);
  assert.deepEqual(sessionTokensFromCookieHeader('other=1; grokbot_session="tok-quoted"'), ['tok-quoted']);
  assert.deepEqual(
    sessionTokensFromCookieHeader('grokbot_session=%E0%A4%A; grokbot_session=tok-good'),
    ['tok-good'],
  );
  assert.deepEqual(sessionTokensFromCookieHeader('grokbot_session=%'), []);
});

test('createSession rotates the prior session token and prunes expired sessions', async () => {
  // Seed an expired session row that should be pruned on the next createSession.
  db.prepare('INSERT INTO auth_sessions(token,user_id,created_at,expires_at,verified) VALUES (?,?,?,?,1)')
    .run(sha256('expired-tok'), 'u-member', 1, now() - 1000);

  const app = new Hono();
  app.post('/login/:userId', (c) => {
    createSession(c, c.req.param('userId'), true);
    return c.json({ ok: true });
  });

  const firstRes = await app.request('/login/u-member', { method: 'POST' });
  const firstToken = extractSessionToken(firstRes);
  assert.ok(firstToken, 'first login should issue a session cookie');
  assert.equal(userFromCookieHeader(`grokbot_session=${firstToken}`)?.id, 'u-member');

  // Expired row should already be gone.
  assert.equal(
    db.prepare('SELECT 1 FROM auth_sessions WHERE token=?').get(sha256('expired-tok')),
    undefined,
    'expired session must be pruned on createSession',
  );

  // Re-logging in as the same user while sending the prior session cookie rotates it out of the DB.
  const secondRes = await app.request('/login/u-member', {
    method: 'POST',
    headers: { cookie: `grokbot_session=${firstToken}` },
  });
  const secondToken = extractSessionToken(secondRes);
  assert.ok(secondToken && secondToken !== firstToken);
  assert.equal(userFromCookieHeader(`grokbot_session=${firstToken}`), null, 'prior same-user session token must be revoked');
  assert.equal(userFromCookieHeader(`  grokbot_session="${secondToken}"`)?.id, 'u-member');
  assert.equal(
    userFromCookieHeader(`grokbot_session=stale-invalid; grokbot_session=${secondToken}`)?.id,
    'u-member',
    'stale duplicate cookie must not shadow a valid session cookie',
  );

  // Logging in as a different user must not revoke u-member's saved session token.
  const adminRes = await app.request('/login/u-admin', {
    method: 'POST',
    headers: { cookie: `grokbot_session=${secondToken}` },
  });
  const adminToken = extractSessionToken(adminRes);
  assert.equal(userFromCookieHeader(`grokbot_session=${adminToken}`)?.id, 'u-admin');
  assert.equal(userFromCookieHeader(`grokbot_session=${secondToken}`)?.id, 'u-member');
});

test('destroySession revokes DB session and sends matching cookie attributes', async () => {
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const app = new Hono();
    app.post('/login', (c) => { createSession(c, 'u-admin', true); return c.json({ ok: true }); });
    app.post('/logout', (c) => { destroySession(c); return c.json({ ok: true }); });

    const loginRes = await app.request('/login', { method: 'POST' });
    const loginCookie = loginRes.headers.get('set-cookie') ?? '';
    assert.match(loginCookie, /HttpOnly/i);
    assert.match(loginCookie, /SameSite=Lax/i);
    assert.match(loginCookie, /Secure/i);
    const tok = extractSessionToken(loginRes);

    const logoutRes = await app.request('/logout', {
      method: 'POST',
      headers: { cookie: `grokbot_session=${tok}` },
    });
    const logoutCookie = logoutRes.headers.get('set-cookie') ?? '';
    assert.match(logoutCookie, /HttpOnly/i);
    assert.match(logoutCookie, /SameSite=Lax/i);
    assert.match(logoutCookie, /Secure/i);
    assert.equal(userFromCookieHeader(`grokbot_session=${tok}`), null, 'destroyed session must no longer resolve');
  } finally {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  }
});

test('requireUser authenticates quoted/duplicate cookies and checks non-empty studioAdminEmail', async () => {
  const app = new Hono();
  app.post('/login/:userId', (c) => { createSession(c, c.req.param('userId'), true); return c.json({ ok: true }); });
  app.get('/me', requireUser, (c) => c.json({ id: c.get('user').id, admin: c.get('studioAdmin') }));

  const unauth = await app.request('/me', { headers: { cookie: 'grokbot_session=%' } });
  assert.equal(unauth.status, 401);

  const loginRes = await app.request('/login/u-admin', { method: 'POST' });
  const tok = extractSessionToken(loginRes);

  const okRes = await app.request('/me', {
    headers: { cookie: `grokbot_session=bad; grokbot_session="${tok}"` },
  });
  assert.equal(okRes.status, 200);
  assert.deepEqual(await okRes.json(), { id: 'u-admin', admin: true });

  // Clearing STUDIO_ADMIN_EMAIL must never accidentally match an empty email.
  fs.writeFileSync(process.env.ENV_PATH, '');
  const bumped = new Date(Date.now() + 5_000);
  fs.utimesSync(process.env.ENV_PATH, bumped, bumped);
  const noAdminRes = await app.request('/me', { headers: { cookie: `grokbot_session=${tok}` } });
  assert.equal(noAdminRes.status, 200);
  assert.deepEqual(await noAdminRes.json(), { id: 'u-admin', admin: false });
});

test('verifyPassword validates password round-trip and rejects malformed stored hashes', async () => {
  const hash = await hashPassword('correct-horse-battery-staple');
  assert.equal(await verifyPassword('correct-horse-battery-staple', hash), true);
  assert.equal(await verifyPassword('wrong-password', hash), false);
  assert.equal(await verifyPassword('anything', undefined), false);
  assert.equal(await verifyPassword('anything', ''), false);
  assert.equal(await verifyPassword('anything', '.onlyhash'), false);
  assert.equal(await verifyPassword('anything', 'onlysalt.'), false);
  assert.equal(await verifyPassword('correct-horse-battery-staple', `${hash}.extra`), false);
});
