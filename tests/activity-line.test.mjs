import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveActivityLineState,
  formatShortModelName,
  resolveActivityTiming,
} from '../web/src/lib/activityLine.ts';

test('formatShortModelName trims overrides, falls back to default, and strips trailing slashes', () => {
  assert.equal(formatShortModelName('anthropic/claude-3.7-sonnet', 'openai/gpt-4o'), 'claude-3.7-sonnet');
  assert.equal(formatShortModelName('   ', 'openrouter/openai/gpt-4o'), 'gpt-4o');
  assert.equal(formatShortModelName('openai/gpt-4o/', null), 'gpt-4o');
  assert.equal(formatShortModelName('   ', '   '), '');
  assert.equal(formatShortModelName('llama3.2', undefined), 'llama3.2');
});

test('resolveActivityTiming guards non-finite timestamps and clamps negative clock skew', () => {
  const now = 1_700_000_020_000;
  // Invalid startedAt falls back to activity.since.
  const fallback = resolveActivityTiming(
    { startedAt: Number.NaN, activity: { kind: 'thinking', since: now - 13_000 }, awaiting: null },
    now,
  );
  assert.equal(fallback.elapsedMs, 13_000);
  assert.equal(fallback.tick, 2);

  // Server timestamp ahead of client clock clamps elapsedMs and tick to 0.
  const futureSkew = resolveActivityTiming(
    { startedAt: now + 5_000, activity: { kind: 'thinking', since: now + 5_000 }, awaiting: null },
    now,
  );
  assert.equal(futureSkew.elapsedMs, 0);
  assert.equal(futureSkew.tick, 0);
});

test('deriveActivityLineState computes waiting state and trims blank awaiting reasons', () => {
  const now = 1_700_000_000_000;
  const waitingBlank = deriveActivityLineState(
    { model: '  ' },
    {
      isRunning: false,
      startedAt: now - 4_000,
      activity: { kind: 'waiting_for_you', since: now - 4_000 },
      awaiting: { kind: 'approval', reason: '   ', since: now - 4_000 },
    },
    'anthropic/claude-sonnet',
    now,
  );
  assert.equal(waitingBlank.waiting, true);
  assert.equal(waitingBlank.awaitingReason, '');
  assert.equal(waitingBlank.shortModel, 'claude-sonnet');

  const waitingWithReason = deriveActivityLineState(
    { model: 'openai/gpt-4.1' },
    {
      isRunning: false,
      startedAt: null,
      activity: null,
      awaiting: { kind: 'approval', reason: '  Approve shell command  ', since: now - 2_000 },
    },
    'fallback/model',
    now,
  );
  assert.equal(waitingWithReason.waiting, true);
  assert.equal(waitingWithReason.awaitingReason, 'Approve shell command');
  assert.equal(waitingWithReason.elapsedMs, 2_000);
});
