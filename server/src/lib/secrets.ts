import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PREFIX = 'enc:v1:';
let cachedKey: { dir: string; key: Buffer } | null = null;

/** Encryption key stored beside the DB (0600). Protects against DB-only exfiltration. */
function getKey(dir: string): Buffer {
  if (cachedKey?.dir === dir) return cachedKey.key;
  const file = path.join(dir, '.secret-key');
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    const key = Buffer.from(raw, 'base64url');
    if (key.length === 32) { cachedKey = { dir, key }; return key; }
  } catch { /* create below */ }
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

/** Decrypts enc:v1 values; legacy plaintext is returned as-is so old rows keep working. */
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
