import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const main = new URL('../desktop/main.cjs', import.meta.url);
const source = readFileSync(main, 'utf8');

function updaterFixture(signature) {
  const app = Object.assign(new EventEmitter(), {
    isPackaged: true,
    requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}),
  });
  const autoUpdater = new EventEmitter();
  let installs = 0;
  let stops = 0;
  autoUpdater.quitAndInstall = () => { installs++; };
  const dialogs = [];
  const opened = [];
  const require = createRequire(main);
  const context = {
    require(name) {
      if (name === 'electron') return {
        app,
        ipcMain: { handle() {} },
        dialog: { showMessageBox: async (_window, options) => {
          dialogs.push(options);
          return { response: 0 };
        } },
        shell: { openExternal: async (url) => { opened.push(url); } },
      };
      if (name === 'electron-updater') return { autoUpdater };
      if (name === 'node:child_process') return { spawnSync: () => signature };
      if (name === './git-review.cjs') return {};
      return require(name);
    },
    process: { platform: 'darwin', execPath: '/Applications/TideBot.app/Contents/MacOS/TideBot' },
    console: { error() {} },
    __dirname: fileURLToPath(new URL('.', main)),
    setTimeout() {},
    setInterval() {},
    stopChild: () => { stops++; },
  };
  runInNewContext(source + `
    serverProc = { exitCode: null, kill: stopChild };
    setupAutoUpdater();
    manualCheck = true;
  `, context);
  return { app, autoUpdater, dialogs, opened, installs: () => installs, stops: () => stops };
}

test('unsigned Mac builds offer the release download without stopping the server', async () => {
  const fixture = updaterFixture({ status: 1, stderr: 'code object is not signed at all' });
  assert.equal(fixture.autoUpdater.autoDownload, false);
  assert.equal(fixture.autoUpdater.autoInstallOnAppQuit, false);
  fixture.autoUpdater.emit('update-available', { version: '1.2.3' });
  await new Promise(setImmediate);
  assert.match(fixture.dialogs[0].message, /1\.2\.3/);
  assert.deepEqual(fixture.opened, ['https://github.com/asjames18/tidebot/releases']);
  assert.equal(fixture.installs(), 0);
  assert.equal(fixture.stops(), 0);
});

test('a signed Mac update keeps the server running until Electron quits', async () => {
  const fixture = updaterFixture({ status: 0, stderr: 'Authority=Developer ID Application: TideBot (TEST)\n' });
  assert.equal(fixture.autoUpdater.autoDownload, true);
  fixture.autoUpdater.emit('update-downloaded', { version: '1.2.3' });
  await new Promise(setImmediate);
  assert.equal(fixture.installs(), 1);
  assert.equal(fixture.stops(), 0);
  fixture.autoUpdater.emit('error', new Error('Update signing verification failed'));
  await new Promise(setImmediate);
  assert.match(fixture.dialogs.at(-1).detail, /Update signing verification failed/);
  assert.equal(fixture.stops(), 0);
  fixture.app.emit('before-quit');
  assert.equal(fixture.stops(), 1);
});
