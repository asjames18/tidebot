import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import connection from '../desktop/connection.cjs';

const { checkServer, serverOrigin } = connection;

async function stoppedServerFixture({ nextPort = 8787, response = 0, quitting = false, remote = false } = {}) {
  const app = Object.assign(new EventEmitter(), {
    requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}),
    getPath: () => '/tmp/desktop-connection-fixture',
    getVersion: () => '1.0.0',
  });
  const main = new URL('../desktop/main.cjs', import.meta.url);
  const children = [];
  const dialogs = [];
  const opened = [];
  const require = createRequire(main);
  const context = {
    require(name) {
      if (name === 'electron') return {
        app, ipcMain: { handle() {} },
        dialog: {
          async showMessageBox(_parent, options) { dialogs.push(options); return { response }; },
          showErrorBox(title) { dialogs.push({ title }); },
        },
      };
      if (name === 'electron-updater' || name === './git-review.cjs') return {};
      if (name === 'node:fs') return { existsSync: () => true, mkdirSync() {}, writeFileSync() {} };
      if (name === 'node:child_process') return { spawn() {
        const child = Object.assign(new EventEmitter(), {
          pid: children.length + 1, stdout: new EventEmitter(), stderr: new EventEmitter(),
          exitCode: null, signalCode: null,
        });
        children.push(child);
        return child;
      } };
      return require(name);
    },
    process: { env: {}, execPath: 'tidebot-fixture' },
    __dirname: fileURLToPath(new URL('.', main)),
    getPort: () => children.length ? nextPort : 8787,
    reopen: (origin) => { opened.push(origin); },
    fixtureQuitting: quitting,
    remoteOrigin: remote ? 'https://studio.example.test' : undefined,
  };
  await runInNewContext(readFileSync(main, 'utf8') + `
    chooseServerPort = async () => getPort();
    waitForHealth = async () => {};
    openWorkspace = async (origin) => reopen(origin);
    mainWindow = {};
    (async () => {
      await startServer();
      quitting = fixtureQuitting;
      settings.remoteOrigin = remoteOrigin;
      serverProc.emit('close', 1);
    })();
  `, context);
  await new Promise(setImmediate);
  return { children, dialogs, opened };
}

test('an unexpected server exit can restart on the same port without reopening the workspace', async () => {
  const { children, dialogs, opened } = await stoppedServerFixture();
  assert.equal(dialogs[0]?.buttons?.[0], 'Restart Server');
  assert.equal(children.length, 2);
  assert.deepEqual(opened, []);
});

test('a server restart reopens the workspace if the original port is unavailable', async () => {
  const { opened } = await stoppedServerFixture({ nextPort: 8788 });
  assert.deepEqual(opened, ['http://127.0.0.1:8788']);
});

test('recovery leaves the server stopped when dismissed, quitting, or viewing a remote workspace', async () => {
  const skipped = await stoppedServerFixture({ response: 1 });
  assert.equal(skipped.children.length, 1);
  const quitting = await stoppedServerFixture({ quitting: true });
  assert.equal(quitting.children.length, 1);
  assert.equal(quitting.dialogs.length, 0);
  const remote = await stoppedServerFixture({ remote: true });
  assert.equal(remote.children.length, 1);
  assert.equal(remote.dialogs.length, 0);
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
