import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScreenSocketUrl,
  endTopSwipe,
  IDLE_TOP_SWIPE,
  moveTopSwipe,
  shouldClearWaking,
  shouldCloseViewerOnKey,
  startTopSwipe,
} from '../web/src/lib/computerViewer.ts';

test('top swipe closes when dragged past threshold and cancels when pulled back up', () => {
  let swipe = startTopSwipe(100, 20);
  swipe = moveTopSwipe(swipe, 102, 100); // dy = 80 > 64
  assert.equal(swipe.dragY, 80);

  // Pulling back up to near the start resets dragY to 0 so releasing does not close.
  swipe = moveTopSwipe(swipe, 101, 22); // dy = 2 <= 6
  assert.equal(swipe.dragY, 0);
  const cancelled = endTopSwipe(swipe);
  assert.equal(cancelled.shouldClose, false);
  assert.deepEqual(cancelled.next, IDLE_TOP_SWIPE);

  // Dragging down past 64 and releasing closes immediately.
  let closeSwipe = startTopSwipe(50, 10);
  closeSwipe = moveTopSwipe(closeSwipe, 52, 90);
  const closed = endTopSwipe(closeSwipe);
  assert.equal(closed.shouldClose, true);
  assert.deepEqual(closed.next, IDLE_TOP_SWIPE);
});

test('horizontal top swipe cancels vertical dismiss tracking', () => {
  let swipe = startTopSwipe(100, 20);
  swipe = moveTopSwipe(swipe, 140, 24); // dx = 40 > dy = 4 while dragY === 0
  assert.equal(swipe.active, false);
  assert.equal(swipe.dragY, 0);
  assert.equal(endTopSwipe(swipe).shouldClose, false);
});

test('shouldCloseViewerOnKey closes only on unmodified Escape in watch mode outside IME', () => {
  assert.equal(shouldCloseViewerOnKey({ key: 'Escape' }, 'watch'), true);
  assert.equal(shouldCloseViewerOnKey({ key: 'Escape' }, 'control'), false);
  assert.equal(shouldCloseViewerOnKey({ key: 'Enter' }, 'watch'), false);
  assert.equal(shouldCloseViewerOnKey({ key: 'Escape', defaultPrevented: true }, 'watch'), false);
  assert.equal(shouldCloseViewerOnKey({ key: 'Escape', isComposing: true }, 'watch'), false);
  assert.equal(shouldCloseViewerOnKey({ key: 'Escape', keyCode: 229 }, 'watch'), false);
  assert.equal(shouldCloseViewerOnKey({ key: 'Escape', metaKey: true }, 'watch'), false);
  assert.equal(shouldCloseViewerOnKey({ key: 'Escape', ctrlKey: true }, 'watch'), false);
});

test('buildScreenSocketUrl chooses ws/wss and URI-encodes botId', () => {
  assert.equal(
    buildScreenSocketUrl('https:', 'studio.example.com', 'bot/a b', 'watch'),
    'wss://studio.example.com/api/bots/bot%2Fa%20b/screen?mode=watch',
  );
  assert.equal(
    buildScreenSocketUrl('http:', 'localhost:5173', 'bot-1', 'control'),
    'ws://localhost:5173/api/bots/bot-1/screen?mode=control',
  );
});

test('shouldClearWaking resets waking on running, transitional, or error states', () => {
  assert.equal(shouldClearWaking(null), false);
  assert.equal(shouldClearWaking({ status: 'suspended', error: null }), false);
  assert.equal(shouldClearWaking({ status: 'absent', error: null }), false);
  assert.equal(shouldClearWaking({ status: 'running', error: null }), true);
  assert.equal(shouldClearWaking({ status: 'creating', error: null }), true);
  assert.equal(shouldClearWaking({ status: 'starting', error: null }), true);
  assert.equal(shouldClearWaking({ status: 'resuming', error: null }), true);
  assert.equal(shouldClearWaking({ status: 'error', error: 'Boot failed' }), true);
  assert.equal(shouldClearWaking({ status: 'stopped', error: 'Quota exceeded' }), true);
});
