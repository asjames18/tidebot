import test from 'node:test';
import assert from 'node:assert/strict';
import { Hub } from '../server/dist/lib/hub.js';

test('duplicate unsubscribe from a closed SSE stream does not evict a reconnected listener', () => {
  const hub = new Hub();
  const seen = [];

  // Mirrors routes.ts /api/events: stream.onAbort() calls unsub(), a new tab
  // connects and subscribes, and then the exiting loop calls unsub() a second time.
  const unsubOld = hub.subscribe('u1', () => { seen.push('old'); });
  unsubOld();
  assert.equal(hub.isOnline('u1'), false);

  const unsubNew = hub.subscribe('u1', (ev) => { seen.push(`new:${ev.type}`); });
  assert.equal(hub.isOnline('u1'), true);

  // Stale second cleanup call must be a no-op.
  unsubOld();
  assert.equal(hub.isOnline('u1'), true);

  hub.emit('u1', { type: 'roster' });
  assert.deepEqual(seen, ['new:roster']);

  unsubNew();
  assert.equal(hub.isOnline('u1'), false);
});

test('emit isolates throwing listeners and snapshots subscriptions during fan-out', () => {
  const hub = new Hub();
  const calls = [];
  let unsubSelf = () => {};
  let addedDuringEmit = 0;

  hub.subscribe('u1', () => {
    calls.push('thrower');
    throw new Error('broken stream');
  });
  unsubSelf = hub.subscribe('u1', () => {
    calls.push('self');
    unsubSelf();
    hub.subscribe('u1', () => { addedDuringEmit += 1; });
  });
  hub.subscribe('u1', () => {
    calls.push('survivor');
  });

  hub.emit('u1', { type: 'roster' });
  assert.deepEqual(calls, ['thrower', 'self', 'survivor']);
  assert.equal(addedDuringEmit, 0);

  hub.emit('u1', { type: 'roster' });
  assert.equal(addedDuringEmit, 1);
});

test('events are isolated per user', () => {
  const hub = new Hub();
  const seen = [];
  hub.subscribe('u1', (ev) => seen.push(`u1:${ev.type}`));
  hub.subscribe('u2', (ev) => seen.push(`u2:${ev.type}`));
  hub.emit('u1', { type: 'roster' });
  assert.deepEqual(seen, ['u1:roster']);
});
