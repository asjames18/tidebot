import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const fallbackSalt = randomBytes(16);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, 64) as Buffer;
  return `${salt.toString('base64url')}.${hash.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored?: string): Promise<boolean> {
  const parts = typeof stored === 'string' ? stored.split('.') : [];
  const validFormat = parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
  const saltBuf = validFormat ? Buffer.from(parts[0], 'base64url') : fallbackSalt;
  const expected = validFormat ? Buffer.from(parts[1], 'base64url') : Buffer.alloc(64);
  const actual = await derive(password, saltBuf.length > 0 ? saltBuf : fallbackSalt, 64) as Buffer;
  return Boolean(validFormat && saltBuf.length > 0 && expected.length === actual.length && timingSafeEqual(expected, actual));
}
