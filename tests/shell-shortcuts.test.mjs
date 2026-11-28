import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectEdgeSwipeStart,
  isEditableTarget,
  resolveEdgeSwipeEnd,
  resolveShellShortcut,
  shouldCloseScrimSwipe,
} from '../web/src/lib/shellShortcuts.ts';

const BASE_CTX = {
  isMobile: false,
  hasModal: false,
  viewerOpen: false,
  hasConfigModal: false,
  mobileSidebarOpen: false,
  detailsOpen: false,
};

test('resolveShellShortcut ignores defaultPrevented, IME composition, and viewer-open states', () => {
  assert.equal(resolveShellShortcut({ key: 'k', metaKey: true, defaultPrevented: true }, BASE_CTX), null);
  assert.equal(resolveShellShortcut({ key: 'k', metaKey: true, isComposing: true }, BASE_CTX), null);
  assert.equal(resolveShellShortcut({ key: 'k', metaKey: true, keyCode: 229 }, BASE_CTX), null);
  assert.equal(resolveShellShortcut({ key: 'k', metaKey: true }, { ...BASE_CTX, viewerOpen: true }), null);
  assert.equal(resolveShellShortcut({ key: 'n', altKey: true }, { ...BASE_CTX, viewerOpen: true }), null);
});

test('resolveShellShortcut blocks Alt+N inside editable elements and rejects AltGr / extra modifiers', () => {
  const inputTarget = { tagName: 'INPUT' };
  const textareaTarget = { tagName: 'TEXTAREA' };
  const editableTarget = { tagName: 'DIV', isContentEditable: true };
  assert.equal(isEditableTarget(inputTarget), true);
  assert.equal(isEditableTarget(editableTarget), true);
  assert.equal(isEditableTarget({ tagName: 'BUTTON' }), false);

  assert.equal(resolveShellShortcut({ key: 'n', altKey: true, target: inputTarget }, BASE_CTX), null);
  assert.equal(resolveShellShortcut({ key: 'n', altKey: true, target: textareaTarget }, BASE_CTX), null);
  assert.equal(resolveShellShortcut({ key: 'n', altKey: true, target: editableTarget }, BASE_CTX), null);
  assert.equal(resolveShellShortcut({ key: 'n', altKey: true, shiftKey: true }, BASE_CTX), null);
  assert.equal(resolveShellShortcut({ key: 'n', altKey: true, target: { tagName: 'DIV' } }, BASE_CTX), 'toggle-create');

  // AltGr (Ctrl+Alt) and Shift+Cmd+K/B must not trigger studio shortcuts.
  assert.equal(resolveShellShortcut({ key: 'k', ctrlKey: true, altKey: true }, BASE_CTX), null);
  assert.equal(resolveShellShortcut({ key: 'b', metaKey: true, altKey: true }, BASE_CTX), null);
  assert.equal(resolveShellShortcut({ key: 'k', metaKey: true, shiftKey: true }, BASE_CTX), null);
  assert.equal(resolveShellShortcut({ key: 'b', metaKey: true, shiftKey: true }, BASE_CTX), null);
});

test('resolveShellShortcut maps studio hotkeys and mobile drawer Escape accurately', () => {
  assert.equal(resolveShellShortcut({ key: 'k', metaKey: true }, BASE_CTX), 'toggle-search');
  assert.equal(resolveShellShortcut({ key: 'b', ctrlKey: true }, BASE_CTX), 'toggle-sidebar');
  assert.equal(resolveShellShortcut({ key: 'O', metaKey: true, shiftKey: true }, BASE_CTX), 'toggle-create');
  assert.equal(resolveShellShortcut({ key: '<', metaKey: true, shiftKey: true }, BASE_CTX), 'toggle-details');
  assert.equal(resolveShellShortcut({ key: ',', metaKey: true }, BASE_CTX), 'open-settings');

  const mobileDrawerCtx = { ...BASE_CTX, isMobile: true, mobileSidebarOpen: true };
  assert.equal(resolveShellShortcut({ key: 'Escape' }, mobileDrawerCtx), 'close-mobile-drawers');
  assert.equal(resolveShellShortcut({ key: 'Escape', shiftKey: true }, mobileDrawerCtx), null);
  assert.equal(resolveShellShortcut({ key: 'Escape' }, { ...mobileDrawerCtx, hasModal: true }), null);
});

test('edge swipe and scrim swipe helpers enforce side, distance, and horizontal ratio', () => {
  const left = detectEdgeSwipeStart(12, 200, 390, true);
  assert.deepEqual(left, { x: 12, y: 200, side: 'left' });
  assert.equal(resolveEdgeSwipeEnd(left, 90, 205), 'open-sidebar');
  assert.equal(resolveEdgeSwipeEnd(left, 90, 290), null); // too vertical

  const right = detectEdgeSwipeStart(380, 200, 390, true);
  assert.deepEqual(right, { x: 380, y: 200, side: 'right' });
  assert.equal(resolveEdgeSwipeEnd(right, 300, 204), 'open-details');
  assert.equal(detectEdgeSwipeStart(380, 200, 390, false), null);
  assert.equal(detectEdgeSwipeStart(150, 200, 390, true), null);

  assert.equal(shouldCloseScrimSwipe({ x: 200, y: 100 }, 140, 105, true, false), true);
  assert.equal(shouldCloseScrimSwipe({ x: 200, y: 100 }, 260, 105, false, true), true);
  assert.equal(shouldCloseScrimSwipe({ x: 200, y: 100 }, 260, 105, true, false), false);
});
