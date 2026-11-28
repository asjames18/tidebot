import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountDisplayName,
  endDrawerSwipe,
  IDLE_DRAWER_SWIPE,
  moveDrawerSwipe,
  partitionSidebarBots,
  sidebarPreviewText,
  startDrawerSwipe,
  userInitials,
} from '../web/src/lib/sidebar.ts';

test('userInitials preserves emoji and astral code points without splitting surrogates', () => {
  assert.equal(userInitials('Ada Lovelace'), 'AL');
  assert.equal(userInitials('  single  '), 'S');
  assert.equal(userInitials('   '), '?');
  assert.equal(userInitials('🚀 Rocket'), '🚀R');
  assert.equal(userInitials('🦊'), '🦊');
});

test('accountDisplayName falls back to trimmed email when name is blank', () => {
  assert.equal(accountDisplayName({ name: '  ', email: 'ada@example.com' }), 'ada@example.com');
  assert.equal(accountDisplayName({ name: 'Ada', email: 'ada@example.com' }), 'Ada');
  assert.equal(accountDisplayName(null), '');
});

test('sidebarPreviewText trims blank awaiting/preview strings cleanly', () => {
  assert.equal(sidebarPreviewText({ lastPreview: 'Hi' }, false, '  Approve shell  '), 'Waiting for you: Approve shell');
  assert.equal(sidebarPreviewText({ lastPreview: '   ' }, true, '   '), 'Working…');
  assert.equal(sidebarPreviewText({ lastPreview: '   ' }, false, null), 'No messages yet');
  assert.equal(sidebarPreviewText({ lastPreview: '  Done  ' }, true, null), 'Done');
});

test('partitionSidebarBots separates primary and sorts others deterministically with non-finite timestamps', () => {
  const bots = [
    { id: 'old', isPrimary: false, lastActivityAt: 100 },
    { id: 'nan', isPrimary: false, lastActivityAt: Number.NaN },
    { id: 'primary', isPrimary: true, lastActivityAt: 50 },
    { id: 'new', isPrimary: false, lastActivityAt: 500 },
  ];
  const { primary, others } = partitionSidebarBots(bots);
  assert.equal(primary?.id, 'primary');
  assert.deepEqual(others.map((b) => b.id), ['new', 'old', 'nan']);
});

test('drawer swipe locks horizontal left drag, ignores vertical scroll, and handles missing endClientX', () => {
  // Vertical scroll locks 'y' and never closes.
  let v = startDrawerSwipe(200, 100);
  let res = moveDrawerSwipe(v, 195, 130);
  assert.equal(res.lockedHorizontalNow, false);
  assert.equal(res.next.locked, 'y');
  assert.equal(res.next.dragX, 0);
  assert.equal(endDrawerSwipe(res.next, 100).shouldClose, false);

  // Left swipe locks 'x' and closes past -56px, even when endClientX is omitted.
  let h = startDrawerSwipe(200, 100);
  res = moveDrawerSwipe(h, 170, 102);
  assert.equal(res.lockedHorizontalNow, true);
  assert.equal(res.next.locked, 'x');
  assert.equal(res.next.dragX, -30);

  res = moveDrawerSwipe(res.next, 120, 104);
  assert.equal(res.lockedHorizontalNow, false);
  assert.equal(res.next.dragX, -80);

  const fallbackEnd = endDrawerSwipe(res.next, undefined);
  assert.equal(fallbackEnd.shouldClose, true);
  assert.deepEqual(fallbackEnd.next, IDLE_DRAWER_SWIPE);

  // Pulling back right before lifting cancels close.
  const cancelled = endDrawerSwipe(res.next, 180);
  assert.equal(cancelled.shouldClose, false);
});
