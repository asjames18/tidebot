import test from 'node:test';
import assert from 'node:assert/strict';
import { configApi } from '../web/src/lib/configApi.ts';
import { api, markAuthenticated, setUnauthorizedHandler } from '../web/src/lib/api.ts';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let calls = 0;
const realFetch = globalThis.fetch;
test.beforeEach(() => { calls = 0; setUnauthorizedHandler(() => { calls += 1; }); });
test.after(() => { globalThis.fetch = realFetch; setUnauthorizedHandler(null); });

test('an expired session (401 unauthenticated) fires the handler', async () => {
  globalThis.fetch = async () => json(401, { error: 'unauthenticated' });
  await assert.rejects(api.bots(), { status: 401 });
  assert.equal(calls, 1);
});

test('a wrong password on the sign-in endpoint does not count as an expired session', async () => {
  globalThis.fetch = async () => json(401, { error: 'Invalid email or password' });
  await assert.rejects(api.passwordLogin('a@b.test', 'nope'), { status: 401 });
  assert.equal(calls, 0);
});

test('other errors never fire the handler', async () => {
  globalThis.fetch = async () => json(403, { error: 'unauthenticated' });
  await assert.rejects(api.bots(), { status: 403 });
  globalThis.fetch = async () => json(500, { error: 'boom' });
  await assert.rejects(api.bots(), { status: 500 });
  assert.equal(calls, 0);
});

test('a 401 from a request that started before the latest sign-in is ignored', async () => {
  let release;
  globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(json(401, { error: 'unauthenticated' })); });
  const inflight = api.bots();
  markAuthenticated(); // a new session was established while the old request was pending
  release();
  await assert.rejects(inflight, { status: 401 });
  assert.equal(calls, 0);
});

test('configApi requests follow the same rules', async () => {
  globalThis.fetch = async () => json(401, { error: 'unauthenticated' });
  await assert.rejects(configApi.llmConfig(), { status: 401 });
  assert.equal(calls, 1);
  globalThis.fetch = async () => json(401, { error: 'something else' });
  await assert.rejects(configApi.llmConfig(), { status: 401 });
  assert.equal(calls, 1);
  let release;
  globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(json(401, { error: 'unauthenticated' })); });
  const inflight = configApi.llmConfig();
  markAuthenticated();
  release();
  await assert.rejects(inflight, { status: 401 });
  assert.equal(calls, 1);
});

test('several old in-flight 401s after a re-login are all ignored, in either client', async () => {
  const pending = [];
  globalThis.fetch = () => new Promise((resolve) => { pending.push(() => resolve(json(401, { error: 'unauthenticated' }))); });
  const all = [api.bots(), configApi.llmConfig(), api.bots()];
  markAuthenticated();
  pending.forEach((f) => f());
  const results = await Promise.allSettled(all);
  assert.ok(results.every((r) => r.status === 'rejected'));
  assert.equal(calls, 0);
});

test('requests started after the re-login still trigger sign-out when the session ends again', async () => {
  markAuthenticated();
  globalThis.fetch = async () => json(401, { error: 'unauthenticated' });
  await assert.rejects(api.bots(), { status: 401 });
  assert.equal(calls, 1);
});
