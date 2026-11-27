import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * Update one KEY=value entry in a dotenv file atomically.
 *
 * The rewrite goes to a unique temp file in the same directory (mode 0600),
 * is flushed with fsync, and is then renamed over the target. A crash or
 * disk-full error therefore leaves the previous file intact instead of
 * truncating it. Any error propagates so callers (and the HTTP routes that
 * wrap them) can report the failure instead of pretending the key saved.
 */
export function updateEnvFile(envFilePath: string, key: string, value: string): void {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) throw new Error(`Invalid env key: ${key}`);
  if (/[\r\n\0]/.test(value)) throw new Error('Env values must not contain newlines');

  const raw = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
  const lines = raw ? raw.split(/\r?\n/) : [];
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (idx >= 0) lines[idx] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);

  const tmp = `${envFilePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, lines.join('\n'), 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, envFilePath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    throw e;
  }
  try { fs.chmodSync(envFilePath, 0o600); } catch { /* best effort */ }
}
