#!/usr/bin/env node
/**
 * Stages the compiled TideBot web + server bundles and server production dependencies
 * into desktop/staged/ and rebuilds native addons (better-sqlite3) for Electron's ABI.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopDir, '..');
const stagedDir = path.join(desktopDir, 'staged');
const stagedServer = path.join(stagedDir, 'server');
const stagedWeb = path.join(stagedDir, 'web');
const buildDir = path.join(desktopDir, 'build');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(cmd, args, cwd) {
  console.log(`[stage] ${cmd} ${args.join(' ')} (cwd: ${cwd})`);
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}

// Ensure root web & server builds exist
const webDistSrc = path.join(repoRoot, 'web', 'dist');
const serverDistSrc = path.join(repoRoot, 'server', 'dist');
if (!fs.existsSync(webDistSrc) || !fs.existsSync(serverDistSrc)) {
  run(npmCmd, ['run', 'build'], repoRoot);
}

// Clean & recreate staged directory
fs.rmSync(stagedDir, { recursive: true, force: true });
fs.mkdirSync(stagedServer, { recursive: true });
fs.mkdirSync(stagedWeb, { recursive: true });
fs.mkdirSync(buildDir, { recursive: true });

// Copy app icon (512x512 PNG — electron-builder converts for win/mac/linux)
const iconSrc = path.join(repoRoot, 'web', 'public', 'icon-512.png');
if (fs.existsSync(iconSrc)) {
  fs.copyFileSync(iconSrc, path.join(buildDir, 'icon.png'));
}

// Copy web/dist and server/dist
fs.cpSync(webDistSrc, path.join(stagedWeb, 'dist'), { recursive: true });
fs.cpSync(serverDistSrc, path.join(stagedServer, 'dist'), { recursive: true });

// Copy server/package.json (strip devDependencies so only runtime deps install)
const serverPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'server', 'package.json'), 'utf8'));
delete serverPkg.devDependencies;
fs.writeFileSync(path.join(stagedServer, 'package.json'), JSON.stringify(serverPkg, null, 2) + '\n');

// Install production runtime dependencies for the server
run(npmCmd, ['install', '--omit=dev', '--no-audit', '--no-fund'], stagedServer);

// Rebuild native addon (better-sqlite3) for Electron's Node ABI
const electronPkg = JSON.parse(
  fs.readFileSync(path.join(desktopDir, 'node_modules', 'electron', 'package.json'), 'utf8'),
);
const electronVersion = electronPkg.version;
const rebuildArgs = ['@electron/rebuild', '-f', '-w', 'better-sqlite3', '-v', electronVersion, '-m', stagedServer];
if (process.env.TARGET_ARCH) {
  rebuildArgs.push('-a', process.env.TARGET_ARCH);
}
run(npxCmd, rebuildArgs, desktopDir);

console.log(`[stage] Ready in ${stagedDir} (Electron ${electronVersion})`);
