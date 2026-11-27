import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { db, now } from '../db.js';
import { sha256, token } from './ids.js';
import type { User } from '../types.js';
import { env } from '../env.js';

const COOKIE = 'grokbot_session';
const TTL_MS = 30 * 24 * 3600 * 1000;

export type AuthVars = { Variables: { user: User; verifiedSession: boolean; studioAdmin: boolean } };

export function createSession(c: Context, userId: string, verified: boolean) {
  const t = token();
  if (verified) {
    db.prepare('UPDATE users SET verified_account=1 WHERE id=?').run(userId);
    db.prepare('DELETE FROM auth_sessions WHERE user_id=? AND verified=0').run(userId);
  }
  db.prepare('INSERT INTO auth_sessions(token,user_id,created_at,expires_at,verified) VALUES (?,?,?,?,?)').run(sha256(t), userId, now(), now() + TTL_MS, Number(verified));
  setCookie(c, COOKIE, t, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: TTL_MS / 1000, secure: process.env.NODE_ENV === 'production' });
}

// The Google callback does not check an attempt's age, so keep attempts far longer than any sign-in takes.
const LOGIN_ATTEMPT_TTL_MS = 24 * 3600 * 1000;

/** Delete expired sign-in sessions and abandoned Google sign-in attempts. Nothing else removes them. */
export function purgeExpiredAuth() {
  const t = now();
  const sessions = db.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').run(t).changes;
  const attempts = db.prepare('DELETE FROM login_attempts WHERE created_at<?').run(t - LOGIN_ATTEMPT_TTL_MS).changes;
  return { sessions, attempts };
}

/** Purge now, then again every `intervalMs` (default one hour). The timer does not keep the process alive. */
export function startAuthPurge(intervalMs = 3600 * 1000) {
  purgeExpiredAuth();
  return setInterval(() => {
    try { purgeExpiredAuth(); } catch (e) { console.warn('[auth] purge failed', (e as Error).message); }
  }, intervalMs).unref();
}

export function destroySession(c: Context) {
  const t = getCookie(c, COOKIE);
  if (t) db.prepare('DELETE FROM auth_sessions WHERE token=?').run(sha256(t));
  deleteCookie(c, COOKIE, { path: '/' });
}

function sessionFromToken(t: string | undefined): { user: User; verified: boolean; desktopOnly: boolean } | null {
  if (!t) return null;
  const r = db
    .prepare('SELECT u.*, s.verified, p.desktop_only FROM auth_sessions s JOIN users u ON u.id=s.user_id LEFT JOIN local_passwords p ON p.user_id=u.id WHERE s.token=? AND s.expires_at>?')
    .get(sha256(t), now()) as any;
  if (!r || (r.desktop_only === 1 && !env.desktopSignupOrigin)
    || (r.verified !== 1 && (!env.devLogin || r.verified_account === 1))) return null;
  return { user: { id: r.id, email: r.email, name: r.name, avatarUrl: r.avatar_url }, verified: r.verified === 1, desktopOnly: r.desktop_only === 1 };
}

export function userFromCookieHeader(cookieHeader: string | undefined): User | null {
  const m = cookieHeader?.split(/;\s*/).find((p) => p.startsWith(`${COOKIE}=`));
  if (!m) return null;
  let tokenValue: string;
  try { tokenValue = decodeURIComponent(m.slice(COOKIE.length + 1)); }
  catch { return null; }
  return sessionFromToken(tokenValue)?.user ?? null;
}

export const requireUser: MiddlewareHandler<AuthVars> = async (c, next) => {
  const session = sessionFromToken(getCookie(c, COOKIE));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  c.set('user', session.user);
  c.set('verifiedSession', session.verified);
  c.set('studioAdmin', session.verified && !session.desktopOnly && session.user.email.toLowerCase() === env.studioAdminEmail);
  await next();
};
