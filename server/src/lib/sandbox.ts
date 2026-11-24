import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';

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
    await execFileAsync(bwrap, [...isolationFlags, ...runtimeMounts(), '/bin/true'], { timeout: 5_000 });
    return usable = true;
  } catch {
    return usable = false;
  }
}

export interface ShellOutcome { code: number; output: string; sandboxed: boolean }

/** Execute only through Bubblewrap with filesystem, network and PID isolation. */
export async function runShell(command: string, workspace: string, timeoutSec: number): Promise<ShellOutcome> {
  const bwrap = findBwrap();
  if (!bwrap || !await probeBwrap(bwrap)) {
    return { code: 1, output: 'Shell disabled: Bubblewrap isolation is unavailable. Command was not run.', sandboxed: false };
  }
  const timeout = timeoutSec * 1000;
  const maxBuffer = 2 * 1024 * 1024;
  const args: string[] = [...isolationFlags, '--die-with-parent', ...runtimeMounts(), '--tmpfs', '/tmp',
    '--bind', workspace, '/workspace'];
  args.push('--clearenv');
  for (const [k, v] of Object.entries(shellEnv('/workspace'))) if (v) args.push('--setenv', k, v);
  args.push('--chdir', '/workspace', '/bin/bash', '-c', command);
  try {
    const { stdout, stderr } = await execFileAsync(bwrap, args, { timeout, maxBuffer });
    return { code: 0, output: `${stdout ?? ''}${stderr ? `\n${stderr}` : ''}`, sandboxed: true };
  } catch (e: any) {
    return { code: typeof e?.code === 'number' ? e.code : 1, output: `${e?.stdout ?? ''}\n${e?.stderr ?? e?.message ?? ''}`, sandboxed: true };
  }
}
