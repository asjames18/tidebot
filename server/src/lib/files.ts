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

function isWithinRoot(realRoot: string, candidate: string): boolean {
  return candidate === realRoot || candidate.startsWith(realRoot + path.sep);
}

/**
 * Resolve `rel` inside `root`, rejecting absolute paths, traversal, and
 * symlink escapes (including dangling symlinks and intermediate symlink
 * directories). Returns the resolved absolute path inside `root`, or null.
 */
export function resolveWithinWorkspace(root: string, rel: string): string | null {
  if (rel.includes('\0') || path.isAbsolute(rel)) return null;
  let realRoot: string;
  try { realRoot = fs.realpathSync(root); } catch { return null; }
  const target = path.resolve(realRoot, rel);
  if (!isWithinRoot(realRoot, target)) return null;
  const relative = path.relative(realRoot, target);
  if (!relative) return realRoot;
  const parts = relative.split(path.sep);
  let cur = realRoot;
  for (let i = 0; i < parts.length; i++) {
    cur = path.join(cur, parts[i]);
    let st: fs.Stats | undefined;
    try { st = lstatIfPresent(cur); } catch { return null; }
    if (!st) {
      return path.join(cur, ...parts.slice(i + 1));
    }
    if (st.isSymbolicLink()) {
      let resolved: string;
      try { resolved = fs.realpathSync(cur); } catch { return null; }
      if (!isWithinRoot(realRoot, resolved)) return null;
      cur = resolved;
      if (i < parts.length - 1) {
        try { if (!fs.statSync(cur).isDirectory()) return null; } catch { return null; }
      }
    } else if (i < parts.length - 1 && !st.isDirectory()) {
      return null;
    }
  }
  return cur;
}

/**
 * Resolve an existing workspace entry for deletion without following a final
 * symlink (so dangling or escaping symlinks sitting inside the workspace can
 * still be unlinked), while rejecting any parent directory that escapes `root`
 * and refusing to target `root` itself.
 */
export function resolveWorkspaceEntryForDelete(root: string, rel: string): string | null {
  if (!rel || rel.includes('\0') || path.isAbsolute(rel)) return null;
  let realRoot: string;
  try { realRoot = fs.realpathSync(root); } catch { return null; }
  const target = path.resolve(realRoot, rel);
  if (target === realRoot || !isWithinRoot(realRoot, target)) return null;
  const relative = path.relative(realRoot, target);
  const parts = relative.split(path.sep);
  const leaf = parts.pop()!;
  let parent = realRoot;
  for (const part of parts) {
    parent = path.join(parent, part);
    let st: fs.Stats | undefined;
    try { st = lstatIfPresent(parent); } catch { return null; }
    if (!st) return null;
    if (st.isSymbolicLink()) {
      let resolved: string;
      try { resolved = fs.realpathSync(parent); } catch { return null; }
      if (!isWithinRoot(realRoot, resolved)) return null;
      parent = resolved;
      try { if (!fs.statSync(parent).isDirectory()) return null; } catch { return null; }
    } else if (!st.isDirectory()) {
      return null;
    }
  }
  const entry = path.join(parent, leaf);
  let entryStat: fs.Stats | undefined;
  try { entryStat = lstatIfPresent(entry); } catch { return null; }
  if (!entryStat) return null;
  return entry;
}

export interface WorkspaceEntry {
  name: string;
  size: number;
  modifiedAt: number;
  isDir: boolean;
}

/**
 * List visible entries in a workspace directory, skipping dotfiles, escaping
 * symlinks, and broken/dangling symlinks so one bad link never truncates the
 * listing. Returns null if `rel` escapes the workspace.
 */
export function listWorkspaceDirectory(root: string, rel = '.'): WorkspaceEntry[] | null {
  const targetDir = resolveWithinWorkspace(root, rel || '.');
  if (!targetDir) return null;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(targetDir, { withFileTypes: true }); }
  catch { return []; }
  const out: WorkspaceEntry[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    let entryPath = path.join(targetDir, e.name);
    if (e.isSymbolicLink()) {
      const resolved = resolveWithinWorkspace(root, rel && rel !== '.' ? path.join(rel, e.name) : e.name);
      if (!resolved) continue;
      entryPath = resolved;
    }
    let st: fs.Stats;
    try { st = fs.statSync(entryPath); } catch { continue; }
    out.push({ name: e.name, size: st.size, modifiedAt: st.mtimeMs, isDir: st.isDirectory() });
  }
  return out;
}
