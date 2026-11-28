// Actionable setup-path model errors (development plan §2.2).
// The classifier only pattern-matches the raw error — it never echoes it —
// so no key material can reach the UI through an explanation.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { explainModelError, formatModelError, providerDisplayName } = await import(
  '../server/dist/lib/modelError.js'
);

test('provider display names', () => {
  assert.equal(providerDisplayName('openrouter'), 'OpenRouter');
  assert.equal(providerDisplayName('xai'), 'xAI');
  assert.equal(providerDisplayName('custom'), 'your custom provider');
  assert.equal(providerDisplayName(''), 'your model provider');
});

test('401 with a key in the message: rejected key, key never echoed', () => {
  const fakeKey = 'sk-or-v1-' + 'test-key-'.repeat(7) + 'not-real';
  const e = explainModelError('openrouter', 'openai/gpt-4o-mini', {
    status: 401,
    message: `401 Incorrect API key provided: ${fakeKey}`,
  });
  assert.equal(e.title, 'Your API key was rejected');
  assert.equal(e.provider, 'OpenRouter');
  assert.match(e.nextStep, /fresh key/);
  assert.equal(JSON.stringify(e).includes(fakeKey), false);
  assert.equal(formatModelError('openrouter', 'openai/gpt-4o-mini', { status: 401, message: fakeKey }).includes(fakeKey), false);
});

test('401 as a bare string still classifies', () => {
  const e = explainModelError('xai', 'grok-4', '401 Unauthorized');
  assert.equal(e.title, 'Your API key was rejected');
  assert.equal(e.provider, 'xAI');
});

test('missing-key message names the fix', () => {
  const e = explainModelError('openrouter', 'openai/gpt-4o-mini', new Error(
    'The OPENAI_API_KEY environment variable is missing or empty',
  ));
  assert.equal(e.title, 'No API key configured');
  assert.match(e.nextStep, /Paste your OpenRouter key/);
});

test('404 names the model and points at the curated list', () => {
  const e = explainModelError('openrouter', 'openai/gpt-9', {
    status: 404,
    message: '404 No endpoints found for openai/gpt-9',
  });
  assert.equal(e.title, 'Model not available');
  assert.match(e.cause, /openai\/gpt-9/);
  assert.match(e.nextStep, /curated list/);
});

test('402 insufficient credits', () => {
  const e = explainModelError('openrouter', 'openai/gpt-4o-mini', {
    status: 402,
    message: '402 Insufficient credits',
  });
  assert.equal(e.title, 'Out of credits');
  assert.match(e.nextStep, /Top up credits/);
});

test('429 rate limit', () => {
  const e = explainModelError('xai', 'grok-4', { status: 429, message: 'Rate limit exceeded' });
  assert.equal(e.title, 'Rate-limited');
});

test('ECONNREFUSED on a custom provider points at Ollama', () => {
  const err = new TypeError('fetch failed');
  err.cause = new Error('connect ECONNREFUSED 127.0.0.1:11434');
  err.cause.code = 'ECONNREFUSED';
  const e = explainModelError('custom', 'llama3.1', err);
  assert.equal(e.title, "Can't reach your local model server");
  assert.match(e.nextStep, /ollama serve/);
});

test('fetch failed on OpenRouter is a network problem, not an Ollama hint', () => {
  const err = new TypeError('fetch failed');
  err.cause = new Error('getaddrinfo ENOTFOUND openrouter.ai');
  err.cause.code = 'ENOTFOUND';
  const e = explainModelError('openrouter', 'openai/gpt-4o-mini', err);
  assert.match(e.title, /Can't resolve OpenRouter/);
});

test('timeout and empty reply classify', () => {
  assert.equal(
    explainModelError('openrouter', 'm', { name: 'AbortError', message: 'The operation timed out' }).title,
    'The provider timed out',
  );
  assert.equal(
    explainModelError('openrouter', 'm', new Error('The provider returned no reply. Try another model.')).title,
    'The provider answered with nothing',
  );
});

test('500 is a provider problem; unknown errors fall back with a redacted detail', () => {
  const e = explainModelError('openrouter', 'm', { status: 500, message: 'Internal server error' });
  assert.equal(e.title, 'The provider had a problem');

  const fakeKey = 'sk-or-v1-' + 'test-key-'.repeat(7) + 'not-real';
  const unknown = explainModelError('openrouter', 'm', new Error(`weird failure with ${fakeKey} inside`));
  assert.equal(unknown.title, 'The connection test failed');
  assert.equal(JSON.stringify(unknown).includes(fakeKey), false);
  assert.match(unknown.detail ?? '', /\[redacted\]/);
});

test('formatModelError carries provider, title, cause and next step in one line', () => {
  const s = formatModelError('xai', 'grok-4', { status: 429, message: 'slow down' });
  assert.match(s, /^xAI — Rate-limited\. Likely cause: .* Next step: /);
  assert.equal(s.includes('\n'), false);
});
