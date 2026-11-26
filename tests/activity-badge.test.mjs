import test from 'node:test';
import assert from 'node:assert/strict';
import { detailsBadge, pendingApprovalCount } from '../web/src/lib/activityBadge.ts';

const approval = (status) => ({
  seq: 1, updatedSeq: 1, botId: 'b1', generation: 1, kind: 'card', createdAt: 0,
  body: {
    type: 'card', card: 'approval', approvalId: 'a1', title: 'Run shell',
    detail: 'ls', tool: 'shell', args: {}, status,
  },
});

const messageRow = {
  seq: 2, updatedSeq: 1, botId: 'b1', generation: 1, kind: 'message', createdAt: 0,
  body: { type: 'message', role: 'assistant', text: 'hi' },
};

const idle = { rows: [], isRunning: false, awaitingApproval: false, waitingRun: false };

test('counts only pending approval cards', () => {
  assert.equal(pendingApprovalCount([]), 0);
  assert.equal(pendingApprovalCount([messageRow]), 0);
  assert.equal(pendingApprovalCount([approval('pending')]), 1);
  assert.equal(pendingApprovalCount([approval('allowed'), approval('denied'), approval('expired'), approval('always')]), 0);
  assert.equal(pendingApprovalCount([approval('pending'), approval('pending'), approval('allowed')]), 2);
});

test('no badge when nothing is active or waiting', () => {
  assert.equal(detailsBadge(idle), null);
  assert.equal(detailsBadge({ ...idle, rows: [approval('allowed')] }), null);
});

test('pending approvals win over a running turn', () => {
  const badge = detailsBadge({ ...idle, rows: [approval('pending'), approval('pending')], isRunning: true });
  assert.deepEqual(badge, { count: 2, label: '2 approvals waiting', urgent: true });
});

test('one pending approval uses the singular label', () => {
  assert.deepEqual(detailsBadge({ ...idle, rows: [approval('pending')] }), {
    count: 1, label: '1 approval waiting', urgent: true,
  });
});

test('a waiting run or live awaiting flag shows "Needs your input" with no count', () => {
  assert.deepEqual(detailsBadge({ ...idle, waitingRun: true }), {
    count: null, label: 'Needs your input', urgent: true,
  });
  assert.deepEqual(detailsBadge({ ...idle, awaitingApproval: true }), {
    count: null, label: 'Needs your input', urgent: true,
  });
});

test('a working turn shows a non-urgent badge', () => {
  assert.deepEqual(detailsBadge({ ...idle, isRunning: true }), {
    count: null, label: 'Working', urgent: false,
  });
});
