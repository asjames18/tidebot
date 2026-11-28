import type { Bot } from '@shared/types';
import type { VoiceOptions } from '../voice/api';

export type VoiceSettingFields = Pick<Bot, 'voice' | 'voiceSpeed' | 'voiceLanguage'>;
export type VoiceSettingKey = keyof VoiceSettingFields;
export type VoiceSettingPatch = Partial<VoiceSettingFields>;

const VOICE_SETTING_KEYS: readonly VoiceSettingKey[] = ['voice', 'voiceSpeed', 'voiceLanguage'];

interface FieldState<K extends VoiceSettingKey> {
  baseline: VoiceSettingFields[K];
  latestSeq: number;
  confirmedSeq: number;
  pending: number;
}

export interface VoicePatchHandle {
  readonly botId: string;
  readonly patch: VoiceSettingPatch;
  readonly tokens: Partial<Record<VoiceSettingKey, number>>;
}

/**
 * Ensures the bot's current voice, speed, and language are always present in the
 * select option lists (for example before `/api/voice/options` finishes loading or
 * if it fails and falls back to defaults).
 */
export function resolveVoiceSelectOptions(
  opts: VoiceOptions,
  bot: VoiceSettingFields,
): VoiceOptions {
  const voices = !bot.voice || opts.voices.some((v) => v.id === bot.voice)
    ? opts.voices
    : [{ id: bot.voice, name: bot.voice }, ...opts.voices];
  const speeds = !Number.isFinite(bot.voiceSpeed) || opts.speeds.includes(bot.voiceSpeed)
    ? opts.speeds
    : [...opts.speeds, bot.voiceSpeed].sort((a, b) => a - b);
  const languages = !bot.voiceLanguage || opts.languages.some((l) => l.code === bot.voiceLanguage)
    ? opts.languages
    : [{ code: bot.voiceLanguage, name: bot.voiceLanguage }, ...opts.languages];
  return { voices, speeds, languages };
}

/**
 * Tracks in-flight optimistic voice-setting PATCH requests per `(botId, field)` so that:
 * - failing a patch for one field never rolls back another field's concurrent save,
 * - a stale failure never overwrites a newer edit on the same field, and
 * - consecutive failures on the same field roll back to the last server-confirmed baseline
 *   rather than an unconfirmed optimistic value.
 */
export class VoicePatchTracker {
  private seq = 0;
  private fields = new Map<string, FieldState<VoiceSettingKey>>();

  private key(botId: string, field: VoiceSettingKey): string {
    return `${botId}\0${field}`;
  }

  begin(botId: string, patch: VoiceSettingPatch, current?: VoiceSettingFields): VoicePatchHandle {
    const tokens: Partial<Record<VoiceSettingKey, number>> = {};
    for (const field of VOICE_SETTING_KEYS) {
      if (patch[field] === undefined) continue;
      const mapKey = this.key(botId, field);
      const token = ++this.seq;
      tokens[field] = token;
      const existing = this.fields.get(mapKey);
      if (existing) {
        existing.latestSeq = token;
        existing.pending += 1;
      } else if (current) {
        this.fields.set(mapKey, {
          baseline: current[field],
          latestSeq: token,
          confirmedSeq: 0,
          pending: 1,
        });
      }
    }
    return { botId, patch, tokens };
  }

  succeed(handle: VoicePatchHandle): void {
    for (const field of VOICE_SETTING_KEYS) {
      const token = handle.tokens[field];
      if (token === undefined) continue;
      const mapKey = this.key(handle.botId, field);
      const state = this.fields.get(mapKey);
      if (!state) continue;
      const nextVal = handle.patch[field];
      if (nextVal !== undefined && token > state.confirmedSeq) {
        state.confirmedSeq = token;
        state.baseline = nextVal;
      }
      state.pending -= 1;
      if (state.pending <= 0) this.fields.delete(mapKey);
    }
  }

  /**
   * Records a failed save and returns the exact subset of fields that should be rolled
   * back (empty object if every field in the failed patch was superseded by a newer edit).
   */
  fail(handle: VoicePatchHandle): VoiceSettingPatch {
    const rollback: VoiceSettingPatch = {};
    for (const field of VOICE_SETTING_KEYS) {
      const token = handle.tokens[field];
      if (token === undefined) continue;
      const mapKey = this.key(handle.botId, field);
      const state = this.fields.get(mapKey);
      if (!state) continue;
      if (state.latestSeq === token) {
        (rollback as Record<VoiceSettingKey, VoiceSettingFields[VoiceSettingKey]>)[field] = state.baseline;
      }
      state.pending -= 1;
      if (state.pending <= 0) this.fields.delete(mapKey);
    }
    return rollback;
  }
}
