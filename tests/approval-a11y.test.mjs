import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  approvalActionLabel,
  approvalOutcomeAnnouncement,
  formatApprovalToolName,
  shouldFocusApprovalOutcome,
} from '../web/src/lib/approvalA11y.ts';
import { ApprovalCard } from '../web/src/components/cards/Cards.tsx';

test('formatApprovalToolName humanizes tool slugs and falls back cleanly', () => {
  assert.equal(formatApprovalToolName('GMAIL_SEND_EMAIL', 'gmail'), 'Gmail send email');
  assert.equal(formatApprovalToolName('shell'), 'Shell');
  assert.equal(formatApprovalToolName('create_routine'), 'Create routine');
  assert.equal(formatApprovalToolName('   ', 'googlecalendar'), 'Google Calendar');
  assert.equal(formatApprovalToolName(''), 'this action');
});

test('approvalActionLabel starts with the visible label and names the tool', () => {
  const tool = 'Gmail send email';
  assert.equal(approvalActionLabel('deny', tool), "Don't allow Gmail send email");
  assert.equal(approvalActionLabel('always', tool), 'Always allow Gmail send email');
  assert.equal(approvalActionLabel('allow', tool), 'Allow once: Gmail send email');

  assert.equal(approvalActionLabel('deny', tool, 'deny'), 'Denying Gmail send email');
  assert.equal(approvalActionLabel('always', tool, 'always'), 'Saving always allow for Gmail send email');
  assert.equal(approvalActionLabel('allow', tool, 'allow'), 'Allowing Gmail send email');

  // Other buttons retain their normal accessible names while one action is in flight
  assert.equal(approvalActionLabel('deny', tool, 'allow'), "Don't allow Gmail send email");
});

test('approvalOutcomeAnnouncement pairs visible status text with tool context', () => {
  assert.deepEqual(approvalOutcomeAnnouncement('allowed', 'Shell'), {
    text: 'Allowed once',
    srSuffix: ' for Shell',
    announcement: 'Allowed once for Shell',
  });
  assert.deepEqual(approvalOutcomeAnnouncement('always', 'Gmail send email'), {
    text: 'Always allowed',
    srSuffix: ' for Gmail send email',
    announcement: 'Always allowed for Gmail send email',
  });
  assert.deepEqual(approvalOutcomeAnnouncement('denied', 'Shell'), {
    text: 'Not allowed',
    srSuffix: ' for Shell',
    announcement: 'Not allowed for Shell',
  });
  assert.deepEqual(approvalOutcomeAnnouncement('expired', 'Shell'), {
    text: 'Expired',
    srSuffix: ' for Shell',
    announcement: 'Expired for Shell',
  });
});

test('shouldFocusApprovalOutcome only moves focus on pending-to-resolved transitions from the card', () => {
  assert.equal(shouldFocusApprovalOutcome(true, false, true), true);
  assert.equal(shouldFocusApprovalOutcome(true, false, false), false);
  assert.equal(shouldFocusApprovalOutcome(false, false, true), false);
  assert.equal(shouldFocusApprovalOutcome(true, true, true), false);
  assert.equal(shouldFocusApprovalOutcome(false, true, true), false);
});

test('shouldFocusApprovalOutcome preserves focus that moved to another control', () => {
  assert.equal(shouldFocusApprovalOutcome(true, false, true, true), false);
});

test('pending ApprovalCard renders landmark, labeled action group, tool-specific button labels, and keyboard-scrollable details', () => {
  const html = renderToStaticMarkup(
    React.createElement(ApprovalCard, {
      body: {
        type: 'card',
        card: 'approval',
        approvalId: 'appr_1',
        title: 'Allow Quinn to send an email?',
        detail: '',
        tool: 'GMAIL_SEND_EMAIL',
        toolkit: 'gmail',
        args: { to: 'alex@example.com', api_key: 'secret-value' },
        status: 'pending',
      },
    }),
  );

  assert.match(html, /<section[^>]+class="card approval-card"[^>]+aria-labelledby="([^"]+)"/);
  const titleId = html.match(/aria-labelledby="([^"]+)"/)?.[1];
  assert.ok(titleId);
  assert.ok(html.includes(`id="${titleId}"`));
  assert.ok(html.includes('aria-hidden="true"'));
  assert.ok(html.includes('role="group"'));
  assert.ok(html.includes('aria-label="Approval actions for Gmail send email"'));
  assert.ok(html.includes('aria-label="Don&#x27;t allow Gmail send email"'));
  assert.ok(html.includes('aria-label="Always allow Gmail send email"'));
  assert.ok(html.includes('aria-label="Allow once: Gmail send email"'));
  assert.ok(html.includes('aria-label="View action details for Gmail send email"'));
  assert.ok(html.includes('<pre tabindex="0" role="region" aria-label="Action details for Gmail send email">'));
  assert.ok(!html.includes('secret-value'));
});

test('resolved ApprovalCard renders a focusable polite status region naming the outcome and tool', () => {
  const html = renderToStaticMarkup(
    React.createElement(ApprovalCard, {
      body: {
        type: 'card',
        card: 'approval',
        approvalId: 'appr_2',
        title: 'Allow Quinn to run a command?',
        detail: 'ls -la',
        tool: 'shell',
        args: {},
        status: 'allowed',
      },
    }),
  );

  assert.ok(html.includes('class="card approval-card is-resolved"'));
  assert.ok(html.includes('role="status"'));
  assert.ok(html.includes('aria-live="polite"'));
  assert.ok(html.includes('tabindex="-1"'));
  assert.ok(html.includes('<span>Allowed once</span><span class="sr-only"> for Shell</span>'));
  assert.ok(!html.includes('role="group"'));
});
