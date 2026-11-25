import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

function lstatIfPresent(target: string) {
  try { return fs.lstatSync(target); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw e;
  }
}

/** Replace regular workspace files without following links or opening special files. */
export function writeWorkspaceFile(root: string, rel: string, content: string): string {
  const parts = rel.split(path.sep === '/' ? '/' : /[\\/]/);
  const invalidPart = (part: string) => !part || part === '.' || part === '..'
    || (process.platform === 'win32' && (part.includes(':') || /[. ]$/.test(part)));
  if (path.isAbsolute(rel) || parts.some(invalidPart)) {
    throw new Error('Invalid workspace path');
  }
  const name = parts.pop()!;
  let fd: number | undefined;
  let temp: string | undefined;
  let parent = fs.realpathSync(root);
  const pinDirectory = (dir: string) => {
    if (process.platform !== 'linux') return dir;
    // Resolve children relative to an open directory even while an Operator shell is running.
    const next = fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    if (fd !== undefined) fs.closeSync(fd);
    fd = next;
    return `/proc/self/fd/${next}`;
  };
  try {
    parent = pinDirectory(parent);
    for (const part of parts) {
      const dir = path.join(parent, part);
      if (!lstatIfPresent(dir)) fs.mkdirSync(dir);
      if (!lstatIfPresent(dir)?.isDirectory()) throw new Error('Invalid workspace directory');
      parent = pinDirectory(dir);
    }
    const target = path.join(parent, name);
    const existing = lstatIfPresent(target);
    if (existing && !existing.isFile()) throw new Error('Target must be a regular workspace file');
    const staged = path.join(parent, `.tidebot-${randomUUID()}.tmp`);
    const output = fs.openSync(staged, 'wx', existing ? existing.mode & 0o777 : 0o600);
    temp = staged;
    try { fs.writeFileSync(output, content, 'utf8'); }
    finally { fs.closeSync(output); }
    fs.renameSync(staged, target);
    temp = undefined;
    return path.join(root, rel);
  } finally {
    try { if (temp) fs.rmSync(temp, { force: true }); }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
}

/**
 * Resolve `rel` inside `root`, rejecting symlink escapes. Returns the absolute
 * target path, or null when the target (or its nearest existing parent for
 * not-yet-created files) resolves outside the workspace root.
 */
export function resolveWithinWorkspace(root: string, rel: string): string | null {
  let realRoot: string;
  try { realRoot = fs.realpathSync(root); } catch { return null; }
  const target = path.join(realRoot, rel);
  let probe = target;
  while (!fs.existsSync(probe) && probe !== realRoot) probe = path.dirname(probe);
  let realProbe: string;
  try { realProbe = fs.realpathSync(probe); } catch { return null; }
  if (realProbe !== realRoot && !realProbe.startsWith(realRoot + path.sep)) return null;
  if (fs.existsSync(target)) {
    let realTarget: string;
    try { realTarget = fs.realpathSync(target); } catch { return null; }
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) return null;
    return realTarget;
  }
  return target;
}
