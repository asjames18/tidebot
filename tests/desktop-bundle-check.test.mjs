import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import checkServerBundle from '../desktop/scripts/check-server-bundle.cjs';

function makeBundle(t, { withEntry = true, dependencies = {}, withNodeModules = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-bundle-check-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const resources = path.join(root, 'app', 'resources');
  const server = path.join(resources, 'server');
  fs.mkdirSync(path.join(server, 'dist'), { recursive: true });
  if (withEntry) fs.writeFileSync(path.join(server, 'dist', 'index.js'), 'export {};\n');
  fs.writeFileSync(path.join(server, 'package.json'), JSON.stringify({ name: 'test-server', type: 'module', dependencies }));
  if (withNodeModules) fs.mkdirSync(path.join(server, 'node_modules'), { recursive: true });
  const ctx = {
    appOutDir: path.join(root, 'app'),
    packager: { getResourcesDir: (dir) => path.join(dir, 'resources') },
  };
  return { root, server, ctx };
}

function writePkg(nodeModulesDir, name, pkgJson, files = {}) {
  const dir = path.join(nodeModulesDir, ...name.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...pkgJson }));
  for (const [rel, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

test('accepts bundled CJS, scoped, and ESM-only dependencies', async (t) => {
  const { server, ctx } = makeBundle(t, {
    dependencies: { 'cjs-dep': '^1.0.0', '@scope/esm-only': '^1.0.0' },
  });
  const nm = path.join(server, 'node_modules');
  writePkg(nm, 'cjs-dep', { main: 'index.js' }, { 'index.js': 'module.exports = {};\n' });
  writePkg(nm, '@scope/esm-only', { type: 'module', exports: { '.': { import: './index.mjs' } } }, { 'index.mjs': 'export default 1;\n' });
  await checkServerBundle(ctx);
});

test('succeeds when manifest omits dependencies', async (t) => {
  const { server, ctx } = makeBundle(t, { withNodeModules: false });
  fs.writeFileSync(path.join(server, 'package.json'), JSON.stringify({ name: 'test-server' }));
  await checkServerBundle(ctx);
});

test('reports missing entry, missing node_modules, and missing dependency clearly', async (t) => {
  const noEntry = makeBundle(t, { withEntry: false });
  await assert.rejects(() => checkServerBundle(noEntry.ctx), /server entry is missing/);

  const noNm = makeBundle(t, { dependencies: { foo: '^1.0.0' }, withNodeModules: false });
  await assert.rejects(() => checkServerBundle(noNm.ctx), /node_modules is missing/);

  const missingDep = makeBundle(t, { dependencies: { 'not-installed-dep': '^1.0.0' } });
  await assert.rejects(() => checkServerBundle(missingDep.ctx), /dependency is missing: not-installed-dep/);
});

test('rejects hoisted or symlinked dependencies resolving outside server/node_modules', async (t) => {
  // Hoisted CJS package in ancestor directory outside resources/server/node_modules.
  const hoisted = makeBundle(t, { dependencies: { 'hoisted-cjs': '^1.0.0' } });
  writePkg(path.join(hoisted.root, 'node_modules'), 'hoisted-cjs', { main: 'index.js' }, { 'index.js': 'module.exports = {};\n' });
  await assert.rejects(() => checkServerBundle(hoisted.ctx), /resolves outside the bundle: hoisted-cjs/);

  // ESM-only package symlinked outside resources/server/node_modules.
  const linked = makeBundle(t, { dependencies: { 'symlink-esm': '^1.0.0' } });
  const externalDir = writePkg(path.join(linked.root, 'outside'), 'symlink-esm', {
    type: 'module',
    exports: { '.': { import: './index.mjs' } },
  }, { 'index.mjs': 'export default 1;\n' });
  fs.symlinkSync(externalDir, path.join(linked.server, 'node_modules', 'symlink-esm'), 'dir');
  await assert.rejects(() => checkServerBundle(linked.ctx), /resolves outside the bundle: symlink-esm/);
});
