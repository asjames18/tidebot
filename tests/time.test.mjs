import test from 'node:test';
import assert from 'node:assert/strict';
import { dividerLabel, relativeShort } from '../web/src/lib/time.ts';

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
