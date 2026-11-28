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
/**
 * Format an env value so Node's `util.parseEnv` round-trips it verbatim.
 * Plain values remain unquoted; values containing `#`, leading/trailing
 * whitespace, or a leading quote character are wrapped in a literal quote
 * delimiter (`'`, `` ` ``, or `"`) that preserves their contents.
 */
export function formatEnvValue(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error('Env values must not contain newlines');
  if (!value.includes('#') && !/^\s|\s$/.test(value) && !/^['"`]/.test(value)) {
    return value;
  }
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('`')) return `\`${value}\``;
  if (!value.includes('"') && !value.includes('\\n')) return `"${value}"`;
  throw new Error('Env value contains incompatible quote characters for .env format');
}

export function updateEnvFile(envFilePath: string, key: string, value: string): void {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) throw new Error(`Invalid env key: ${key}`);
  const formatted = formatEnvValue(value);

  const raw = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
  const lines = raw ? raw.split(/\r?\n/) : [];
  const keyPattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);

  let replaced = false;
  const nextLines: string[] = [];
  for (const line of lines) {
    if (keyPattern.test(line)) {
      if (!replaced) {
        nextLines.push(`${key}=${formatted}`);
        replaced = true;
      }
      // Drop duplicate definitions so an older later line cannot override the update.
      continue;
    }
    nextLines.push(line);
  }
  if (!replaced) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] === '') {
      nextLines.splice(nextLines.length - 1, 0, `${key}=${formatted}`);
    } else {
      nextLines.push(`${key}=${formatted}`);
    }
  }

  const tmp = `${envFilePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  let closed = false;
  try {
    fs.writeFileSync(fd, nextLines.join('\n'), 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    closed = true;
    fs.renameSync(tmp, envFilePath);
  } catch (e) {
    if (!closed) {
      try { fs.closeSync(fd); } catch { /* best effort */ }
    }
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    throw e;
  }
  try { fs.chmodSync(envFilePath, 0o600); } catch { /* best effort */ }
}
