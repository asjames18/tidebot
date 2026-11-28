import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addRoomMemberIds,
  eligibleRoomCandidates,
  removeRoomMemberIds,
  RoomMembersGate,
} from '../web/src/lib/roomMembers.ts';

function fakeBot(id, kind = 'agent') {
  return { id, name: id, kind };
}

test('eligibleRoomCandidates returns empty while members are unloaded and excludes rooms and current members', () => {
  const bots = [fakeBot('a'), fakeBot('b'), fakeBot('c'), fakeBot('room-1', 'room')];
  assert.deepEqual(eligibleRoomCandidates(bots, null), []);
  assert.deepEqual(
    eligibleRoomCandidates(bots, [{ id: 'a' }, { id: 'b' }]).map((b) => b.id),
    ['c'],
  );
});

test('addRoomMemberIds refuses unloaded lists, empty ids, and duplicates', () => {
  assert.equal(addRoomMemberIds(null, 'c'), null);
  assert.equal(addRoomMemberIds([{ id: 'a' }, { id: 'b' }], ''), null);
  assert.equal(addRoomMemberIds([{ id: 'a' }, { id: 'b' }], 'a'), null);
  assert.deepEqual(addRoomMemberIds([{ id: 'a' }, { id: 'b' }], 'c'), ['a', 'b', 'c']);
});

test('removeRoomMemberIds enforces minimum two distinct members and handles unloaded/missing ids', () => {
  assert.equal(removeRoomMemberIds(null, 'a'), null);
  assert.equal(removeRoomMemberIds([{ id: 'a' }, { id: 'b' }], 'a'), null);
  assert.equal(removeRoomMemberIds([{ id: 'a' }, { id: 'b' }, { id: 'b' }], 'a'), null);
  assert.equal(removeRoomMemberIds([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'missing'), null);
  assert.deepEqual(
    removeRoomMemberIds([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'b'),
    ['a', 'c'],
  );
});

test('RoomMembersGate invalidates previous room loads and saves when switching rooms', () => {
  const gate = new RoomMembersGate();
  gate.selectRoom('room-a');
  const loadA = gate.beginLoad('room-a');
  const saveA = gate.beginSave('room-a');
  assert.ok(loadA && saveA);
  assert.equal(gate.isLoadCurrent(loadA), true);
  assert.equal(gate.isSaveCurrent(saveA), true);

  gate.selectRoom('room-b');
  assert.equal(gate.isLoadCurrent(loadA), false);
  assert.equal(gate.isSaveCurrent(saveA), false);
  assert.equal(gate.beginLoad('room-a'), null);
  assert.equal(gate.beginSave('room-a'), null);

  const loadB = gate.beginLoad('room-b');
  assert.ok(loadB);
  assert.equal(gate.isLoadCurrent(loadB), true);
});

test('RoomMembersGate supersedes earlier retries while keeping an active save current during its awaited reload', () => {
  const gate = new RoomMembersGate();
  gate.selectRoom('room-a');

  const firstLoad = gate.beginLoad('room-a');
  const retryLoad = gate.beginLoad('room-a');
  assert.ok(firstLoad && retryLoad);
  assert.equal(gate.isLoadCurrent(firstLoad), false);
  assert.equal(gate.isLoadCurrent(retryLoad), true);

  const save = gate.beginSave('room-a');
  assert.ok(save);
  const postSaveLoad = gate.beginLoad('room-a');
  assert.ok(postSaveLoad);
  assert.equal(gate.isSaveCurrent(save), true);
  assert.equal(gate.isLoadCurrent(postSaveLoad), true);

  // Unmount or room cleanup invalidates both.
  gate.invalidate();
  assert.equal(gate.isSaveCurrent(save), false);
  assert.equal(gate.isLoadCurrent(postSaveLoad), false);
});
