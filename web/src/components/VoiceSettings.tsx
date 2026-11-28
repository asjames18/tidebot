import { useEffect, useRef, useState } from 'react';
import type { Bot } from '@shared/types';
import { resolveVoiceSelectOptions, VoicePatchTracker } from '../lib/voiceSettingsState';
import { useStore } from '../store';
import { voiceApi, type VoiceOptions } from '../voice/api';
import { endCall, isCallActive, previewVoice, startCall, useVoice } from '../voice/call';
import { Icon } from './Icon';

const FALLBACK: VoiceOptions = {
  voices: ['ara', 'eve', 'leo', 'luna', 'rex', 'sal'].map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1) })),
  languages: [{ code: 'auto', name: 'Auto-detect' }, { code: 'en', name: 'English' }],
  speeds: [0.7, 0.85, 1, 1.15, 1.3, 1.5],
};

const speedLabel = (s: number) => `${Number(s.toFixed(2))}x`;

function NativeSelect<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const current = options.find((o) => o.value === value)?.label ?? String(value);
  return (
    <span className="mini-select mini-select--native">
      <span>{current}</span>
      <Icon name="chev_down" size={10} opacity={0.66} />
      <select
        aria-label={label}
        value={String(value)}
        onChange={(e) => {
          const o = options.find((x) => String(x.value) === e.target.value);
          if (o) {
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(6); } catch {} }
            onChange(o.value);
          }
        }}
      >
        {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
      </select>
    </span>
  );
}

/** "Voice chat" section of the details panel: voice, speed, language (saved per bot), preview, start a call. */
export function VoiceSettings({ bot }: { bot: Bot }) {
  const [opts, setOpts] = useState<VoiceOptions>(FALLBACK);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inCall = useVoice((s) => isCallActive(s) && s.botId === bot.id);
  const mountedRef = useRef(true);
  const activeBotIdRef = useRef(bot.id);
  const previewGenRef = useRef(0);
  const trackerRef = useRef(new VoicePatchTracker());
  activeBotIdRef.current = bot.id;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    voiceApi.options().then((o) => { if (alive) setOpts(o); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    previewGenRef.current += 1;
    setError(null);
    setPreviewing(false);
  }, [bot.id]);

  const save = async (patch: Partial<Pick<Bot, 'voice' | 'voiceSpeed' | 'voiceLanguage'>>) => {
    const botId = bot.id;
    const prev = useStore.getState().bots.find((b) => b.id === botId);
    const handle = trackerRef.current.begin(botId, patch, prev);
    // Optimistic; the server's `bot` event confirms.
    useStore.setState((s) => ({ bots: s.bots.map((b) => (b.id === botId ? { ...b, ...patch } : b)) }));
    setError(null);
    try {
      const res = await fetch(`/api/bots/${encodeURIComponent(botId)}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      trackerRef.current.succeed(handle);
    } catch {
      const rollback = trackerRef.current.fail(handle);
      if (Object.keys(rollback).length > 0) {
        useStore.setState((s) => ({ bots: s.bots.map((b) => (b.id === botId ? { ...b, ...rollback } : b)) }));
        if (mountedRef.current && activeBotIdRef.current === botId) {
          setError('Couldn’t save that setting.');
        }
      }
    }
  };

  const preview = async () => {
    if (previewing) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(10); } catch {} }
    const gen = ++previewGenRef.current;
    const botId = bot.id;
    setPreviewing(true); setError(null);
    try { await previewVoice({ botId, voice: bot.voice, speed: bot.voiceSpeed, language: bot.voiceLanguage }); }
    catch (e) {
      if (mountedRef.current && previewGenRef.current === gen && activeBotIdRef.current === botId) {
        setError((e as Error).message || 'Preview unavailable');
      }
    } finally {
      if (mountedRef.current && previewGenRef.current === gen) {
        setPreviewing(false);
      }
    }
  };

  const { voices, speeds, languages } = resolveVoiceSelectOptions(opts, bot);

  return (
    <div className="panel-card">
      <div className="panel-row panel-row--setting">
        <span>Voice</span>
        <span className="voice-setting__right">
          <button type="button" className="voice-preview" onClick={preview} disabled={previewing} title={`Hear ${bot.name}'s voice`}>{previewing ? 'Playing…' : 'Preview'}</button>
          <NativeSelect label="Voice" value={bot.voice} options={voices.map((v) => ({ value: v.id, label: v.name }))} onChange={(voice) => save({ voice })} />
        </span>
      </div>
      <div className="panel-row panel-row--setting">
        <span>Speed</span>
        <NativeSelect label="Speed" value={bot.voiceSpeed} options={speeds.map((s) => ({ value: s, label: speedLabel(s) }))} onChange={(voiceSpeed) => save({ voiceSpeed })} />
      </div>
      <div className="panel-row panel-row--setting">
        <span>Language</span>
        <NativeSelect label="Language" value={bot.voiceLanguage} options={languages.map((l) => ({ value: l.code, label: l.name }))} onChange={(voiceLanguage) => save({ voiceLanguage })} />
      </div>
      <button
        type="button"
        className={`panel-row panel-row--action panel-row--call${inCall ? ' is-active' : ''}`}
        onClick={() => {
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(12); } catch {} }
          if (!inCall && typeof window !== 'undefined' && window.innerWidth <= 900) {
            const ae = document.activeElement;
            if (ae instanceof HTMLElement && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) ae.blur();
            useStore.getState().set({ detailsOpen: false });
          }
          inCall ? endCall() : startCall(bot.id);
        }}
      >
        <Icon name="voice_a" size={14} opacity={inCall ? 1 : 0.56} /> {inCall ? 'End voice chat' : 'Start voice chat'}
      </button>
      {error && <div className="voice-error" role="alert">{error}</div>}
    </div>
  );
}
