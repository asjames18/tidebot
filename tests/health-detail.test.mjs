import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildHealthDetail, checkDatabaseFile, checkSandbox } from '../server/src/lib/health.ts';

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-health-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('checkDatabaseFile: existing file is readable and writable', (t) => {
  const dir = tmpDir(t);
  const dbPath = path.join(dir, 'test.db');
  fs.writeFileSync(dbPath, 'not-a-real-db');
  assert.deepEqual(checkDatabaseFile(dbPath), { path: dbPath, exists: true, readable: true, writable: true });
});

test('checkDatabaseFile: missing file in a writable dir is writable, not readable', (t) => {
  const dir = tmpDir(t);
  const dbPath = path.join(dir, 'missing.db');
  assert.deepEqual(checkDatabaseFile(dbPath), { path: dbPath, exists: false, readable: false, writable: true });
});

test('checkDatabaseFile: missing file in a missing dir is not writable', (t) => {
  const dir = tmpDir(t);
  const dbPath = path.join(dir, 'no-such-dir', 'missing.db');
  assert.deepEqual(checkDatabaseFile(dbPath), { path: dbPath, exists: false, readable: false, writable: false });
});

test('checkDatabaseFile does not modify the file', (t) => {
  const dir = tmpDir(t);
  const dbPath = path.join(dir, 'test.db');
  fs.writeFileSync(dbPath, 'sentinel-bytes');
  const before = fs.readFileSync(dbPath, 'utf8');
  checkDatabaseFile(dbPath);
  assert.equal(fs.readFileSync(dbPath, 'utf8'), before);
});

test('checkSandbox reports installed as a boolean and path as string-or-null', () => {
  const s = checkSandbox();
  assert.equal(typeof s.bubblewrap.installed, 'boolean');
  assert.ok(s.bubblewrap.path === null || typeof s.bubblewrap.path === 'string');
  assert.equal(s.bubblewrap.installed, s.bubblewrap.path !== null);
});

test('buildHealthDetail reports providers as booleans only, never key material', (t) => {
  const dir = tmpDir(t);
  const dbPath = path.join(dir, 'test.db');
  fs.writeFileSync(dbPath, 'x');
  const detail = buildHealthDetail({
    nodeVersion: 'v22.0.0',
    dbPath,
    providers: { openrouter: true, custom: false, xai: false, composio: true, orgo: false },
  });
  assert.equal(detail.ok, true);
  assert.equal(detail.node, 'v22.0.0');
  assert.equal(detail.database.path, dbPath);
  assert.equal(detail.database.writable, true);
  for (const v of Object.values(detail.providers)) assert.equal(typeof v, 'boolean');
  assert.doesNotMatch(JSON.stringify(detail), /sk-/);
});

function runDoctor(env) {
  const doctorPath = fileURLToPath(new URL('../scripts/doctor.mjs', import.meta.url));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [doctorPath], {
      env: { ...process.env, ...env },
      timeout: 10_000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('doctor prints one line per check against a stub server', async (t) => {
  const payload = {
    ok: true,
    node: 'v22.0.0',
    database: { path: '/tmp/fixture.db', exists: true, readable: true, writable: true },
    sandbox: { bubblewrap: { installed: false, path: null } },
    providers: { openrouter: true, custom: false, xai: false, composio: false, orgo: false },
  };
  const server = http.createServer((req, res) => {
    assert.equal(new URL(req.url, 'http://127.0.0.1').pathname, '/api/health');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const { code, stdout, stderr } = await runDoctor({ PORT: String(port) });
  assert.equal(code, 0);
  assert.equal(stderr, '');
  assert.match(stdout, /node: v22\.0\.0/);
  assert.match(stdout, /database: \/tmp\/fixture\.db — exists, readable=true, writable=true/);
  assert.match(stdout, /sandbox: bubblewrap not installed/);
  assert.match(stdout, /providers configured: openrouter/);
});

test('doctor exits non-zero when no server is listening', async () => {
  const { code, stderr } = await runDoctor({ PORT: '1' });
  assert.notEqual(code, 0);
  assert.match(stderr, /not reachable/);
});

test('doctor reports an invalid health response without dumping a stack trace', async (t) => {
  const server = http.createServer((_req, res) => {
    res.end('<html>Wrong service</html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const { code, stdout, stderr } = await runDoctor({ PORT: String(server.address().port) });
  assert.equal(code, 1);
  assert.equal(stdout, '');
  assert.match(stderr, /^doctor: .*invalid health response[^\n]*\n$/);
});

test('doctor times out when the health response body stalls', async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const { code, stderr } = await runDoctor({ PORT: String(server.address().port) });
  assert.equal(code, 1);
  assert.match(stderr, /^doctor: .*timed out[^\n]*\n$/);
});
