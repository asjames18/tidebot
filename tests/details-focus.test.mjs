import test from 'node:test';
import assert from 'node:assert/strict';
import { closeDetailsAndReturnFocus } from '../web/src/lib/detailsFocus.ts';
import { closeMenuAndRestoreFocus, nextMenuIndex } from '../web/src/lib/menuNav.ts';

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

test('nextMenuIndex wraps ArrowDown/ArrowUp, handles Home/End, and ignores unrelated keys', () => {
  assert.equal(nextMenuIndex(-1, 3, 'ArrowDown'), 0);
  assert.equal(nextMenuIndex(0, 3, 'ArrowDown'), 1);
  assert.equal(nextMenuIndex(2, 3, 'ArrowDown'), 0);
  assert.equal(nextMenuIndex(-1, 3, 'ArrowUp'), 2);
  assert.equal(nextMenuIndex(0, 3, 'ArrowUp'), 2);
  assert.equal(nextMenuIndex(2, 3, 'ArrowUp'), 1);
  assert.equal(nextMenuIndex(2, 3, 'Home'), 0);
  assert.equal(nextMenuIndex(0, 3, 'End'), 2);
  assert.equal(nextMenuIndex(0, 3, 'Enter'), null);
  assert.equal(nextMenuIndex(0, 0, 'ArrowDown'), null);
});

test('closeMenuAndRestoreFocus closes first and restores focus only to a connected trigger', () => {
  const order = [];
  let focusOpts = null;
  const connected = {
    isConnected: true,
    focus(opts) { order.push('focus'); focusOpts = opts; },
  };
  closeMenuAndRestoreFocus(() => { order.push('close'); }, connected);
  assert.deepEqual(order, ['close', 'focus']);
  assert.deepEqual(focusOpts, { preventScroll: true });

  let disconnectedFocused = false;
  closeMenuAndRestoreFocus(() => {}, {
    isConnected: false,
    focus() { disconnectedFocused = true; },
  });
  assert.equal(disconnectedFocused, false);
  assert.doesNotThrow(() => closeMenuAndRestoreFocus(() => {}, null));
});
