import type { VoiceOption } from '@shared/types';

export interface VoiceSession {
  callId: string;
  clientSecret: string;
  expiresAt: number;
  model: string;
  websocketUrl: string;
  sampleRate: number;
  instructions: string;
  voice: string;
  speed: number;
  language: string;
  tools: unknown[];
  session: Record<string, unknown>;
}

export interface VoiceOptions { voices: VoiceOption[]; languages: { code: string; name: string }[]; speeds: number[] }

export function audioExtensionForMime(mime: string | undefined): string {
  const lower = (mime ?? '').toLowerCase();
  if (lower.includes('ogg')) return 'ogg';
  if (lower.includes('mp4') || lower.includes('m4a')) return 'm4a';
  if (lower.includes('wav')) return 'wav';
  if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3';
  return 'webm';
}

function isValidVoiceOptions(value: unknown): value is VoiceOptions {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.voices) && Array.isArray(v.languages) && Array.isArray(v.speeds);
}

async function readVoiceError(res: Response, fallback: string, includeStatusText = false): Promise<string> {
  let msg = '';
  try {
    const body = (await res.json()) as { error?: unknown } | null;
    if (typeof body?.error === 'string' && body.error.trim()) msg = body.error.trim();
  } catch { /* not json */ }
  return msg || (includeStatusText ? res.statusText?.trim() : '') || fallback;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/voice${path}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    throw new Error(await readVoiceError(res, `HTTP ${res.status}`, true));
  }
  return res.json() as Promise<T>;
}

let optionsPromise: Promise<VoiceOptions> | null = null;

export function resetVoiceOptionsCache(): void {
  optionsPromise = null;
}

export const voiceApi = {
  options: () => (optionsPromise ??= fetch('/api/voice/options', { credentials: 'include' }).then(async (r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data: unknown = await r.json();
    if (!isValidVoiceOptions(data)) throw new Error('Invalid voice options response');
    return data;
  }).catch((e) => { optionsPromise = null; throw e; })),
  session: (botId: string) => post<VoiceSession>('/session', { botId }),
  tool: (botId: string, callId: string, name: string, args: unknown) => post<{ output: string; taskSeq?: number }>('/tool', { botId, callId, name, args }),
  end: (botId: string, callId: string, transcript: { role: 'user' | 'assistant'; text: string }[], error?: string) => post<{ ok: true }>('/end', { botId, callId, transcript, error }),
  /** Best-effort end on tab close. */
  endBeacon: (botId: string, callId: string, transcript: { role: 'user' | 'assistant'; text: string }[]) => {
    try { navigator.sendBeacon('/api/voice/end', new Blob([JSON.stringify({ botId, callId, transcript })], { type: 'application/json' })); } catch { /* ignore */ }
  },
  async preview(p: { botId: string; voice?: string; speed?: number; language?: string; text?: string }): Promise<Int16Array> {
    const res = await fetch('/api/voice/preview', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...p, codec: 'pcm' }) });
    if (!res.ok) {
      throw new Error(await readVoiceError(res, 'Preview unavailable'));
    }
    const contentType = (res.headers.get('content-type') ?? '').trim().toLowerCase();
    if (contentType.startsWith('text/') || contentType.startsWith('application/json')) {
      throw new Error('Preview unavailable');
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 2) {
      throw new Error('Preview unavailable');
    }
    return new Int16Array(buf, 0, buf.byteLength >> 1);
  },
  async transcribe(blob: Blob, language?: string): Promise<string> {
    const fd = new FormData();
    const lang = language?.trim();
    if (lang && lang.toLowerCase() !== 'auto') fd.append('language', lang);
    const ext = audioExtensionForMime(blob.type);
    fd.append('file', blob, `dictation.${ext}`);
    const res = await fetch('/api/voice/stt', { method: 'POST', credentials: 'include', body: fd });
    if (!res.ok) {
      throw new Error(await readVoiceError(res, 'Transcription failed'));
    }
    const data = (await res.json()) as { text?: unknown } | null;
    return typeof data?.text === 'string' ? data.text : '';
  },
};
