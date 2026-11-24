import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildElectronBuilderArgs, resolveElectronBuilderCli } from '../desktop/scripts/eb-cli.mjs';

const wrapperSrc = path.join(import.meta.dirname, '..', 'desktop', 'scripts', 'eb-cli.mjs');

function fixture(withCli) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-eb-'));
  if (withCli) {
    const cli = path.join(dir, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(cli, '// stub\n');
  }
  return dir;
}

test('resolves the electron-builder CLI entry point', () => {
  const dir = fixture(true);
  assert.equal(
    resolveElectronBuilderCli(dir),
    path.join(dir, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'),
  );
});

test('throws a helpful error when dependencies are not installed', () => {
  const dir = fixture(false);
  assert.throws(() => resolveElectronBuilderCli(dir), /run npm install/);
});

test('turns --release-type into the electron-builder config flag', () => {
  assert.deepEqual(
    buildElectronBuilderArgs(['--win', '--publish', 'always', '--release-type', 'prerelease']),
    ['--win', '--publish', 'always', '-c.publish.releaseType=prerelease'],
  );
  assert.deepEqual(
    buildElectronBuilderArgs(['--mac', '--arm64', '--release-type=release'], ''),
    ['--mac', '--arm64', '-c.publish.releaseType=release'],
  );
});

test('omits the config flag when no release type is given', () => {
  assert.deepEqual(buildElectronBuilderArgs(['--linux', '--publish', 'always']), [
    '--linux',
    '--publish',
    'always',
  ]);
});

test('prefers an explicit argument over the environment value', () => {
  assert.deepEqual(buildElectronBuilderArgs(['--win', '--release-type', 'release'], 'prerelease'), [
    '--win',
    '-c.publish.releaseType=release',
  ]);
});

test('forwards the built flag to the CLI as a single argv entry', () => {
  // End-to-end through a real child process: proves the release-type flag
  // reaches electron-builder unsplit, without relying on shell quoting.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-eb-run-'));
  const scripts = path.join(root, 'desktop', 'scripts');
  const cliDir = path.join(root, 'desktop', 'node_modules', 'electron-builder', 'out', 'cli');
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(cliDir, { recursive: true });
  fs.copyFileSync(wrapperSrc, path.join(scripts, 'eb-cli.mjs'));
  fs.writeFileSync(path.join(cliDir, 'cli.js'), 'console.log(JSON.stringify(process.argv.slice(2)));\n');

  const out = execFileSync(
    process.execPath,
    [path.join(scripts, 'eb-cli.mjs'), '--win', '--publish', 'always', '--release-type', 'prerelease'],
    { encoding: 'utf8' },
  );
  const argvLine = out.trim().split('\n').pop();
  assert.deepEqual(JSON.parse(argvLine), [
    '--win',
    '--publish',
    'always',
    '-c.publish.releaseType=prerelease',
  ]);
});
