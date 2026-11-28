// Regression tests for Bubblewrap sandbox timeout clamping and error formatting
// in server/src/lib/sandbox.ts. Never leaks host bwrap command lines or paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clampTimeoutSec, findBwrap, formatShellError, runShell } from '../server/dist/lib/sandbox.js';

test('clampTimeoutSec prevents 0, negative, NaN, and unbounded timeouts', () => {
  assert.equal(clampTimeoutSec(0), 30);
  assert.equal(clampTimeoutSec(-5), 30);
  assert.equal(clampTimeoutSec(Number.NaN), 30);
  assert.equal(clampTimeoutSec(Number.POSITIVE_INFINITY), 30);
  assert.equal(clampTimeoutSec(0.01), 0.1);
  assert.equal(clampTimeoutSec(45), 45);
  assert.equal(clampTimeoutSec(9999), 600);
});

test('formatShellError surfaces timeouts and maxBuffer clearly and hides host bwrap invocations', () => {
  const timedOut = formatShellError(
    { code: null, killed: true, signal: 'SIGTERM', stdout: 'partial\n', stderr: '', message: 'Command failed: /usr/bin/bwrap --bind /secret/host/path /workspace' },
    5,
  );
  assert.equal(timedOut.code, 1);
  assert.match(timedOut.output, /partial/);
  assert.match(timedOut.output, /Command timed out after 5s \(SIGTERM\)/);
  assert.ok(!timedOut.output.includes('/secret/host/path'));

  const overflow = formatShellError(
    { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', stdout: 'lots', stderr: '' },
    30,
  );
  assert.equal(overflow.code, 1);
  assert.match(overflow.output, /exceeded the 2 MiB limit/);

  const leakedCmd = formatShellError(
    { code: 127, stdout: '', stderr: '', message: 'Command failed: /usr/bin/bwrap --bind /home/alice/data/workspaces/bot-1 /workspace' },
    30,
  );
  assert.equal(leakedCmd.code, 127);
  assert.equal(leakedCmd.output, 'Command failed.');
  assert.ok(!leakedCmd.output.includes('/home/alice'));
});

test('runShell reports timeout clearly under Bubblewrap without leaking host workspace path', {
  skip: !findBwrap() ? 'Bubblewrap not installed' : false,
}, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-sandbox-timeout-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const res = await runShell('echo before; sleep 5', dir, 0.3);
  if (!res.sandboxed) {
    t.skip('Bubblewrap unusable in this container');
    return;
  }
  assert.equal(res.code, 1);
  assert.match(res.output, /before/);
  assert.match(res.output, /Command timed out after 0\.3s/);
  assert.ok(!res.output.includes(dir), 'host workspace path must not leak into tool output');
});
