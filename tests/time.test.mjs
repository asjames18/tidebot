import test from 'node:test';
import assert from 'node:assert/strict';
import { clock, dividerLabel, elapsed, relativeShort } from '../web/src/lib/time.ts';

// The day before Monday can be 23 or 25 hours long in New York.
test('Yesterday follows the local calendar across DST changes', () => {
  process.env.TZ = 'America/New_York';
  for (const [message, now] of [
    ['2026-03-08T12:00', '2026-03-09T00:30'],
    ['2026-10-31T12:00', '2026-11-01T23:30'],
  ]) assert.match(dividerLabel(Date.parse(message), Date.parse(now)), /^Yesterday /);
});

test('compact timestamps count calendar days after 24 hours', () => {
  const now = Date.parse('2026-11-25T01:00');
  assert.equal(relativeShort(Date.parse('2026-11-23T23:00'), now), '2d');
  assert.equal(relativeShort(Date.parse('2026-11-24T00:00'), now), 'Yesterday');
  assert.equal(relativeShort(Date.parse('2026-11-24T23:00'), now), '2h');
});

test('time formatters degrade cleanly on NaN, Infinity, and out-of-range Date values', () => {
  const validNow = Date.parse('2026-11-25T12:00Z');
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e20, -1e20]) {
    assert.equal(clock(bad), '');
    assert.equal(dividerLabel(bad, validNow), '');
    assert.equal(dividerLabel(validNow, bad), '');
    assert.equal(relativeShort(bad, validNow), '');
    assert.equal(relativeShort(validNow, bad), '');
  }
  assert.equal(elapsed(Number.NaN), '0s');
  assert.equal(elapsed(Number.POSITIVE_INFINITY), '0s');
  assert.equal(elapsed(-5000), '0s');
  assert.equal(elapsed(3_840_000), '1h 4m');
});
