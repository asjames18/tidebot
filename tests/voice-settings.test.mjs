import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVoiceSelectOptions, VoicePatchTracker } from '../web/src/lib/voiceSettingsState.ts';

const FALLBACK_OPTS = {
  voices: [{ id: 'ara', name: 'Ara' }, { id: 'leo', name: 'Leo' }],
  languages: [{ code: 'auto', name: 'Auto-detect' }, { code: 'en', name: 'English' }],
  speeds: [0.7, 1, 1.5],
};

test('resolveVoiceSelectOptions preserves unknown voice, speed, and language values', () => {
  const resolved = resolveVoiceSelectOptions(FALLBACK_OPTS, {
    voice: 'custom-voice',
    voiceSpeed: 1.25,
    voiceLanguage: 'es',
  });

  assert.equal(resolved.voices[0].id, 'custom-voice');
  assert.deepEqual(resolved.speeds, [0.7, 1, 1.25, 1.5]);
  assert.equal(resolved.languages[0].code, 'es');
  assert.equal(resolved.languages[0].name, 'es');
});

test('resolveVoiceSelectOptions does not inject duplicates or non-finite speeds', () => {
  const resolved = resolveVoiceSelectOptions(FALLBACK_OPTS, {
    voice: 'ara',
    voiceSpeed: Number.NaN,
    voiceLanguage: 'en',
  });

  assert.equal(resolved.voices, FALLBACK_OPTS.voices);
  assert.equal(resolved.speeds, FALLBACK_OPTS.speeds);
  assert.equal(resolved.languages, FALLBACK_OPTS.languages);
});

test('VoicePatchTracker only rolls back the failing field when another field saves concurrently', () => {
  const tracker = new VoicePatchTracker();
  const bot = { voice: 'ara', voiceSpeed: 1, voiceLanguage: 'auto' };

  const hVoice = tracker.begin('bot-1', { voice: 'leo' }, { ...bot });
  bot.voice = 'leo';

  const hSpeed = tracker.begin('bot-1', { voiceSpeed: 1.3 }, { ...bot });
  bot.voiceSpeed = 1.3;

  // Speed save succeeds, then the earlier voice save fails.
  tracker.succeed(hSpeed);
  const rollback = tracker.fail(hVoice);

  assert.deepEqual(rollback, { voice: 'ara' });
});

test('VoicePatchTracker ignores stale failure superseded by a newer edit on the same field', () => {
  const tracker = new VoicePatchTracker();
  const bot = { voice: 'ara', voiceSpeed: 1, voiceLanguage: 'auto' };

  const h1 = tracker.begin('bot-1', { voice: 'leo' }, { ...bot });
  bot.voice = 'leo';

  const h2 = tracker.begin('bot-1', { voice: 'sal' }, { ...bot });
  bot.voice = 'sal';

  tracker.succeed(h2);
  const rollback = tracker.fail(h1);

  assert.deepEqual(rollback, {});
});

test('VoicePatchTracker rolls back consecutive failures to the last server-confirmed baseline', () => {
  const tracker = new VoicePatchTracker();
  const bot = { voice: 'ara', voiceSpeed: 1, voiceLanguage: 'auto' };

  const h1 = tracker.begin('bot-1', { voice: 'leo' }, { ...bot });
  bot.voice = 'leo';

  const h2 = tracker.begin('bot-1', { voice: 'sal' }, { ...bot });
  bot.voice = 'sal';

  // Both fail: h1 is superseded, and h2 must roll back to 'ara' (not optimistic 'leo').
  assert.deepEqual(tracker.fail(h1), {});
  assert.deepEqual(tracker.fail(h2), { voice: 'ara' });
});

test('VoicePatchTracker updates baseline when an earlier save succeeds before a later save fails', () => {
  const tracker = new VoicePatchTracker();
  const bot = { voice: 'ara', voiceSpeed: 1, voiceLanguage: 'auto' };

  const h1 = tracker.begin('bot-1', { voice: 'leo' }, { ...bot });
  bot.voice = 'leo';

  const h2 = tracker.begin('bot-1', { voice: 'sal' }, { ...bot });
  bot.voice = 'sal';

  // h1 succeeds on the server, then h2 fails: rollback should restore 'leo'.
  tracker.succeed(h1);
  assert.deepEqual(tracker.fail(h2), { voice: 'leo' });
});

test('VoicePatchTracker isolates edits across different bots', () => {
  const tracker = new VoicePatchTracker();
  const hA = tracker.begin('bot-a', { voice: 'leo' }, { voice: 'ara', voiceSpeed: 1, voiceLanguage: 'auto' });
  const hB = tracker.begin('bot-b', { voice: 'sal' }, { voice: 'eve', voiceSpeed: 1, voiceLanguage: 'en' });

  tracker.succeed(hB);
  assert.deepEqual(tracker.fail(hA), { voice: 'ara' });
});
