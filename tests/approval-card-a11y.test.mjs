// Run with: tsx --tsconfig web/tsconfig.json --test tests/approval-card-a11y.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApprovalCard } from '../web/src/components/cards/Cards.tsx';

const base = { card: 'approval', approvalId: 'a1', tool: 'send_email', title: 'Send email to Sam', args: {} };

test('approval card is a labelled group named by its title', () => {
  const html = renderToStaticMarkup(createElement(ApprovalCard, { body: { ...base, status: 'pending' } }));
  const id = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
  assert.ok(id, 'group has aria-labelledby');
  assert.match(html, /role="group"/);
  assert.ok(html.includes(`id="${id}">Send email to Sam`), 'labelledby points at the title');
});

test('Always allow button has an explicit accessible name that names the tool', () => {
  const html = renderToStaticMarkup(createElement(ApprovalCard, { body: { ...base, status: 'pending' } }));
  assert.match(html, /aria-label="Always allow this tool: [^"]+"/);
});

test('resolved outcome is announced as a status', () => {
  const html = renderToStaticMarkup(createElement(ApprovalCard, { body: { ...base, status: 'allowed' } }));
  assert.match(html, /role="status"/);
});
