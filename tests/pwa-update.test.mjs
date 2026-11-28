import test from 'node:test';
import assert from 'node:assert/strict';
import { watchForAppUpdates } from '../web/src/lib/pwa.ts';

function fakeContainer(initialController) {
  const listeners = {};
  return {
    controller: initialController,
    addEventListener(name, fn) { (listeners[name] ??= []).push(fn); },
    removeEventListener(name, fn) {
      const list = listeners[name];
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx !== -1) list.splice(idx, 1);
    },
    claim() { this.controller = { claimed: true }; for (const fn of [...(listeners.controllerchange ?? [])]) fn({}); },
    clear() { this.controller = null; for (const fn of [...(listeners.controllerchange ?? [])]) fn({}); },
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

test('does not reload on the first install claim, but reloads once on a later deploy', () => {
  const sw = fakeContainer(null);
  let reloads = 0;
  watchForAppUpdates(sw, () => reloads++);
  sw.claim();
  assert.equal(reloads, 0);
  sw.claim();
  assert.equal(reloads, 1);
  sw.claim();
  assert.equal(reloads, 1);
});

test('does not reload when the controller is cleared without a replacement worker', () => {
  const sw = fakeContainer({ old: true });
  let reloads = 0;
  watchForAppUpdates(sw, () => reloads++);
  sw.clear();
  assert.equal(reloads, 0);
  sw.claim();
  assert.equal(reloads, 1);
});

test('ignores spurious controllerchange while still uncontrolled before first claim', () => {
  const sw = fakeContainer(null);
  let reloads = 0;
  watchForAppUpdates(sw, () => reloads++);
  sw.clear();
  sw.claim();
  assert.equal(reloads, 0);
  sw.claim();
  assert.equal(reloads, 1);
});

test('returned cleanup detaches the controllerchange listener', () => {
  const sw = fakeContainer({ old: true });
  let reloads = 0;
  const stop = watchForAppUpdates(sw, () => reloads++);
  stop();
  sw.claim();
  assert.equal(reloads, 0);
});
