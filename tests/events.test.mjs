import test from 'node:test';
import assert from 'node:assert/strict';
import { startEvents } from '../web/src/lib/events.ts';
import { useStore } from '../web/src/store.ts';

test('stopping live events clears connected status', t => {
  let source;
  t.after(() => { delete globalThis.window; delete globalThis.document; delete globalThis.EventSource; });
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget();
  globalThis.EventSource = class { constructor() { source = this; } close() {} };
  const stop = startEvents();
  source.onopen();
  assert.equal(useStore.getState().sseConnected, true);
  stop();
  assert.equal(useStore.getState().sseConnected, false);
});
