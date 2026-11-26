import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import connection from '../desktop/connection.cjs';

const { checkServer, serverOrigin } = connection;

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
