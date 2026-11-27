// Regression tests for the central log-redaction helper (Phase 5.2, issue #35).
// redactSecrets must replace every known key value — env keys and extra
// (DB-decrypted) values passed by the caller — with [redacted], including
// inside Error messages/stacks, and must never throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecrets } from '../server/dist/lib/redact.js';

test('redacts an env key value from plain text', () => {
  process.env.OPENROUTER_API_KEY = 'sk-or-fake-key-0123456789';
  const out = redactSecrets('mint failed: bad key sk-or-fake-key-0123456789 here');
  assert.equal(out, 'mint failed: bad key [redacted] here');
  delete process.env.OPENROUTER_API_KEY;
});

test('redacts an extra (DB-decrypted) secret passed by the caller', () => {
  const out = redactSecrets('error body mentions db-key-abcdef123456', ['db-key-abcdef123456']);
  assert.equal(out, 'error body mentions [redacted]');
});

test('leaves short values alone', () => {
  const out = redactSecrets('the word short stays', ['short']);
  assert.equal(out, 'the word short stays');
});

test('redacts inside an Error message', () => {
  process.env.XAI_API_KEY = 'xai-fake-key-9876543210';
  const err = new Error('mint failed for xai-fake-key-9876543210');
  const out = redactSecrets(err);
  assert.match(out, /Error: mint failed for \[redacted\]/);
  assert.doesNotMatch(out, /xai-fake-key-9876543210/);
  delete process.env.XAI_API_KEY;
});

test('longest secret wins when one contains the other', () => {
  const out = redactSecrets('key=abcdefghijklmnop end', ['abcdefghij', 'abcdefghijklmnop']);
  assert.equal(out, 'key=[redacted] end');
});

test('stringifies non-string input and never throws', () => {
  assert.equal(redactSecrets(42), '42');
  assert.equal(redactSecrets(null), '');
  assert.equal(redactSecrets(undefined), '');
});
