import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCreateGroupPayload,
  eligibleGroupBots,
  isAllEligiblePicked,
  reconcilePickedBotIds,
  shouldBlurNameOnEnter,
  togglePickedBotId,
} from '../web/src/lib/groupCreate.ts';

test('eligibleGroupBots excludes existing rooms', () => {
  const bots = [
    { id: 'a', kind: 'agent' },
    { id: 'r1', kind: 'room' },
    { id: 'b', kind: undefined },
  ];
  assert.deepEqual(eligibleGroupBots(bots).map((b) => b.id), ['a', 'b']);
});

test('reconcilePickedBotIds drops deleted or ineligible bots and deduplicates', () => {
  const eligible = [{ id: 'a' }, { id: 'c' }];
  // 'b' was deleted from the roster while the modal was open.
  assert.deepEqual(reconcilePickedBotIds(['a', 'b', 'a', 'c'], eligible), ['a', 'c']);
  assert.equal(isAllEligiblePicked(['a', 'b'], eligible), false);
  assert.equal(isAllEligiblePicked(['a', 'c'], eligible), true);
  assert.equal(isAllEligiblePicked([], []), false);
});

test('togglePickedBotId reconciles stale ids while toggling valid operators', () => {
  const eligible = [{ id: 'a' }, { id: 'c' }];
  assert.deepEqual(togglePickedBotId(['a', 'deleted'], 'c', eligible), ['a', 'c']);
  assert.deepEqual(togglePickedBotId(['a', 'c'], 'a', eligible), ['c']);
  assert.deepEqual(togglePickedBotId(['a'], 'nonexistent', eligible), ['a']);
});

test('buildCreateGroupPayload requires a non-blank name and at least 2 currently eligible operators', () => {
  const eligible = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(buildCreateGroupPayload('   ', ['a', 'b'], eligible), null);
  assert.equal(buildCreateGroupPayload('War Room', ['a', 'deleted'], eligible), null);
  assert.deepEqual(
    buildCreateGroupPayload('  Launch Team  ', ['a', 'deleted', 'b', 'a'], eligible),
    { name: 'Launch Team', botIds: ['a', 'b'] },
  );
});

test('shouldBlurNameOnEnter blurs only on mobile non-IME Enter when fewer than 2 operators are picked', () => {
  assert.equal(shouldBlurNameOnEnter({ key: 'Enter' }, 390, 1), true);
  assert.equal(shouldBlurNameOnEnter({ key: 'Enter' }, 390, 2), false);
  assert.equal(shouldBlurNameOnEnter({ key: 'Enter' }, 1200, 0), false);
  assert.equal(shouldBlurNameOnEnter({ key: 'Enter', isComposing: true }, 390, 0), false);
  assert.equal(shouldBlurNameOnEnter({ key: 'Enter', keyCode: 229 }, 390, 0), false);
  assert.equal(shouldBlurNameOnEnter({ key: 'Tab' }, 390, 0), false);
});
