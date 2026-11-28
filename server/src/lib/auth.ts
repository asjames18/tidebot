import type { Context, MiddlewareHandler } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { db, now } from '../db.js';
import { sha256, token } from './ids.js';
import type { User } from '../types.js';
import { env } from '../env.js';

const COOKIE = 'grokbot_session';
const TTL_MS = 30 * 24 * 3600 * 1000;

export type AuthVars = { Variables: { user: User; verifiedSession: boolean; studioAdmin: boolean } };

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: 'Lax' as const,
    path: '/',
    secure: process.env.NODE_ENV === 'production',
  };
}

/** Extract all candidate session token values from a Cookie header (RFC 6265-safe). */
export function sessionTokensFromCookieHeader(cookieHeader: string | undefined): string[] {
  if (!cookieHeader) return [];
  const tokens: string[] = [];
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${COOKIE}=`)) continue;
    let raw = trimmed.slice(COOKIE.length + 1);
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
      raw = raw.slice(1, -1);
    }
    try {
      const decoded = decodeURIComponent(raw);
      if (decoded) tokens.push(decoded);
    } catch {
      // Ignore malformed percent-encoding.
    }
  }
  return tokens;
}

export function createSession(c: Context, userId: string, verified: boolean) {
  const t = token();
  const ts = now();
  // Rotate any prior session token belonging to this user and prune expired sessions.
  for (const prev of sessionTokensFromCookieHeader(c.req.header('cookie'))) {
    db.prepare('DELETE FROM auth_sessions WHERE token=? AND user_id=?').run(sha256(prev), userId);
  }
  db.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').run(ts);
  if (verified) {
    db.prepare('UPDATE users SET verified_account=1 WHERE id=?').run(userId);
    db.prepare('DELETE FROM auth_sessions WHERE user_id=? AND verified=0').run(userId);
  }
  db.prepare('INSERT INTO auth_sessions(token,user_id,created_at,expires_at,verified) VALUES (?,?,?,?,?)').run(sha256(t), userId, ts, ts + TTL_MS, Number(verified));
  setCookie(c, COOKIE, t, { ...cookieOpts(), maxAge: TTL_MS / 1000 });
}

export function destroySession(c: Context) {
  for (const t of sessionTokensFromCookieHeader(c.req.header('cookie'))) {
    db.prepare('DELETE FROM auth_sessions WHERE token=?').run(sha256(t));
  }
  deleteCookie(c, COOKIE, cookieOpts());
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

function sessionFromCookieHeader(cookieHeader: string | undefined) {
  for (const t of sessionTokensFromCookieHeader(cookieHeader)) {
    const session = sessionFromToken(t);
    if (session) return session;
  }
  return null;
}

export function userFromCookieHeader(cookieHeader: string | undefined): User | null {
  return sessionFromCookieHeader(cookieHeader)?.user ?? null;
}

export const requireUser: MiddlewareHandler<AuthVars> = async (c, next) => {
  const session = sessionFromCookieHeader(c.req.header('cookie'));
  if (!session) return c.json({ error: 'unauthenticated' }, 401);
  c.set('user', session.user);
  c.set('verifiedSession', session.verified);
  c.set('studioAdmin', Boolean(session.verified && !session.desktopOnly && env.studioAdminEmail && session.user.email.toLowerCase() === env.studioAdminEmail));
  await next();
};
