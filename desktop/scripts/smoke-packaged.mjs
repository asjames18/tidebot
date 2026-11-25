import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, lstat, mkdtemp, readdir, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';

const output = path.resolve(process.argv[2] ?? 'desktop/dist/qa');
const platform = process.platform;
const folder = (await readdir(output, { withFileTypes: true }))
  .find((entry) => entry.isDirectory() && (platform === 'darwin' ? /^mac(?:-|$)/.test(entry.name) : entry.name.endsWith('-unpacked')));
assert.ok(folder, `No unpacked ${platform} app found in ${output}`);
const buildDir = path.join(output, folder.name);
const temp = await mkdtemp(path.join(tmpdir(), 'tidebot-packaged-'));
let child;
try {
  // Run outside the checkout so Node cannot pick up a missing packaged dependency.
  const copied = path.join(temp, 'package');
  await cp(buildDir, copied, { recursive: true, verbatimSymlinks: true });
  const bundle = platform === 'darwin' ? path.join(copied, 'TideBot.app', 'Contents') : copied;
  const resources = path.join(bundle, platform === 'darwin' ? 'Resources' : 'resources');
  const candidates = platform === 'darwin' ? ['MacOS/TideBot']
    : platform === 'win32' ? ['TideBot.exe', 'tidebot-desktop.exe'] : ['tidebot-desktop', 'tidebot', 'TideBot'];
  let binary;
  for (const file of candidates) {
    const candidate = path.join(bundle, file);
    if ((await lstat(candidate).catch(() => null))?.isFile()) { binary = candidate; break; }
  }
  assert.ok(binary, `No desktop executable found under ${bundle}`);

  const email = 'fixture@example.test';
  const password = 'packaging-only-test-password';
  const { NODE_PATH, ...environment } = process.env;
  child = spawn(binary, [path.join(resources, 'server', 'dist', 'index.js')], {
    cwd: resources, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...environment, ELECTRON_RUN_AS_NODE: '1', HOST: '127.0.0.1', PORT: '0',
      ENV_PATH: path.join(temp, '.env'), DB_PATH: path.join(temp, 'qa.db'),
      WEB_DIST_DIR: path.join(resources, 'web', 'dist'),
      STUDIO_EMAIL: email, STUDIO_PASSWORD: password, DEV_LOGIN: '0',
      TIDEBOT_DESKTOP_SIGNUP_ORIGIN: '', GROKBOT_NO_SCHEDULER: '1',
    },
  });
  let stderr = '';
  child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-3000); });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Packaged server did not start.\n${stderr}`)), 25_000);
    const fail = (error) => { clearTimeout(timer); reject(error); };
    child.once('error', fail);
    child.once('exit', (code) => fail(new Error(`Packaged server exited (${code}).\n${stderr}`)));
    let stdout = '';
    child.stdout.on('data', (data) => {
      stdout = (stdout + data).slice(-3000);
      const match = stdout.match(/server on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const get = (route, init = {}) => fetch(base + route, { ...init, signal: AbortSignal.timeout(5000) });
  assert.deepEqual(await (await get('/api/health')).json(), { ok: true });
  assert.match(await (await get('/')).text(), /<title>TideBot/);
  const login = await get('/api/auth/password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const { bots } = await (await get('/api/bots', { headers: { cookie } })).json();
  assert.equal(bots[0]?.name, 'Quinn');
  console.log(`Packaged ${platform} ${process.arch} server passed startup, UI serving, SQLite, and password sign-in.`);
} finally {
  if (child && child.exitCode === null && child.signalCode === null && child.pid) {
    const stopped = once(child, 'exit');
    child.kill();
    await stopped;
  }
  await rm(temp, { recursive: true, force: true, maxRetries: 5 });
}
