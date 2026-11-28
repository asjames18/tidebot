// Composer dictation: hold the mic to talk (or tap to start, tap again to stop).
// Prefers the browser's built-in SpeechRecognition (free, no API key); falls back to recording
// with MediaRecorder and transcribing through the server's STT proxy (needs an xAI key).
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  appendTranscriptChunk,
  DictationSessionGate,
  shouldCancelDictationOnKey,
  shouldToggleDictationOnKey,
  speechRecognitionErrorMessage,
} from '../lib/dictationHelpers';
import { voiceApi } from './api';
import { micErrorMessage, openMic } from './audio';

export const SpeechRecognitionCtor = typeof window !== 'undefined'
  ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition)
  : undefined;

export type DictationState = 'idle' | 'recording' | 'transcribing';

const HOLD_MS = 350;
const MAX_MS = 120_000;

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  for (const m of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4']) if (MediaRecorder.isTypeSupported?.(m)) return m;
  return undefined;
}

export function useDictation(onText: (text: string) => void, onError: (msg: string) => void, language?: string) {
  const [state, setState] = useState<DictationState>('idle');
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; chunks: Blob[]; downAt: number; cancelled: boolean; timer: ReturnType<typeof setTimeout>; gen: number } | null>(null);
  const speech = useRef<{ sr: any; downAt: number; cancelled: boolean; text: string; timer: ReturnType<typeof setTimeout>; gen: number } | null>(null);
  const gateRef = useRef(new DictationSessionGate());
  const mountedRef = useRef(true);
  const toggleMode = useRef(false);
  const cb = useRef({ onText, onError, language });
  cb.current = { onText, onError, language };

  const finish = useCallback((cancel = false) => {
    if (cancel) {
      gateRef.current.cancel();
      toggleMode.current = false;
    }
    const s = speech.current;
    if (s) {
      s.cancelled = cancel;
      clearTimeout(s.timer);
      if (cancel) {
        speech.current = null;
        if (mountedRef.current) setState('idle');
      }
      try { s.sr.stop(); } catch { /* already ended */ }
      return;
    }
    const r = rec.current;
    if (r) {
      r.cancelled = cancel;
      clearTimeout(r.timer);
      if (cancel) {
        rec.current = null;
        if (mountedRef.current) setState('idle');
      }
      if (r.mr.state !== 'inactive') r.mr.stop();
      else r.stream.getTracks().forEach((t) => t.stop());
      return;
    }
    if (cancel && mountedRef.current) {
      setState('idle');
    }
  }, []);

  const beginSpeech = useCallback((gen: number) => {
    const sr = new SpeechRecognitionCtor();
    const s = {
      sr,
      downAt: Date.now(),
      cancelled: false,
      text: '',
      timer: setTimeout(() => finish(), MAX_MS),
      gen,
    };
    speech.current = s;
    sr.lang = cb.current.language && cb.current.language !== 'auto' ? cb.current.language : navigator.language;
    sr.interimResults = false;
    sr.continuous = true;
    sr.onresult = (e: any) => {
      if (speech.current !== s || !gateRef.current.isCurrent(gen)) return;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          s.text = appendTranscriptChunk(s.text, e.results[i][0].transcript);
        }
      }
    };
    sr.onerror = (e: any) => {
      if (speech.current !== s || !gateRef.current.isCurrent(gen) || s.cancelled) return;
      const msg = speechRecognitionErrorMessage(e.error);
      if (!msg) return;
      clearTimeout(s.timer);
      speech.current = null;
      toggleMode.current = false;
      gateRef.current.finish(gen);
      if (mountedRef.current) setState('idle');
      cb.current.onError(msg);
    };
    sr.onend = () => {
      clearTimeout(s.timer);
      if (speech.current !== s) return;
      speech.current = null;
      toggleMode.current = false;
      const wasCurrent = gateRef.current.finish(gen);
      if (mountedRef.current) setState('idle');
      if (!wasCurrent || s.cancelled) return;
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try { navigator.vibrate(10); } catch {}
      }
      const text = s.text.trim();
      if (text && Date.now() - s.downAt >= 250) cb.current.onText(text);
    };
    try {
      if (!gateRef.current.activateRecording(gen)) {
        clearTimeout(s.timer);
        speech.current = null;
        return;
      }
      sr.start();
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) { try { navigator.vibrate(15); } catch {} }
      if (mountedRef.current) setState('recording');
    } catch {
      clearTimeout(s.timer);
      speech.current = null;
      toggleMode.current = false;
      gateRef.current.finish(gen);
      if (mountedRef.current) setState('idle');
      cb.current.onError('Dictation failed to start.');
    }
  }, [finish]);

  const begin = useCallback(async () => {
    const gen = gateRef.current.beginStart();
    if (gen === null) return;
    if (SpeechRecognitionCtor) { beginSpeech(gen); return; }
    if (typeof MediaRecorder === 'undefined') {
      gateRef.current.finish(gen);
      cb.current.onError('Dictation isn’t supported in this browser.');
      return;
    }
    const downAt = Date.now();
    let stream: MediaStream | null = null;
    try {
      stream = await openMic();
      if (!mountedRef.current || !gateRef.current.activateRecording(gen)) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const activeStream = stream;
      const mime = pickMime();
      const mr = new MediaRecorder(activeStream, mime ? { mimeType: mime } : undefined);
      const r = { mr, stream: activeStream, chunks: [] as Blob[], downAt, cancelled: false, timer: setTimeout(() => finish(), MAX_MS), gen };
      rec.current = r;
      mr.ondataavailable = (e) => { if (e.data.size) r.chunks.push(e.data); };
      mr.onstop = async () => {
        clearTimeout(r.timer);
        activeStream.getTracks().forEach((t) => t.stop());
        if (rec.current === r) rec.current = null;
        toggleMode.current = false;
        if (!mountedRef.current || r.cancelled || !gateRef.current.isCurrent(gen)) {
          gateRef.current.finish(gen);
          if (mountedRef.current && gateRef.current.currentPhase === 'idle') setState('idle');
          return;
        }
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try { navigator.vibrate(10); } catch {}
        }
        if (!r.chunks.length || Date.now() - r.downAt < 250) {
          gateRef.current.finish(gen);
          setState('idle');
          return;
        }
        if (!gateRef.current.beginTranscribing(gen)) return;
        setState('transcribing');
        try {
          const text = await voiceApi.transcribe(new Blob(r.chunks, { type: mr.mimeType || mime || 'audio/webm' }), cb.current.language);
          if (mountedRef.current && gateRef.current.isCurrent(gen) && text) cb.current.onText(text);
        } catch (e) {
          if (mountedRef.current && gateRef.current.isCurrent(gen)) {
            cb.current.onError((e as Error).message || 'Transcription failed');
          }
        } finally {
          if (gateRef.current.finish(gen) && mountedRef.current) {
            setState('idle');
          }
        }
      };
      mr.start(250);
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try { navigator.vibrate(15); } catch {}
      }
      if (mountedRef.current) setState('recording');
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      toggleMode.current = false;
      if (gateRef.current.finish(gen) && mountedRef.current) {
        cb.current.onError(micErrorMessage(e));
        setState('idle');
      }
    }
  }, [beginSpeech, finish]);

  // Pointer handlers: press-and-hold records until release; a quick tap toggles recording on, tap again stops.
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || !e.isPrimary) return;
    e.preventDefault();
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if ((rec.current || speech.current) && toggleMode.current) { finish(); return; }
    void begin();
  }, [begin, finish]);

  const onPointerUp = useCallback(() => {
    const downAt = rec.current?.downAt ?? speech.current?.downAt;
    if (downAt === undefined) {
      // Still waiting on the permission prompt: treat as a tap.
      if (gateRef.current.currentPhase === 'starting') toggleMode.current = true;
      return;
    }
    if (toggleMode.current) return;
    if (Date.now() - downAt < HOLD_MS) toggleMode.current = true; // tap: keep recording
    else finish();
  }, [finish]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!shouldToggleDictationOnKey(e)) return;
    e.preventDefault();
    if (rec.current || speech.current) finish();
    else if (gateRef.current.currentPhase === 'idle') { toggleMode.current = true; void begin(); }
  }, [begin, finish]);

  // Esc cancels; backgrounding on mobile stops and releases the mic; unmount cancels.
  useEffect(() => {
    if (state === 'idle') return;
    const k = (e: KeyboardEvent) => {
      if (shouldCancelDictationOnKey(e)) {
        e.preventDefault();
        finish(true);
      }
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && (rec.current || speech.current)) finish();
    };
    window.addEventListener('keydown', k);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('keydown', k);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [state, finish]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      finish(true);
    };
  }, [finish]);

  const cancel = useCallback(() => finish(true), [finish]);
  return { state, onPointerDown, onPointerUp, onKeyDown, cancel };
}
