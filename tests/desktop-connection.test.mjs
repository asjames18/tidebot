import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import connection from '../desktop/connection.cjs';

const { checkServer, serverOrigin } = connection;
const chooserScript = readFileSync(new URL('../desktop/connection.js', import.meta.url), 'utf8');

function chooserFixture(settings, connect) {
  const listeners = new Map();
  const elements = Object.fromEntries(['address', 'local', 'remote', 'connect', 'status'].map((id) => [id, {
    value: '', textContent: '', disabled: false,
    toggleAttribute() {},
    addEventListener(type, handler) { listeners.set(`${id}:${type}`, handler); },
  }]));
  const loaded = runInNewContext(chooserScript, {
    document: { getElementById: (id) => elements[id] },
    window: { tidebotConnection: { settings: () => settings, connect } },
  });
  return { elements, loaded, chooseLocal: listeners.get('local:click') };
}

test('late saved settings do not overwrite an active desktop connection status', async () => {
  const settings = Promise.withResolvers();
  const connection = Promise.withResolvers();
  const { elements, loaded, chooseLocal } = chooserFixture(settings.promise, () => connection.promise);
  chooseLocal();
  settings.resolve({ origin: 'https://old.example.test', error: 'Saved connection failed' });
  await loaded;
  assert.equal(elements.status.textContent, 'Starting TideBot…');
  assert.equal(elements.address.value, '');
  connection.resolve({ error: 'Could not start the local server' });
  await new Promise(setImmediate);
  assert.equal(elements.status.textContent, 'Could not start the local server');
});

test('the desktop connection chooser offers manual options when saved settings are unavailable', async () => {
  const { elements, loaded } = chooserFixture(Promise.reject(new Error('IPC unavailable')), () => {});
  await loaded;
  assert.match(elements.status.textContent, /Could not load the saved connection/);
  assert.equal(elements.local.disabled, false);
  assert.equal(elements.connect.disabled, false);
});

test('the desktop connection chooser still fills a saved address before manual connection', async () => {
  const origin = 'https://studio.example.test';
  const { elements, loaded } = chooserFixture(Promise.resolve({ origin }), () => {});
  await loaded;
  assert.equal(elements.address.value, origin);
});

test('server selection accepts secure addresses and local HTTP', () => {
  assert.equal(serverOrigin(' https://Studio.Example.test/ '), 'https://studio.example.test');
  assert.equal(serverOrigin('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
  assert.equal(serverOrigin('http://[::1]:8787/'), 'http://[::1]:8787');
  for (const address of [
    'http://studio.example.test', 'file:///tmp/tidebot', 'https://test:secret@example.test',
    'https://example.test/api', 'https://example.test/?token=example', 'https://example.test/#settings',
    'localhost:8787', 'javascript:alert(1)',
  ]) assert.throws(() => serverOrigin(address), Error);
});

test('the probe requires the TideBot desktop marker and does not follow redirects', async (t) => {
  let response = { application: 'tidebot', apiVersion: 1, web: true };
  let mode = 'json';
  let visitedRedirect = false;
  const server = createServer((req, res) => {
    if (req.url === '/elsewhere') { visitedRedirect = true; return res.end(); }
    assert.equal(req.url, '/api/desktop');
    if (mode === 'redirect') { res.writeHead(302, { Location: '/elsewhere' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': mode === 'html' ? 'text/html' : 'application/json' });
    res.end(JSON.stringify(response));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await checkServer(origin + '/'), origin);
  response = { ok: true };
  await assert.rejects(checkServer(origin), /compatible TideBot server/);
  response = { application: 'tidebot', apiVersion: 1, web: false };
  await assert.rejects(checkServer(origin), /compatible TideBot server/);
  response = { data: 'x'.repeat(4097) };
  await assert.rejects(checkServer(origin), /invalid connection response/);
  mode = 'html';
  await assert.rejects(checkServer(origin), /compatible TideBot server/);
  mode = 'redirect';
  await assert.rejects(checkServer(origin), /Could not connect/);
  assert.equal(visitedRedirect, false);
});
