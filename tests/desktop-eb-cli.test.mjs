import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildElectronBuilderArgs, resolveElectronBuilderCli } from '../desktop/scripts/eb-cli.mjs';

const wrapperSrc = path.join(import.meta.dirname, '..', 'desktop', 'scripts', 'eb-cli.mjs');
const manifestScript = path.join(import.meta.dirname, '..', 'desktop', 'scripts', 'mac-update-manifest.mjs');

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

test('writes one Mac update manifest with verified assets for both architectures', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-mac-update-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const intel = path.join(root, 'mac-x64');
  const apple = path.join(root, 'mac-arm64');
  fs.mkdirSync(intel);
  fs.mkdirSync(apple);
  const version = '1.0.0-dev.1';
  const prefix = `TideBot-${version}`;
  const manifestPath = path.join(root, 'latest-mac.yml');
  const assets = [
    [intel, `${prefix}-mac.zip`], [apple, `${prefix}-arm64-mac.zip`],
    [intel, `${prefix}.dmg`], [apple, `${prefix}-arm64.dmg`],
  ];
  const expected = assets.map(([directory, name]) => {
    const contents = Buffer.from(`Fixture ${name}`);
    fs.writeFileSync(path.join(directory, name), contents);
    return { url: name, size: contents.length, sha512: createHash('sha512').update(contents).digest('base64') };
  });
  const args = [manifestScript, version, intel, apple, manifestPath];
  execFileSync(process.execPath, args);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.version, version);
  assert.equal(manifest.path, expected[0].url);
  assert.equal(manifest.sha512, expected[0].sha512);
  assert.deepEqual(manifest.files, expected);

  fs.unlinkSync(path.join(...assets[1]));
  assert.throws(() => execFileSync(process.execPath, args, { stdio: 'pipe' }), /ENOENT/);
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
