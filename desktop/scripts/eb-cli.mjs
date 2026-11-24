#!/usr/bin/env node
/**
 * Runs the local electron-builder CLI with Node directly.
 *
 * Calling electron-builder through `npx` is unreliable on Windows: npm's own
 * argument parsing can consume flags, and the error surfaces as electron-builder
 * treating a stripped flag (".publish.releaseType=prerelease") as a file path.
 * Invoking the CLI's JS entry with process.execPath keeps the argv intact on
 * every platform.
 *
 * Usage: node scripts/eb-cli.mjs --win --publish always -c.publish.releaseType=prerelease
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, '..');

/** Locate electron-builder's CLI entry inside a desktop project directory. */
export function resolveElectronBuilderCli(dir) {
  const candidates = [
    path.join(dir, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'),
    path.join(dir, 'node_modules', 'electron-builder', 'cli.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`electron-builder CLI not found under ${dir}; run npm install there first.`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const cli = resolveElectronBuilderCli(desktopDir);
  const args = process.argv.slice(2);
  console.log(`[eb-cli] node ${path.relative(desktopDir, cli)} ${args.join(' ')}`);
  execFileSync(process.execPath, [cli, ...args], { cwd: desktopDir, stdio: 'inherit' });
}
