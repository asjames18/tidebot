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
});
