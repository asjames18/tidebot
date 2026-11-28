import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import connection from '../desktop/connection.cjs';

const { checkServer, isJsonContentType, serverOrigin } = connection;

test('serverOrigin rejects blank addresses and embedded control characters', () => {
  assert.throws(() => serverOrigin(''), /Enter a server address/);
  assert.throws(() => serverOrigin('   '), /Enter a server address/);
  assert.throws(() => serverOrigin('https://example.test\n/ignored'), /full server address/);
  assert.throws(() => serverOrigin('https://ex\tample.test'), /full server address/);
  assert.throws(() => serverOrigin('https://example\r.test'), /full server address/);
});

test('isJsonContentType matches exact application/json media type case-insensitively', () => {
  assert.equal(isJsonContentType('application/json'), true);
  assert.equal(isJsonContentType('Application/JSON; charset=utf-8'), true);
  assert.equal(isJsonContentType('  APPLICATION/JSON ; charset=UTF-8 '), true);
  assert.equal(isJsonContentType('text/plain; x=application/json'), false);
  assert.equal(isJsonContentType('application/json-patch+json'), false);
  assert.equal(isJsonContentType(null), false);
});

test('checkServer handles uppercase Content-Type, rejects bogus JSON subtypes, and decodes split UTF-8 chunks', async (t) => {
  let mode = 'upper-ct';
  const server = createServer((req, res) => {
    assert.equal(req.url, '/api/desktop');
    if (mode === 'upper-ct') {
      res.writeHead(200, { 'Content-Type': 'Application/JSON; charset=utf-8' });
      res.end(JSON.stringify({ application: 'tidebot', apiVersion: 1, web: true }));
      return;
    }
    if (mode === 'fake-ct') {
      res.writeHead(200, { 'Content-Type': 'text/plain; note=application/json' });
      res.end(JSON.stringify({ application: 'tidebot', apiVersion: 1, web: true }));
      return;
    }
    if (mode === 'split-utf8') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      // Split a 4-byte emoji UTF-8 sequence across two chunks to verify lossless decoding.
      const payload = Buffer.from(JSON.stringify({ application: 'tidebot', apiVersion: 1, web: true, label: '🌊' }), 'utf8');
      const emojiIdx = payload.indexOf(Buffer.from('🌊', 'utf8'));
      res.write(payload.subarray(0, emojiIdx + 2));
      setTimeout(() => res.end(payload.subarray(emojiIdx + 2)), 10);
      return;
    }
    if (mode === 'reset-mid-body') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '100' });
      res.write('{"application":"tide');
      setTimeout(() => req.socket.destroy(), 10);
      return;
    }
    if (mode === 'stall-mid-body') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"application":"tide');
      // Intentionally leave open until client timeout aborts.
      return;
    }
    if (mode === 'oversize-chunks') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"data":"' + 'a'.repeat(2500));
      setTimeout(() => res.end('b'.repeat(2500) + '"}'), 10);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(resolve);
  }));

  const origin = `http://127.0.0.1:${server.address().port}`;

  assert.equal(await checkServer(origin), origin);

  mode = 'fake-ct';
  await assert.rejects(checkServer(origin), /compatible TideBot server/);

  mode = 'split-utf8';
  assert.equal(await checkServer(origin), origin);

  mode = 'reset-mid-body';
  await assert.rejects(checkServer(origin), /Could not connect/);

  mode = 'stall-mid-body';
  await assert.rejects(checkServer(origin, { timeoutMs: 120 }), /Could not connect/);

  mode = 'oversize-chunks';
  await assert.rejects(checkServer(origin), /invalid connection response/);
});
