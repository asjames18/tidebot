import test from 'node:test';
import assert from 'node:assert/strict';
import { startEvents } from '../web/src/lib/events.ts';
import { useStore } from '../web/src/store.ts';

test('the first live connection resyncs the workspace if an earlier attempt failed', t => {
  let source;
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget();
  globalThis.EventSource = class {
    static OPEN = 1;
    static CLOSED = 2;
    readyState = 0;
    constructor() { source = this; }
    close() { this.readyState = 2; }
  };
  const { loadBots, loadComputer, loadRows, loadRoutines, selectedBotId } = useStore.getState();
  const refreshBots = t.mock.fn(async () => {});
  const refreshComputer = t.mock.fn(async () => {});
  const refreshRows = t.mock.fn(async () => {});
  const refreshRoutines = t.mock.fn(async () => {});
  useStore.setState({
    selectedBotId: 'fixture', loadBots: refreshBots, loadComputer: refreshComputer,
    loadRows: refreshRows, loadRoutines: refreshRoutines,
  });
  const stop = startEvents();
  t.after(() => {
    stop();
    useStore.setState({ loadBots, loadComputer, loadRows, loadRoutines, selectedBotId });
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.EventSource;
  });

  const firstAttempt = source;
  firstAttempt.readyState = EventSource.CLOSED;
  firstAttempt.onerror();
  assert.equal(useStore.getState().sseConnected, false);
  window.dispatchEvent(new Event('online'));
  assert.notEqual(source, firstAttempt);
  source.readyState = EventSource.OPEN;
  source.onopen();

  assert.equal(useStore.getState().sseConnected, true);
  assert.equal(refreshBots.mock.callCount(), 1);
  assert.equal(refreshComputer.mock.callCount(), 1);
  assert.deepEqual(refreshRows.mock.calls.map(call => call.arguments), [['fixture']]);
  assert.deepEqual(refreshRoutines.mock.calls.map(call => call.arguments), [['fixture']]);
});

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
