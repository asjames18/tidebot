#!/usr/bin/env node
/**
 * Runs the local electron-builder CLI with Node directly.
 *
 * Calling electron-builder through `npx` is unreliable on Windows, and even a
 * direct `node scripts/eb-cli.mjs ... -c.publish.releaseType=prerelease` step
 * breaks under PowerShell, which splits that token at the dot and hands the CLI
 * "-c .publish.releaseType=prerelease" (electron-builder then tries to open it
 * as a file). So this wrapper takes a shell-safe `--release-type <value>` and
 * builds the `-c.publish.releaseType=<value>` argument itself, in argv.
 *
 * Usage: node scripts/eb-cli.mjs --win --publish always --release-type prerelease
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

const VALID_RELEASE_TYPES = new Set(['draft', 'prerelease', 'release']);

/**
 * Translate wrapper arguments into electron-builder arguments.
 * `--release-type <value>` (or RELEASE_TYPE in the environment) becomes
 * `-c.publish.releaseType=<value>`; everything else is forwarded untouched.
 */
export function buildElectronBuilderArgs(argv, releaseTypeFromEnv = '') {
  const forwarded = [];
  let releaseType = (releaseTypeFromEnv || '').trim();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--release-type') {
      const next = (argv[i + 1] ?? '').trim();
      if (!next || next.startsWith('-')) {
        throw new Error('--release-type requires a value (draft, prerelease, or release).');
      }
      releaseType = next;
      i++;
      continue;
    }
    if (arg.startsWith('--release-type=')) {
      const value = arg.slice('--release-type='.length).trim();
      if (!value) {
        throw new Error('--release-type= requires a value (draft, prerelease, or release).');
      }
      releaseType = value;
      continue;
    }
    forwarded.push(arg);
  }
  if (releaseType) {
    if (!VALID_RELEASE_TYPES.has(releaseType)) {
      throw new Error(`Invalid release type "${releaseType}" (expected draft, prerelease, or release).`);
    }
    forwarded.push(`-c.publish.releaseType=${releaseType}`);
  }
  return forwarded;
}

const entry = process.argv[1];
const isMain = entry && fs.existsSync(entry) && fs.realpathSync(entry) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  const cli = resolveElectronBuilderCli(desktopDir);
  const args = buildElectronBuilderArgs(process.argv.slice(2), process.env.RELEASE_TYPE);
  console.log(`[eb-cli] node ${path.relative(desktopDir, cli)} ${args.join(' ')}`);
  execFileSync(process.execPath, [cli, ...args], { cwd: desktopDir, stdio: 'inherit' });
}
