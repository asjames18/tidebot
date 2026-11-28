import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quoteForCmd, buildWindowsCommand } from '../desktop/scripts/cmd.mjs';

test('leaves simple arguments unquoted', () => {
  assert.equal(quoteForCmd('--omit=dev'), '--omit=dev');
  assert.equal(quoteForCmd('@electron/rebuild'), '@electron/rebuild');
  assert.equal(quoteForCmd('/home/runner/work/tidebot'), '/home/runner/work/tidebot');
});

test('quotes arguments with spaces or cmd metacharacters', () => {
  assert.equal(quoteForCmd('C:\\Program Files\\TideBot'), '"C:\\Program Files\\TideBot"');
  assert.equal(quoteForCmd('a&b'), '"a&b"');
  assert.equal(quoteForCmd(''), '""');
});

test('escapes embedded quotes and preserves trailing backslashes', () => {
  assert.equal(quoteForCmd('say "hi"'), '"say \\"hi\\""');
  assert.equal(quoteForCmd('C:\\path with space\\'), '"C:\\path with space\\\\"');
});

test('builds a cmd.exe command line with the executable first', () => {
  assert.equal(
    buildWindowsCommand('npm.cmd', ['install', '--omit=dev']),
    'npm.cmd install --omit=dev',
  );
  assert.equal(
    buildWindowsCommand('npx.cmd', ['-m', 'C:\\a b\\server']),
    'npx.cmd -m "C:\\a b\\server"',
  );
  assert.equal(
    buildWindowsCommand('C:\\Program Files\\nodejs\\npm.cmd', ['install']),
    '"C:\\Program Files\\nodejs\\npm.cmd" install',
  );
});

test('rejects CR/LF/NUL injection characters and empty commands', () => {
  for (const bad of ['ok\ncalc.exe', 'ok\rcalc.exe', 'ok\0bad']) {
    assert.throws(() => quoteForCmd(bad), /CR, LF, or NUL/);
    assert.throws(() => buildWindowsCommand('npm.cmd', [bad]), /CR, LF, or NUL/);
    assert.throws(() => buildWindowsCommand(bad, []), /CR, LF, or NUL/);
  }
  assert.throws(() => buildWindowsCommand('', ['install']), /non-empty/);
  assert.throws(() => buildWindowsCommand('   ', ['install']), /non-empty/);
});
