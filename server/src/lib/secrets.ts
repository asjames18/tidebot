import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PREFIX = 'enc:v1:';
let cachedKey: { dir: string; key: Buffer } | null = null;
/** Dirs already warned about a corrupt/unreadable key file, so the log is not spammed. */
const warnedCorrupt = new Set<string>();

/**
 * Loud, once-per-process warning for a corrupt/unreadable key file. The file is
 * left untouched so the operator can inspect it — a fresh key is never silently
 * substituted, because keys encrypted under a substitute key are unrecoverable
 * after the next restart (the substitute is never written to disk).
 */
function warnCorrupt(dir: string, file: string, detail: string): void {
  if (warnedCorrupt.has(dir)) return;
  warnedCorrupt.add(dir);
  console.error(
    `[tidebot] SECURITY: encryption key file ${file} is ${detail}. ` +
      'Previously encrypted keys cannot be decrypted until this is fixed, and no new keys will be encrypted. ' +
      'Stop the server, then delete or repair the file (deleting generates a fresh key — previously stored encrypted keys will then be unrecoverable) and restart.',
  );
}

/** Encryption key stored beside the DB (0600). Protects against DB-only exfiltration. */
function getKey(dir: string): Buffer {
  if (cachedKey?.dir === dir) return cachedKey.key;
  const file = path.join(dir, '.secret-key');
  let raw: string | null = null;
  try {
    raw = fs.readFileSync(file, 'utf8').trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      // The file exists but cannot be read: never silently fall back to a
      // throwaway in-memory key — anything encrypted under it would be lost.
      warnCorrupt(dir, file, 'unreadable');
      throw new Error(
        `TideBot encryption key file is unreadable: ${file}. ` +
          'Previously encrypted keys cannot be decrypted until this is fixed. ' +
          'Stop the server, delete or repair the file, and restart.',
      );
    }
    // ENOENT: no key file yet — create one below.
  }
  if (raw !== null) {
    const key = Buffer.from(raw, 'base64url');
    if (key.length === 32) { cachedKey = { dir, key }; return key; }
    // Invalid content: same rule as unreadable — fail loudly, keep the file.
    warnCorrupt(dir, file, 'not a valid 32-byte base64url key');
    throw new Error(
      `TideBot encryption key file is corrupt: ${file}. ` +
        'Previously encrypted keys cannot be decrypted until this is fixed, and no new keys will be encrypted. ' +
        'Stop the server, delete or repair the file (deleting generates a fresh key — previously stored encrypted keys will then be unrecoverable), and restart.',
    );
  }
  const key = crypto.randomBytes(32);
  try { fs.writeFileSync(file, key.toString('base64url'), { encoding: 'utf8', mode: 0o600, flag: 'wx' }); }
  catch { /* raced or read-only: fall through and re-read */ }
  try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
  cachedKey = { dir, key };
  return key;
}

export function encryptSecret(dir: string, plain: string): string {
  if (!plain || plain.startsWith(PREFIX)) return plain;
  const key = getKey(dir);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${ct.toString('base64url')}`;
}

/**
 * Decrypts enc:v1 values; legacy plaintext is returned as-is so old rows keep working.
 * A corrupt/unreadable key file still returns '' here (existing behavior — callers
 * treat it as "no key configured"); the loud warning is logged by getKey, and
 * encryptSecret throws, so nothing new is ever encrypted under a throwaway key.
 */
export function decryptSecret(dir: string, stored: string): string {
  if (!stored || !stored.startsWith(PREFIX)) return stored;
  try {
    const [ivB, tagB, ctB] = stored.slice(PREFIX.length).split('.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(dir), Buffer.from(ivB, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}
