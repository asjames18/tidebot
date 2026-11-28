import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_SEC = 30;
const MIN_TIMEOUT_SEC = 0.1;
const MAX_TIMEOUT_SEC = 600;

/** Clamp shell timeout to a positive finite range so `0`/`NaN`/negative values never disable Node's execFile timeout. */
export function clampTimeoutSec(timeoutSec: number): number {
  if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) return DEFAULT_TIMEOUT_SEC;
  return Math.min(MAX_TIMEOUT_SEC, Math.max(MIN_TIMEOUT_SEC, timeoutSec));
}

/** Format execFile failures clearly without leaking host `bwrap` arguments/paths. */
export function formatShellError(err: any, timeoutSec: number): { code: number; output: string } {
  const code = typeof err?.code === 'number' ? err.code : 1;
  const parts: string[] = [];
  if (err?.stdout) parts.push(String(err.stdout));
  if (err?.stderr) parts.push(String(err.stderr));
  if (err?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    parts.push('Command output exceeded the 2 MiB limit.');
  } else if (err?.killed && err?.signal) {
    parts.push(`Command timed out after ${timeoutSec}s (${err.signal}).`);
  } else if (!parts.length && err?.message) {
    const msg = String(err.message);
    parts.push(msg.startsWith('Command failed:') ? 'Command failed.' : msg);
  }
  return { code, output: parts.join('\n') };
}

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

const isolationFlags = ['--unshare-net', '--unshare-pid', '--proc', '/proc', '--dev', '/dev'];
// Bubblewrap starts with an empty root. Expose runtime binaries/libraries, not host data.
function runtimeMounts(): string[] {
  return ['/bin', '/lib', '/lib64', '/usr/bin', '/usr/lib', '/usr/lib64']
    .filter(dir => fs.existsSync(dir))
    .flatMap(dir => ['--ro-bind', dir, dir]);
}
let usable: boolean | undefined;
async function probeBwrap(bwrap: string): Promise<boolean> {
  if (usable !== undefined) return usable;
  try {
    await execFileAsync(bwrap, [...isolationFlags, ...runtimeMounts(), '--', '/bin/true'], { timeout: 5_000 });
    return usable = true;
  } catch {
    return usable = false;
  }
}

export interface ShellOutcome { code: number; output: string; sandboxed: boolean }

/**
 * Test seam for the fail-closed path: lets tests force Bubblewrap discovery /
 * the isolation probe to fail without mocking node:child_process. Production
 * callers pass nothing, so the real lookup and probe always run.
 */
export interface ShellDeps {
  findBwrap?: () => string | null;
  probeBwrap?: (bwrap: string) => Promise<boolean>;
}

/** Execute only through Bubblewrap with filesystem, network and PID isolation. */
export async function runShell(command: string, workspace: string, timeoutSec: number, deps: ShellDeps = {}): Promise<ShellOutcome> {
  const bwrap = (deps.findBwrap ?? findBwrap)();
  if (!bwrap || !await (deps.probeBwrap ?? probeBwrap)(bwrap)) {
    return { code: 1, output: 'Shell disabled: Bubblewrap isolation is unavailable. Command was not run.', sandboxed: false };
  }
  const safeTimeoutSec = clampTimeoutSec(timeoutSec);
  const timeout = Math.round(safeTimeoutSec * 1000);
  const maxBuffer = 2 * 1024 * 1024;
  const args: string[] = [...isolationFlags, '--die-with-parent', ...runtimeMounts(), '--tmpfs', '/tmp',
    '--bind', path.resolve(workspace), '/workspace'];
  args.push('--clearenv');
  for (const [k, v] of Object.entries(shellEnv('/workspace'))) if (v) args.push('--setenv', k, v);
  args.push('--chdir', '/workspace', '--', '/bin/bash', '-c', command);
  try {
    const { stdout, stderr } = await execFileAsync(bwrap, args, { timeout, maxBuffer });
    return { code: 0, output: `${stdout ?? ''}${stderr ? `\n${stderr}` : ''}`, sandboxed: true };
  } catch (e: any) {
    return { ...formatShellError(e, safeTimeoutSec), sandboxed: true };
  }
}
