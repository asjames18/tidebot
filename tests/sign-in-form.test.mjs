import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialSignInError,
  isValidSignInEmail,
  shouldAdvanceSignInFocus,
  validateSignInDraft,
} from '../web/src/lib/signInForm.ts';

test('initialSignInError reports OAuth failure query flag only', () => {
  assert.equal(initialSignInError('?login=failed'), 'Sign-in didn’t finish. Try again.');
  assert.equal(initialSignInError('?login=ok'), null);
  assert.equal(initialSignInError(''), null);
});

test('isValidSignInEmail matches server email format and length rules', () => {
  assert.equal(isValidSignInEmail('ada@example.com'), true);
  assert.equal(isValidSignInEmail('  ada+tag@sub.example.co  '), true);
  assert.equal(isValidSignInEmail('@'), false);
  assert.equal(isValidSignInEmail('ada@'), false);
  assert.equal(isValidSignInEmail('@example.com'), false);
  assert.equal(isValidSignInEmail('ada@localhost'), false);
  assert.equal(isValidSignInEmail(`${'a'.repeat(245)}@example.com`), false); // 257 > 254
});

test('validateSignInDraft checks email, blank invite codes, and password bounds without trimming passwords', () => {
  assert.deepEqual(
    validateSignInDraft({ mode: 'signin', email: 'bad@', invite: '', name: '', password: 'secret' }),
    { ok: false, error: 'Enter a valid email address' },
  );
  assert.deepEqual(
    validateSignInDraft({ mode: 'invite', email: '', invite: '   ', name: '', password: 'long-enough-password' }),
    { ok: false, error: 'Enter your invite code' },
  );
  assert.deepEqual(
    validateSignInDraft({ mode: 'local', email: 'ada@example.com', invite: '', name: '', password: 'short' }),
    { ok: false, error: 'Use a password of 12 to 256 characters.' },
  );
  assert.deepEqual(
    validateSignInDraft({ mode: 'signin', email: 'ada@example.com', invite: '', name: '', password: 'x'.repeat(1025) }),
    { ok: false, error: 'Password is too long.' },
  );

  // Preserves leading/trailing spaces in password while trimming email/name/invite.
  assert.deepEqual(
    validateSignInDraft({ mode: 'signin', email: '  ada@example.com ', invite: '', name: '  Ada  ', password: '  pw  ' }),
    { ok: true, email: 'ada@example.com', invite: '', name: 'Ada', password: '  pw  ' },
  );
  assert.deepEqual(
    validateSignInDraft({ mode: 'invite', email: '', invite: '  abc123  ', name: '   ', password: '12-char-pass' }),
    { ok: true, email: '', invite: 'abc123', name: undefined, password: '12-char-pass' },
  );
});

test('shouldAdvanceSignInFocus advances on Enter only when password is empty and IME is inactive', () => {
  assert.equal(shouldAdvanceSignInFocus({ key: 'Enter' }, false), true);
  assert.equal(shouldAdvanceSignInFocus({ key: 'Enter' }, true), false);
  assert.equal(shouldAdvanceSignInFocus({ key: 'Enter', isComposing: true }, false), false);
  assert.equal(shouldAdvanceSignInFocus({ key: 'Enter', keyCode: 229 }, false), false);
  assert.equal(shouldAdvanceSignInFocus({ key: 'Tab' }, false), false);
});
