import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveElectronBuilderCli } from '../desktop/scripts/eb-cli.mjs';

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
