import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODAL_FOCUSABLE_SELECTOR,
  initialModalControlSelector,
  nextModalTabTarget,
  pickInitialModalFocus,
  sheetSwipeDeltaY,
  shouldDismissOnEscape,
} from '../web/src/lib/modalFocus.ts';

test('shouldDismissOnEscape ignores IME composition and already-handled Escape events', () => {
  assert.equal(shouldDismissOnEscape({ key: 'Escape' }), true);
  assert.equal(shouldDismissOnEscape({ key: 'Enter' }), false);
  assert.equal(shouldDismissOnEscape({ key: 'Escape', defaultPrevented: true }), false);
  assert.equal(shouldDismissOnEscape({ key: 'Escape', isComposing: true }), false);
  assert.equal(shouldDismissOnEscape({ key: 'Escape', keyCode: 229 }), false);
});

test('nextModalTabTarget traps focus when empty, on dialog container, or outside modal', () => {
  const dialog = { id: 'dialog' };
  const first = { id: 'first' };
  const middle = { id: 'middle' };
  const last = { id: 'last' };
  const outside = { id: 'outside' };

  // Empty modal (e.g. all buttons disabled) keeps focus on dialog container.
  assert.equal(nextModalTabTarget(dialog, [], dialog, false, true), dialog);
  assert.equal(nextModalTabTarget(dialog, [], dialog, true, true), dialog);

  // Wrapping at first / last edges.
  assert.equal(nextModalTabTarget(dialog, [first, middle, last], first, true, true), last);
  assert.equal(nextModalTabTarget(dialog, [first, middle, last], last, false, true), first);

  // Shift+Tab from the dialog container itself wraps to last instead of escaping.
  assert.equal(nextModalTabTarget(dialog, [first, middle, last], dialog, true, true), last);
  // Forward Tab from dialog container lets native traversal enter first.
  assert.equal(nextModalTabTarget(dialog, [first, middle, last], dialog, false, true), null);

  // Interior navigation stays native.
  assert.equal(nextModalTabTarget(dialog, [first, middle, last], middle, false, true), null);
  assert.equal(nextModalTabTarget(dialog, [first, middle, last], middle, true, true), null);

  // Escaped focus pulls back into the appropriate end of the dialog.
  assert.equal(nextModalTabTarget(dialog, [first, middle, last], outside, false, false), first);
  assert.equal(nextModalTabTarget(dialog, [first, middle, last], outside, true, false), last);
});

test('pickInitialModalFocus prioritizes autofocus, then preferred controls, then any focusable, then dialog', () => {
  const dialog = { id: 'dialog' };
  const auto = { id: 'auto' };
  const pref = { id: 'pref' };
  const link = { id: 'link' };

  assert.equal(pickInitialModalFocus(dialog, [auto], [pref], [link]), auto);
  assert.equal(pickInitialModalFocus(dialog, [], [pref], [link]), pref);
  assert.equal(pickInitialModalFocus(dialog, [], [], [link]), link);
  assert.equal(pickInitialModalFocus(dialog, [], [], []), dialog);

  assert.match(MODAL_FOCUSABLE_SELECTOR, /input:not\(\[disabled\]\):not\(\[type="hidden"\]\)/);
  assert.match(initialModalControlSelector(false), /button:not\(\[disabled\]\)/);
  assert.match(initialModalControlSelector(true), /^button:not\(\[disabled\]\)$/);
});

test('sheetSwipeDeltaY handles missing or empty changedTouches safely', () => {
  assert.equal(sheetSwipeDeltaY([{ clientY: 180 }], 100), 80);
  assert.equal(sheetSwipeDeltaY([], 100), null);
  assert.equal(sheetSwipeDeltaY(undefined, 100), null);
  assert.equal(sheetSwipeDeltaY([{ clientY: 180 }], null), null);
  assert.equal(sheetSwipeDeltaY([{ clientY: Number.NaN }], 100), null);
});
