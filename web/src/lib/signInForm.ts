export type SignInMode = 'signin' | 'invite' | 'local';

export const MIN_NEW_PASSWORD_LEN = 12;
export const MAX_NEW_PASSWORD_LEN = 256;
export const MAX_SIGNIN_PASSWORD_LEN = 1024;

export interface SignInDraft {
  mode: SignInMode;
  email: string;
  invite: string;
  name: string;
  password: string;
}

export type SignInValidation =
  | { ok: true; email: string; invite: string; name?: string; password: string }
  | { ok: false; error: string };

export interface SignInKeyLike {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
}

export function initialSignInError(search: string): string | null {
  return new URLSearchParams(search).get('login') === 'failed'
    ? 'Sign-in didn’t finish. Try again.'
    : null;
}

/** Matches server-side `emailAddress` validation in `server/src/routes.ts`. */
export function isValidSignInEmail(input: string): boolean {
  const value = input.trim();
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validateSignInDraft(draft: SignInDraft): SignInValidation {
  const invite = draft.invite.trim();
  const email = draft.email.trim();
  if (draft.mode === 'invite') {
    if (!invite) return { ok: false, error: 'Enter your invite code' };
  } else if (!isValidSignInEmail(email)) {
    return { ok: false, error: 'Enter a valid email address' };
  }

  if (!draft.password) {
    return { ok: false, error: 'Enter your password' };
  }
  if (draft.mode !== 'signin') {
    if (draft.password.length < MIN_NEW_PASSWORD_LEN || draft.password.length > MAX_NEW_PASSWORD_LEN) {
      return { ok: false, error: `Use a password of ${MIN_NEW_PASSWORD_LEN} to ${MAX_NEW_PASSWORD_LEN} characters.` };
    }
  } else if (draft.password.length > MAX_SIGNIN_PASSWORD_LEN) {
    return { ok: false, error: 'Password is too long.' };
  }

  return {
    ok: true,
    email,
    invite,
    name: draft.name.trim() || undefined,
    password: draft.password,
  };
}

export function shouldAdvanceSignInFocus(e: SignInKeyLike, hasPassword: boolean): boolean {
  if (e.key !== 'Enter' || hasPassword) return false;
  if (e.isComposing || e.keyCode === 229) return false;
  return true;
}
