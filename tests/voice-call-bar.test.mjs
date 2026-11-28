import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveVoiceCallSummary,
  formatCallDuration,
  latestWorkingTask,
} from '../web/src/lib/voiceCallBar.ts';

const BASE = {
  status: 'live',
  muted: false,
  speaking: false,
  listening: false,
  thinking: false,
  working: [],
  captions: [],
  error: null,
};

test('formatCallDuration guards negative and non-finite durations', () => {
  assert.equal(formatCallDuration(Number.NaN), '0:00');
  assert.equal(formatCallDuration(Number.POSITIVE_INFINITY), '0:00');
  assert.equal(formatCallDuration(Number.NEGATIVE_INFINITY), '0:00');
  assert.equal(formatCallDuration(-5000), '0:00');
  assert.equal(formatCallDuration(0), '0:00');
  assert.equal(formatCallDuration(9_500), '0:09');
  assert.equal(formatCallDuration(65_000), '1:05');
  assert.equal(formatCallDuration(3_600_000), '60:00');
});

test('deriveVoiceCallSummary suppresses working/shimmer on error and falls back on blank errors', () => {
  const errWithWorking = deriveVoiceCallSummary({
    ...BASE,
    status: 'error',
    error: '   ',
    working: [{ seq: 1, request: 'Check inbox' }],
  });
  assert.equal(errWithWorking.active, false);
  assert.equal(errWithWorking.working, false);
  assert.equal(errWithWorking.shimmer, false);
  assert.equal(errWithWorking.taskText, '');
  assert.equal(errWithWorking.statusText, 'Call ended');

  const errWithMsg = deriveVoiceCallSummary({
    ...BASE,
    status: 'error',
    error: '  Mic disconnected  ',
  });
  assert.equal(errWithMsg.statusText, 'Mic disconnected');
});

test('deriveVoiceCallSummary prioritizes Speaking then Muted over stale listening and scans non-empty tasks', () => {
  const mutedWhileListening = deriveVoiceCallSummary({
    ...BASE,
    muted: true,
    listening: true,
  });
  assert.equal(mutedWhileListening.statusText, 'Muted');

  const speakingWhileMuted = deriveVoiceCallSummary({
    ...BASE,
    muted: true,
    speaking: true,
  });
  assert.equal(speakingWhileMuted.statusText, 'Speaking');

  const workingWithTrailingBlank = deriveVoiceCallSummary({
    ...BASE,
    working: [
      { seq: 1, request: '  Draft reply  ' },
      { seq: 2, request: '   ' },
    ],
  });
  assert.equal(workingWithTrailingBlank.working, true);
  assert.equal(workingWithTrailingBlank.shimmer, true);
  assert.equal(workingWithTrailingBlank.statusText, 'Working on it…');
  assert.equal(workingWithTrailingBlank.taskText, 'Draft reply');
  assert.equal(latestWorkingTask([{ request: '   ' }]), '');
});

test('deriveVoiceCallSummary filters blank captions and takes the last two for preview', () => {
  const summary = deriveVoiceCallSummary({
    ...BASE,
    captions: [
      { id: '1', role: 'user', text: '   ', final: true },
      { id: '2', role: 'user', text: 'First', final: true },
      { id: '3', role: 'assistant', text: 'Second', final: true },
      { id: '4', role: 'user', text: 'Third', final: false },
    ],
  });
  assert.deepEqual(summary.visibleCaptions.map((c) => c.id), ['2', '3', '4']);
  assert.deepEqual(summary.recentCaptions.map((c) => c.id), ['3', '4']);
});
