import test from 'node:test';
import assert from 'node:assert/strict';
import { watchForAppUpdates } from '../web/src/lib/pwa.ts';

function fakeContainer(initialController) {
  const listeners = {};
  return {
    controller: initialController,
    addEventListener(name, fn) { (listeners[name] ??= []).push(fn); },
    claim() { this.controller = { claimed: true }; for (const fn of listeners.controllerchange ?? []) fn({}); },
  };
}

test('reloads exactly once when a deployed worker claims an existing tab', () => {
  const sw = fakeContainer({ old: true });
  let reloads = 0;
  watchForAppUpdates(sw, () => reloads++);
  sw.claim();
  sw.claim();
  assert.equal(reloads, 1);
});

test('does not reload when the first worker claims the tab', () => {
  const sw = fakeContainer(null);
  let reloads = 0;
  watchForAppUpdates(sw, () => reloads++);
  sw.claim();
  assert.equal(reloads, 0);
});
