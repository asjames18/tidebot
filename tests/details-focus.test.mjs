import test from 'node:test';
import assert from 'node:assert/strict';
import { closeDetailsAndReturnFocus } from '../web/src/lib/detailsFocus.ts';

test('details close captures the toggle before closing', () => {
  const order = [];
  const toggle = { focus: () => { order.push('focus'); } };
  closeDetailsAndReturnFocus(
    () => { order.push('close'); },
    () => { order.push('find'); return toggle; },
  );
  assert.deepEqual(order, ['find', 'close', 'focus']);
});

test('details close focuses the captured toggle even if a later lookup finds nothing', () => {
  let focused = false;
  let lookups = 0;
  const toggle = { focus: () => { focused = true; } };
  closeDetailsAndReturnFocus(
    () => { /* panel closed: aria-controls is gone after this */ },
    () => { lookups += 1; return lookups === 1 ? toggle : null; },
  );
  assert.equal(focused, true);
});

test('details close still closes when there is no toggle to return focus to', () => {
  let closed = false;
  assert.doesNotThrow(() => {
    closeDetailsAndReturnFocus(
      () => { closed = true; },
      () => null,
    );
  });
  assert.equal(closed, true);
});
