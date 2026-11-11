import { useState } from 'react';
import type { ShaderStyle } from '@shared/types';
import { BotAvatar } from '../avatar/BotAvatar';
import { api } from '../lib/api';
import { useStore } from '../store';
import { ShaderCanvas } from './ShaderCanvas';
import { TrafficLights } from './Sidebar';

const SHADER_PRESETS: { id: ShaderStyle; label: string }[] = [
  { id: 'aurora', label: 'Aurora Flow' },
  { id: 'plasma', label: 'Plasma Tide' },
  { id: 'obsidian', label: 'Obsidian Mesh' },
  { id: 'vortex', label: 'Singularity' },
  { id: 'grid', label: '3D Horizon' },
];

export function SignIn() {
  const devLogin = useStore((s) => s.devLogin);
  const checkAuth = useStore((s) => s.checkAuth);
  const [email, setEmail] = useState('operator@tidebot.local');
  const [name, setName] = useState('Operator');
  const [shader, setShader] = useState<ShaderStyle>('aurora');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    new URLSearchParams(location.search).get('login') === 'failed' ? 'Sign-in didn’t finish. Try again.' : null,
  );

  const dev = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) {
      setError('Enter an email address');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.devLogin(email.trim(), name.trim() || undefined);
      await checkAuth();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <ShaderCanvas style={shader} className="signin__shader" opacity={0.92} />
      <div className="signin__chrome">
        <TrafficLights />
        <div className="signin__shader-bar" role="group" aria-label="Shader style">
          <span className="signin__shader-label">GLSL SHADER</span>
          {SHADER_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`signin__shader-pill${shader === p.id ? ' is-active' : ''}`}
              onClick={() => setShader(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="signin__card">
        <div className="signin__badge-row">
          <span className="tideos-pill tideos-pill--glow">TIDEBOT v2.4 · BYOM EDITION</span>
          <span className="tideos-pill">OPENROUTER READY</span>
        </div>
        <div className="signin__hero">
          <BotAvatar shape="hex" color="cyan" size={76} ring />
        </div>
        <h1 className="signin__title">TideBot</h1>
        <p className="signin__sub">
          Autonomous AI operators with dedicated Linux workspaces, persistent memory, and Bring-Your-Own-Model via OpenRouter.
        </p>
        <a className="btn btn--primary signin__google" href="/api/auth/google/start">
          <GoogleG /> Continue with Google
        </a>
        {devLogin && (
          <form className="signin__dev" onSubmit={dev}>
            <div className="signin__divider"><span>Local Studio Access</span></div>
            <input
              className="text-input"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email"
            />
            <input
              className="text-input"
              placeholder="Name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Name"
            />
            <button type="submit" className="btn btn--cta" disabled={busy}>
              {busy ? 'Initializing Studio…' : 'Launch TideBot Studio →'}
            </button>
          </form>
        )}
        {error && <div className="card__error signin__error">{error}</div>}
        <div className="signin__foot-grid">
          <span>OPENROUTER · 250+ MODELS</span>
          <span>•</span>
          <span>COMPUTER USE SANDBOX</span>
          <span>•</span>
          <span>MULTI-AGENT ROOMS</span>
        </div>
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
