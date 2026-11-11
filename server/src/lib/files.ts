import fs from 'node:fs';
import path from 'node:path';

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
