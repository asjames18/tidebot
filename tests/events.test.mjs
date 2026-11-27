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

test('reconnecting refreshes runs for the selected bot', (t) => {
  let source;
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget();
  globalThis.EventSource = class { constructor() { source = this; } close() {} };
  const previous = useStore.getState();
  const ignore = async () => {};
  useStore.setState({ selectedBotId: 'bot-fixture', loadBots: ignore, loadComputer: ignore, loadRows: ignore, loadRoutines: ignore });
  const events = [];
  window.addEventListener('grokbot:event', (event) => events.push(event.detail));
  const stop = startEvents();
  t.after(() => {
    stop();
    useStore.setState(previous);
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.EventSource;
  });

  source.onopen();
  assert.deepEqual(events, []);
  source.onerror();
  source.onopen();
  assert.deepEqual(events, [{ type: 'runs', botId: 'bot-fixture' }]);
});
