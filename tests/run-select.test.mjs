import test from 'node:test';
import assert from 'node:assert/strict';
import { pickInitialSelectedRun } from '../web/src/lib/runSelect.ts';

const run = (id, state) => ({
  id,
  source: 'chat',
  title: `run ${id}`,
  routineId: null,
  state,
  createdAt: 1,
  startedAt: 1,
  finishedAt: null,
  summary: null,
});

test('selects the waiting run when nothing is selected', () => {
  const runs = [run('a', 'completed'), run('b', 'waiting'), run('c', 'running')];
  assert.equal(pickInitialSelectedRun(runs, undefined), 'b');
});

test('stays on the list when no run is waiting', () => {
  const runs = [run('a', 'completed'), run('c', 'running')];
  assert.equal(pickInitialSelectedRun(runs, undefined), undefined);
});

test('stays on the list when a run is already selected', () => {
  const runs = [run('a', 'waiting')];
  assert.equal(pickInitialSelectedRun(runs, 'a'), undefined);
});

test('picks the first waiting run when several are waiting', () => {
  const runs = [run('a', 'waiting'), run('b', 'waiting')];
  assert.equal(pickInitialSelectedRun(runs, undefined), 'a');
});

test('stays on the list when there are no runs', () => {
  assert.equal(pickInitialSelectedRun([], undefined), undefined);
});
