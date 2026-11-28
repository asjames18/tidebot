import type { CallStatus, Caption } from '../voice/call';

export interface VoiceBarStateLike {
  status: CallStatus;
  muted: boolean;
  speaking: boolean;
  listening: boolean;
  thinking: boolean;
  working: readonly { seq: number; request: string }[];
  captions: readonly Caption[];
  error: string | null;
}

export interface VoiceCallSummary {
  active: boolean;
  working: boolean;
  statusText: string;
  taskText: string;
  shimmer: boolean;
  visibleCaptions: Caption[];
  recentCaptions: Caption[];
}

export function formatCallDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function latestWorkingTask(working: readonly { request: string }[]): string {
  for (let i = working.length - 1; i >= 0; i -= 1) {
    const trimmed = working[i]?.request?.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

export function deriveVoiceCallSummary(v: VoiceBarStateLike): VoiceCallSummary {
  const active = v.status === 'connecting' || v.status === 'live';
  const working = v.status === 'live' && v.working.length > 0;
  const taskText = working ? latestWorkingTask(v.working) : '';
  const statusText =
    v.status === 'connecting' ? 'Connecting…'
    : v.status === 'error' ? (v.error?.trim() || 'Call ended')
    : v.speaking ? 'Speaking'
    : v.muted ? 'Muted'
    : v.listening ? 'Listening'
    : working ? 'Working on it…'
    : v.thinking ? 'Thinking…'
    : 'Listening';
  const shimmer = working && !v.speaking && !v.listening;
  const visibleCaptions = v.captions.filter((c) => c.text.trim().length > 0);
  const recentCaptions = visibleCaptions.slice(-2);
  return { active, working, statusText, taskText, shimmer, visibleCaptions, recentCaptions };
}
