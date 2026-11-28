/**
 * Sanitize a single workspace Library filename entered by the user.
 * Returns null for empty names, `.`, `..`, or dot-prefixed hidden filenames.
 */
export function sanitizeLibraryFilename(raw: string): string | null {
  const clean = raw.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!clean || clean === '.' || clean === '..' || clean.startsWith('.')) return null;
  return clean;
}

/** Join a relative Library folder path and child name. */
export function joinLibraryPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/** Return true for Markdown filenames regardless of extension casing. */
export function isMarkdownFilename(name: string): boolean {
  return /\.(?:md|markdown)$/i.test(name.trim());
}

/** Monotonic request gate to discard stale async completions after navigation or bot switches. */
export class RequestGate {
  private seq = 0;

  next(): number {
    this.seq += 1;
    return this.seq;
  }

  isCurrent(id: number): boolean {
    return id === this.seq;
  }

  invalidate(): void {
    this.seq += 1;
  }
}
