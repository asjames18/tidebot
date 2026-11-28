import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('worker preserves unrelated caches and reads its own offline shell', async () => {
  const events = {}, deleted = [];
  const current = 'tidebot-shell-v3';
  const caches = {
    keys: async () => ['other-app', 'tidebot-shell-v2', current],
    delete: async key => deleted.push(key),
    match: async (key, options) => options?.cacheName === current && key === '/' ? 'own shell' : 'foreign shell',
  };
  vm.runInNewContext(readFileSync(new URL('../web/public/sw.js', import.meta.url), 'utf8'), {
    self: {addEventListener: (name, fn) => events[name] = fn, clients: {claim() {}}},
    URL, caches, location: {origin: 'http://localhost'}, fetch: async () => { throw Error('offline'); },
  });
  let pending;
  events.activate({waitUntil: p => pending = p});
  await pending;
  assert.deepEqual(deleted, ['tidebot-shell-v2']);
  events.fetch({request: {method: 'GET', mode: 'navigate', url: 'http://localhost/'}, respondWith: p => pending = p});
  assert.equal(await pending, 'own shell');
});

function loadWorker({ fetch, caches }) {
  const events = {};
  vm.runInNewContext(readFileSync(new URL('../web/public/sw.js', import.meta.url), 'utf8'), {
    self: { addEventListener: (name, fn) => { events[name] = fn; }, clients: { claim() {} } },
    URL,
    caches,
    location: { origin: 'http://localhost' },
    fetch,
  });
  return events;
}

test('worker skips caching 206 partial content, opaque responses, and non-HTML navigations', async () => {
  const puts = [];
  const waitTasks = [];
  const caches = {
    open: async () => ({ put: async (k, v) => puts.push([k, v]) }),
    match: async () => undefined,
  };
  const mkRes = ({ status = 200, type = 'basic', contentType = 'text/html; charset=utf-8', body = 'ok' }) => ({
    ok: status >= 200 && status < 300,
    status,
    type,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? contentType : null) },
    clone() { return { body, status, type }; },
    body,
  });

  let nextRes;
  const events = loadWorker({ fetch: async () => nextRes, caches });
  const dispatch = async (request) => {
    let pending;
    let handled = false;
    events.fetch({
      request,
      respondWith: (p) => { handled = true; pending = p; },
      waitUntil: (p) => waitTasks.push(p),
    });
    return { handled, result: handled ? await pending : undefined };
  };

  // Exact /api and /api/... must bypass the service worker completely.
  assert.equal((await dispatch({ method: 'GET', mode: 'cors', url: 'http://localhost/api' })).handled, false);
  assert.equal((await dispatch({ method: 'GET', mode: 'cors', url: 'http://localhost/api/health' })).handled, false);

  // 206 Partial Content asset must not be passed to cache.put (Cache API throws on 206).
  nextRes = mkRes({ status: 206, contentType: 'audio/mpeg', body: 'chunk' });
  const partial = await dispatch({ method: 'GET', mode: 'cors', url: 'http://localhost/assets/clip.mp3' });
  assert.equal(partial.result.status, 206);
  await Promise.all(waitTasks);
  assert.equal(puts.length, 0);

  // Opaque response must not be cached.
  nextRes = mkRes({ status: 200, type: 'opaque', contentType: 'application/javascript', body: 'opaque' });
  await dispatch({ method: 'GET', mode: 'cors', url: 'http://localhost/assets/app.js' });
  await Promise.all(waitTasks);
  assert.equal(puts.length, 0);

  // Non-HTML navigation (e.g. direct JSON/file view) must not overwrite cached '/' shell.
  nextRes = mkRes({ status: 200, contentType: 'application/json', body: '{"a":1}' });
  await dispatch({ method: 'GET', mode: 'navigate', url: 'http://localhost/export.json' });
  await Promise.all(waitTasks);
  assert.equal(puts.length, 0);

  // Normal 200 basic HTML navigation updates cached '/' shell.
  nextRes = mkRes({ status: 200, contentType: 'text/html; charset=utf-8', body: '<html>app</html>' });
  await dispatch({ method: 'GET', mode: 'navigate', url: 'http://localhost/' });
  await Promise.all(waitTasks);
  assert.equal(puts.length, 1);
  assert.equal(puts[0][0], '/');
});

test('worker stale-while-revalidate uses waitUntil on cache hit and rejects cleanly on offline miss', async () => {
  const puts = [];
  const waitTasks = [];
  let cachedHit = undefined;
  let shouldFail = true;
  const caches = {
    open: async () => ({ put: async (k, v) => puts.push([k, v]) }),
    match: async () => cachedHit,
  };
  const events = loadWorker({
    fetch: async () => {
      if (shouldFail) throw new Error('offline');
      return { ok: true, status: 200, type: 'basic', clone: () => ({ fresh: true }), fresh: true };
    },
    caches,
  });

  // Offline cache miss must reject instead of resolving respondWith to undefined.
  let missPromise;
  events.fetch({
    request: { method: 'GET', mode: 'cors', url: 'http://localhost/favicon.svg' },
    respondWith: (p) => { missPromise = p; },
    waitUntil: (p) => waitTasks.push(p),
  });
  await assert.rejects(missPromise, /offline/);

  // Cache hit returns cached entry immediately and registers background refresh via waitUntil.
  cachedHit = { cached: true };
  shouldFail = false;
  let hitPromise;
  events.fetch({
    request: { method: 'GET', mode: 'cors', url: 'http://localhost/favicon.svg' },
    respondWith: (p) => { hitPromise = p; },
    waitUntil: (p) => waitTasks.push(p),
  });
  assert.deepEqual(await hitPromise, { cached: true });
  assert.ok(waitTasks.length >= 1, 'background refresh should be tracked via waitUntil');
  await Promise.all(waitTasks);
  assert.equal(puts.length, 1);
});

