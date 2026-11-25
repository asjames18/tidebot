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
  const [salt, hash] = stored?.split('.') ?? [];
  const expected = hash ? Buffer.from(hash, 'base64url') : Buffer.alloc(64);
  const actual = await derive(password, salt ? Buffer.from(salt, 'base64url') : fallbackSalt, 64) as Buffer;
  return Boolean(salt && hash && expected.length === actual.length && timingSafeEqual(expected, actual));
}
