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
