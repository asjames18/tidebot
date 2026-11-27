import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { db, now } from '../db.js';
import { sha256, token } from './ids.js';
import type { User } from '../types.js';
import { env } from '../env.js';

const COOKIE = 'grokbot_session';
const TTL_MS = 30 * 24 * 3600 * 1000;

export type AuthVars = { Variables: { user: User; verifiedSession: boolean; studioAdmin: boolean; canManageStudio: boolean } };

export function createSession(c: Context, userId: string, verified: boolean) {
  const t = token();
  if (verified) {
    db.prepare('UPDATE users SET verified_account=1 WHERE id=?').run(userId);
    db.prepare('DELETE FROM auth_sessions WHERE user_id=? AND verified=0').run(userId);
  }
  db.prepare('INSERT INTO auth_sessions(token,user_id,created_at,expires_at,verified) VALUES (?,?,?,?,?)').run(sha256(t), userId, now(), now() + TTL_MS, Number(verified));
  setCookie(c, COOKIE, t, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: TTL_MS / 1000, secure: process.env.NODE_ENV === 'production' });
}

export function destroySession(c: Context) {
  const t = getCookie(c, COOKIE);
  if (t) db.prepare('DELETE FROM auth_sessions WHERE token=?').run(sha256(t));
  deleteCookie(c, COOKIE, { path: '/' });
}

function sessionFromToken(t: string | undefined): { user: User; verified: boolean; desktopOnly: boolean; desktopOwner: boolean } | null {
  if (!t) return null;
  const r = db
    .prepare(`SELECT u.*, s.verified, p.desktop_only, o.user_id IS NOT NULL AS desktop_owner
      FROM auth_sessions s JOIN users u ON u.id=s.user_id
      LEFT JOIN local_passwords p ON p.user_id=u.id LEFT JOIN desktop_owner o ON o.user_id=u.id
      WHERE s.token=? AND s.expires_at>?`)
    .get(sha256(t), now()) as any;
  if (!r || (r.desktop_only === 1 && !env.desktopSignupOrigin)
    || (r.verified !== 1 && (!env.devLogin || r.verified_account === 1))) return null;
  return { user: { id: r.id, email: r.email, name: r.name, avatarUrl: r.avatar_url }, verified: r.verified === 1, desktopOnly: r.desktop_only === 1, desktopOwner: r.desktop_owner === 1 };
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
  const adminEmail = env.studioAdminEmail;
  const studioAdmin = session.verified && !session.desktopOnly && session.user.email.toLowerCase() === adminEmail;
  const localOwner = session.verified && session.desktopOnly && session.desktopOwner && !adminEmail
    && new URL(c.req.url).origin === env.desktopSignupOrigin;
  c.set('studioAdmin', studioAdmin);
  c.set('canManageStudio', studioAdmin || localOwner);
  await next();
};
