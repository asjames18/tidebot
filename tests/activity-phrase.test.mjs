import test from 'node:test';
import assert from 'node:assert/strict';
import { activityPhrase } from '../web/src/lib/phrases.ts';

test('an activity newer than the last UI clock tick starts at its first phrase', () => {
  const phrase = tick => activityPhrase({ activity: { kind: 'thinking' } }, [], tick);
  assert.equal(phrase(-1), 'Thinking it through');
  assert.equal(phrase(0), 'Thinking it through');
  assert.equal(phrase(1), 'Mulling it over');
});
