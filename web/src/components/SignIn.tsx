import { useRef, useState } from 'react';
import { BotAvatar } from '../avatar/BotAvatar';
import { api } from '../lib/api';
import { useStore } from '../store';
import { ShaderCanvas } from './ShaderCanvas';
import { TrafficLights } from './Sidebar';

export function SignIn() {
  const checkAuth = useStore((s) => s.checkAuth);
  const googleLogin = useStore((s) => s.googleLogin);
  const localSignup = useStore((s) => s.localSignup);
  const [email, setEmail] = useState('');
  const [mode, setMode] = useState<'signin' | 'invite' | 'local'>('signin');
  const inviteMode = mode === 'invite';
  const creating = mode !== 'signin';
  const [invite, setInvite] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(() =>
    new URLSearchParams(location.search).get('login') === 'failed' ? 'Sign-in didn’t finish. Try again.' : null,
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
    if (!inviteMode && !email.includes('@')) {
      setError('Enter an email address');
      return;
    }
    if (!password) {
      setError('Enter your password');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (inviteMode) await api.acceptInvite(invite.trim(), password, name.trim() || undefined);
      else if (mode === 'local') await api.createLocalAccount(email.trim(), password, name.trim() || undefined);
      else await api.passwordLogin(email.trim(), password, name.trim() || undefined);
      if (!await checkAuth()) throw new Error('TideBot could not load your session. Try signing in again.');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  const changeMode = (next: typeof mode) => {
    setMode(next);
    setPassword('');
    setShowPassword(false);
    setError(null);
  };

  return (
    <div className="signin">
      <ShaderCanvas style="aurora" className="signin__shader" opacity={0.92} />
      <div className="signin__chrome">
        <TrafficLights />
      </div>

      <div className="signin__card">
        <div className="signin__hero">
          <BotAvatar shape="hex" color="cyan" size={76} ring />
        </div>
        <h1 className="signin__title">TideBot</h1>
        <p className="signin__sub">
          Run agents with persistent memory using your own local model or a hosted provider such as OpenRouter.
        </p>
        {googleLogin && <a
          className="btn btn--primary signin__google"
          href="/api/auth/google/start"
          onClick={() => {
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
          }}
        >
          <GoogleG /> Continue with Google
        </a>}
        <form className="signin__dev" onSubmit={submit}>
          <div className="signin__divider"><span>{mode === 'local' ? 'Create a local account' : inviteMode ? 'Create your account' : 'Sign in to your studio'}</span></div>
          {inviteMode ? <input className="text-input" aria-label="Invite code" placeholder="Invite code" required
            value={invite} onChange={(e) => setInvite(e.target.value)} autoComplete="off" /> : <input
            className="text-input"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            placeholder="Email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); if (error) setError(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !password) {
                e.preventDefault();
                nameRef.current?.focus();
              }
            }}
            aria-label="Email"
            autoComplete="email"
          />}
          <input
            ref={nameRef}
            className="text-input"
            autoCapitalize="words"
            enterKeyHint="next"
            placeholder="Name (optional, first sign-in)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !password) {
                e.preventDefault();
                passwordRef.current?.focus();
              }
            }}
            aria-label="Name"
            autoComplete="name"
          />
          <div style={{ position: 'relative', width: '100%' }}>
            <input
              ref={passwordRef}
              className="text-input"
              type={showPassword ? 'text' : 'password'}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              placeholder={creating ? 'Choose a password (12 characters or more)' : 'Password'}
              minLength={creating ? 12 : undefined}
              maxLength={creating ? 256 : 1024}
              value={password}
              onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
              aria-label="Password"
              autoComplete={creating ? 'new-password' : 'current-password'}
              style={{ width: '100%', paddingRight: 64 }}
            />
            <button
              type="button"
              onClick={() => {
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(6); } catch {} }
                setShowPassword((v) => !v);
              }}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              style={{
                position: 'absolute',
                right: 4,
                top: '50%',
                transform: 'translateY(-50%)',
                minWidth: 44,
                minHeight: 44,
                padding: '0 10px',
                border: 0,
                borderRadius: 8,
                background: 'transparent',
                color: 'var(--color-text-secondary)',
                fontSize: 12.5,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <button type="submit" className="btn btn--cta" disabled={busy}>
            {busy ? 'Signing in…' : creating ? 'Create account' : 'Launch TideBot Studio →'}
          </button>
          {creating ? <button type="button" className="btn" disabled={busy} onClick={() => changeMode('signin')}>Back to sign in</button> : <>
            {localSignup && <button type="button" className="btn" disabled={busy} onClick={() => changeMode('local')}>Create local account</button>}
            <button type="button" className="btn" disabled={busy} onClick={() => changeMode('invite')}>Use an invite code</button>
          </>}
        </form>
        {error && <div className="card__error signin__error" role="alert">{error}</div>}
      </div>
    </div>
  );
}

function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
