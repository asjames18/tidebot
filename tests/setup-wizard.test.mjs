// Tests for the first-run wizard step derivation (plan §2.2). Pure function
// over the GET /api/setup/status payload — no network, no model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { wizardSteps } from '../web/src/lib/setupWizard.ts';

const base = { provider: 'openrouter', defaultModel: 'openrouter/free' };

test('fresh user: all five steps pending, model steps point at Settings', () => {
  const steps = wizardSteps({ ...base, modelConfigured: false, hasOperator: false, hasCompletedRun: false, setupComplete: false });
  assert.equal(steps.length, 5);
  assert.deepEqual(steps.map((s) => s.done), [false, false, false, false, false]);
  assert.deepEqual(steps.slice(0, 3).map((s) => s.action), ['models', 'models', 'models']);
  assert.equal(steps[3].action, 'create');
  assert.equal(steps[4].action, 'chat');
});

test('model configured: first three steps done and named', () => {
  const steps = wizardSteps({ ...base, modelConfigured: true, hasOperator: false, hasCompletedRun: false, setupComplete: false });
  assert.deepEqual(steps.map((s) => s.done), [true, true, true, false, false]);
  assert.match(steps[0].detail, /openrouter/);
  assert.match(steps[0].detail, /openrouter\/free/);
});

test('operator + finished run: every step done', () => {
  const steps = wizardSteps({ ...base, modelConfigured: true, hasOperator: true, hasCompletedRun: true, setupComplete: true });
  assert.ok(steps.every((s) => s.done));
});
