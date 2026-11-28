import test from 'node:test';
import assert from 'node:assert/strict';
import { activityPhrase } from '../web/src/lib/phrases.ts';

test('an activity newer than the last UI clock tick starts at its first phrase', () => {
  const phrase = tick => activityPhrase({ activity: { kind: 'thinking' } }, [], tick);
  assert.equal(phrase(-1), 'Thinking it through');
  assert.equal(phrase(0), 'Thinking it through');
  assert.equal(phrase(1), 'Mulling it over');
});

test('non-finite and fractional ticks always resolve to a valid phrase', () => {
  const phrase = tick => activityPhrase({ activity: { kind: 'thinking' } }, [], tick);
  assert.equal(phrase(Number.NaN), 'Thinking it through');
  assert.equal(phrase(Number.POSITIVE_INFINITY), 'Thinking it through');
  assert.equal(phrase(Number.NEGATIVE_INFINITY), 'Thinking it through');
  assert.equal(phrase(1.9), 'Mulling it over');
});

test('connecting_service trims display names and rejects whitespace or raw slugs', () => {
  const phrase = detail => activityPhrase({ activity: { kind: 'connecting_service', detail } }, [], 0);
  assert.equal(phrase('  GitHub  '), 'Working in GitHub');
  assert.equal(phrase('   '), 'Working in a connected app');
  assert.equal(phrase('gmail'), 'Working in a connected app');
  assert.equal(phrase('GMAIL_SEND'), 'Working in a connected app');
});

test('messaging_named ignores blank bot_name and finds running bot_name across parallel tool calls', () => {
  const parallelRows = [
    { body: { type: 'tool-call', status: 'running', args: { bot_name: '  Researcher  ' } } },
    { body: { type: 'tool-call', status: 'running', args: { path: 'notes.md' } } },
  ];
  assert.equal(
    activityPhrase({ activity: { kind: 'messaging_named' } }, parallelRows, 0),
    'Checking with Researcher',
  );

  const blankRows = [
    { body: { type: 'tool-call', status: 'running', args: { bot_name: '   ' } } },
  ];
  assert.equal(
    activityPhrase({ activity: { kind: 'messaging_named', detail: '  Planner  ' } }, blankRows, 0),
    'Checking with Planner',
  );
  assert.equal(
    activityPhrase({ activity: { kind: 'messaging_named', detail: '   ' } }, blankRows, 0),
    'Checking with another Bot',
  );
});
