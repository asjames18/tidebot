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

test('a routine trigger refreshes a routine list already open in the studio', t => {
  const { loadRoutines, routines, selectedBotId, transcripts } = useStore.getState();
  t.after(() => useStore.setState({ loadRoutines, routines, selectedBotId, transcripts }));
  const refresh = t.mock.fn(async () => {});
  useStore.setState({ loadRoutines: refresh, routines: { fixture: [] }, selectedBotId: 'another-bot' });

  useStore.getState().handleEvent({
    type: 'rows', botId: 'fixture', generation: 0,
    rows: [{
      botId: 'fixture', seq: 1, generation: 0, updatedSeq: 1, createdAt: 1, kind: 'event',
      body: { type: 'event', event: 'routine-run', ref: 'test-routine', text: 'Running routine' },
    }],
  });
  assert.deepEqual(refresh.mock.calls.map((call) => call.arguments), [['fixture']]);
});
