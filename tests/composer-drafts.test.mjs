import test from 'node:test';
import assert from 'node:assert/strict';
import { DraftStore, insertDictatedText } from '../web/src/lib/composerDrafts.ts';

test('DraftStore isolates drafts across bot switches without cross-contamination', () => {
  const store = new DraftStore();
  store.set('bot-a', 'Draft for A');
  store.set('bot-b', 'Draft for B');
  assert.equal(store.get('bot-a'), 'Draft for A');
  assert.equal(store.get('bot-b'), 'Draft for B');
  assert.equal(store.get('bot-c'), '');

  store.set('bot-a', '');
  assert.equal(store.get('bot-a'), '');
  assert.equal(store.get('bot-b'), 'Draft for B');
});

test('completeSend clears target draft without wiping a different active bot or newer edits', () => {
  const store = new DraftStore();
  store.set('bot-a', 'Send this');
  store.set('bot-b', 'Typing in B');

  // Switched to bot-b while bot-a send was in flight: bot-a clears, bot-b is untouched.
  assert.equal(store.completeSend('bot-a', 'bot-b', 'Send this'), false);
  assert.equal(store.get('bot-a'), '');
  assert.equal(store.get('bot-b'), 'Typing in B');

  // Same active bot with matching text clears both store and visible composer.
  assert.equal(store.completeSend('bot-b', 'bot-b', 'Typing in B'), true);
  assert.equal(store.get('bot-b'), '');

  // If user edited the same bot before send resolved, preserve the newer draft.
  store.set('bot-a', 'Newer follow-up');
  assert.equal(store.completeSend('bot-a', 'bot-a', 'Older text'), false);
  assert.equal(store.get('bot-a'), 'Newer follow-up');
});

test('completeEnhance preserves edits and routes background completions to the originating bot', () => {
  const store = new DraftStore();
  store.set('bot-a', 'summarize notes');
  store.set('bot-b', 'work on B');

  // User switched to bot-b while bot-a enhance was in flight: store updates bot-a, not visible bot-b.
  assert.equal(store.completeEnhance('bot-a', 'bot-b', 'summarize notes', 'Enhanced A'), false);
  assert.equal(store.get('bot-a'), 'Enhanced A');
  assert.equal(store.get('bot-b'), 'work on B');

  // User stayed on bot-b and did not edit: updates both store and visible composer.
  assert.equal(store.completeEnhance('bot-b', 'bot-b', 'work on B', 'Enhanced B'), true);
  assert.equal(store.get('bot-b'), 'Enhanced B');

  // User edited bot-b before enhance finished: stale response is ignored.
  store.set('bot-b', 'manual override');
  assert.equal(store.completeEnhance('bot-b', 'bot-b', 'Enhanced B', 'Stale'), false);
  assert.equal(store.get('bot-b'), 'manual override');
});

test('insertDictatedText adds smart spacing and clamps out-of-range offsets', () => {
  assert.deepEqual(insertDictatedText('Hello', 'world', 5, 5), { text: 'Hello world', caret: 11 });
  assert.deepEqual(insertDictatedText('Hello world', 'there', 5, 6), { text: 'Hello there world', caret: 11 });
  assert.deepEqual(insertDictatedText('Hello ', 'world', 6, 6), { text: 'Hello world', caret: 11 });
  assert.deepEqual(insertDictatedText('', 'hi', -5, 99), { text: 'hi', caret: 2 });
});
