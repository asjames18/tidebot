import { exec, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/** Environment for agent shell commands: allowlist only, never the server's secrets. */
export function shellEnv(workspace: string): NodeJS.ProcessEnv {
  return {
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOME: workspace,
    TMPDIR: '/tmp',
    LANG: process.env.LANG || 'C.UTF-8',
    TERM: 'xterm',
  };
}

let bwrapPath: string | null | undefined;
export function findBwrap(): string | null {
  if (bwrapPath !== undefined) return bwrapPath;
  for (const p of ['/usr/bin/bwrap', '/bin/bwrap', '/usr/local/bin/bwrap']) {
    if (fs.existsSync(p)) { bwrapPath = p; return bwrapPath; }
  }
  bwrapPath = null;
  return null;
}

type BwrapMode = 'full' | 'fs-only' | 'minimal' | 'none';
const MODE_FLAGS: Record<Exclude<BwrapMode, 'none'>, string[]> = {
  full: ['--unshare-net', '--unshare-pid', '--proc', '/proc', '--dev', '/dev'],
  'fs-only': ['--unshare-pid', '--proc', '/proc', '--dev', '/dev'],
  minimal: [],
};
let bwrapMode: BwrapMode | undefined;
async function probeBwrap(bwrap: string): Promise<BwrapMode> {
  if (bwrapMode !== undefined) return bwrapMode;
  for (const mode of ['full', 'fs-only', 'minimal'] as const) {
    try {
      await execFileAsync(bwrap, [...MODE_FLAGS[mode], '--ro-bind', '/', '/', '/bin/true'], { timeout: 5_000 });
      bwrapMode = mode;
      if (mode !== 'full') console.warn(`[sandbox] bubblewrap running in ${mode} mode here; network/process isolation reduced (approval gating still applies)`);
      return bwrapMode;
    } catch { /* try weaker mode */ }
  }
  bwrapMode = 'none';
  console.warn('[sandbox] bubblewrap present but unusable here; shell falls back to sanitized-env exec (approval gating still applies)');
  return bwrapMode;
}

export interface ShellOutcome { code: number; output: string; sandboxed: boolean }

/**
 * Run a bash command in the bot workspace. With bubblewrap available the
 * command is jailed: read-only root, only its own workspace writable, the
 * data directory (DB, .env neighbours, other bots) hidden, no network and a
 * sanitized environment. Without bubblewrap it falls back to a sanitized-env
 * exec in the workspace (approval gating remains the control there).
 */
export async function runShell(command: string, workspace: string, timeoutSec: number): Promise<ShellOutcome> {
  const found = findBwrap();
  const mode = found ? await probeBwrap(found) : 'none';
  const bwrap = found && mode !== 'none' ? found : null;
  const timeout = timeoutSec * 1000;
  const maxBuffer = 2 * 1024 * 1024;
  if (!bwrap) {
    try {
      const { stdout, stderr } = await execAsync(command, { cwd: workspace, timeout, maxBuffer, env: shellEnv(workspace) });
      return { code: 0, output: `${stdout ?? ''}${stderr ? `\n${stderr}` : ''}`, sandboxed: false };
    } catch (e: any) {
      return { code: typeof e?.code === 'number' ? e.code : 1, output: `${e?.stdout ?? ''}\n${e?.stderr ?? e?.message ?? ''}`, sandboxed: false };
    }
  }
  const dataDir = path.resolve(workspace, '../..');
  const repoDir = path.resolve(workspace, '../../..');
  const hide = [...new Set([dataDir, repoDir])];
  const args: string[] = [...MODE_FLAGS[mode as Exclude<BwrapMode, 'none'>], '--die-with-parent', '--ro-bind', '/', '/'];
  for (const dir of hide) args.push('--tmpfs', dir);
  args.push('--dir', workspace, '--bind', workspace, workspace);
  if (workspace !== '/tmp' && !workspace.startsWith('/tmp/')) args.push('--tmpfs', '/tmp');
  args.push('--clearenv');
  for (const [k, v] of Object.entries(shellEnv(workspace))) if (v) args.push('--setenv', k, v);
  args.push('--chdir', workspace, '/bin/bash', '-c', command);
  try {
    const { stdout, stderr } = await execFileAsync(bwrap, args, { timeout, maxBuffer });
    return { code: 0, output: `${stdout ?? ''}${stderr ? `\n${stderr}` : ''}`, sandboxed: true };
  } catch (e: any) {
    return { code: typeof e?.code === 'number' ? e.code : 1, output: `${e?.stdout ?? ''}\n${e?.stderr ?? e?.message ?? ''}`, sandboxed: true };
  }
}
