// Regression tests for the approval firewall (docs/approval-policy.md).
// Pins policyFor decisions directly against the compiled server — no model
// key, no Composio key, no live calls. Run with `npm test` after `npm run build`.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-approval-'));
process.env.DB_PATH = path.join(fixtures, 'test.db');
process.env.ENV_PATH = path.join(fixtures, '.env');
const { db } = await import('../server/dist/db.js');
db.prepare("INSERT OR IGNORE INTO users(id,email,name,created_at) VALUES (?,?,?,?)")
  .run('approval-test-user', 'approval-test@example.test', 'Approval Test', Date.now());
after(() => {
  try { db.close(); } finally { fs.rmSync(fixtures, { recursive: true, force: true }); }
});
const { policyFor } = await import('../server/dist/agent/tools.js');
const { isReadOnlySlug } = await import('../server/dist/composio.js');

const USER = 'approval-test-user';

function setPolicy(tool, mode) {
  db.prepare('INSERT OR REPLACE INTO policies(user_id,tool,mode) VALUES (?,?,?)').run(USER, tool, mode);
}
function clearPolicies() {
  db.prepare('DELETE FROM policies WHERE user_id=?').run(USER);
}

test('gated built-ins ask by default', () => {
  for (const tool of ['shell', 'create_routine', 'create_event_routine']) {
    assert.equal(policyFor(USER, tool, {}).decision, 'ask', tool);
  }
});

test('read-only built-ins run without approval', () => {
  for (const tool of ['web_search', 'fetch_webpage', 'read_file', 'recall', 'list_routines']) {
    assert.equal(policyFor(USER, tool, {}).decision, 'allow', tool);
  }
});

test('ungated state-changing built-ins run without approval (documented in docs/approval-policy.md)', () => {
  // Pinned, not endorsed: update/delete routine and the computer tools are
  // state-changing but not in APPROVAL_GATED_BUILTINS. If the policy
  // changes, update the doc table in the same PR.
  for (const tool of ['update_routine', 'delete_routine', 'computer_click', 'save_file', 'create_task', 'spawn_subagent']) {
    assert.equal(policyFor(USER, tool, {}).decision, 'allow', tool);
  }
});

test('Composio discovery tools run without approval', () => {
  for (const tool of ['COMPOSIO_SEARCH_TOOLS', 'COMPOSIO_GET_TOOL_SCHEMAS']) {
    assert.equal(policyFor(USER, tool, {}).decision, 'allow', tool);
  }
});

test('read-only Composio slugs run, write slugs ask', () => {
  for (const slug of ['GMAIL_LIST_MESSAGES', 'GMAIL_SEARCH_MESSAGES', 'SLACK_LIST_CHANNELS', 'NOTION_SEARCH', 'GITHUB_GET_REPO']) {
    assert.equal(policyFor(USER, slug, {}).decision, 'allow', slug);
  }
  for (const slug of ['GMAIL_SEND_MESSAGE', 'SLACK_POST_MESSAGE', 'GITHUB_CREATE_ISSUE', 'NOTION_CREATE_PAGE', 'GOOGLECALENDAR_CREATE_EVENT']) {
    assert.equal(policyFor(USER, slug, {}).decision, 'ask', slug);
  }
});

test('multi-execute asks when any inner slug needs approval', () => {
  const readOnly = { tools: [{ tool_slug: 'GMAIL_LIST_MESSAGES' }, { tool_slug: 'SLACK_LIST_CHANNELS' }] };
  assert.equal(policyFor(USER, 'COMPOSIO_MULTI_EXECUTE_TOOL', readOnly).decision, 'allow');
  const mixed = { tools: [{ tool_slug: 'GMAIL_LIST_MESSAGES' }, { tool_slug: 'GMAIL_SEND_MESSAGE' }] };
  const mixedCall = policyFor(USER, 'COMPOSIO_MULTI_EXECUTE_TOOL', mixed);
  assert.equal(mixedCall.decision, 'ask');
  assert.equal(mixedCall.key, 'GMAIL_SEND_MESSAGE');
});

test('unknown Composio tool names fail closed to ask', () => {
  assert.equal(policyFor(USER, 'COMPOSIO_SOMETHING_NEW', {}).decision, 'ask');
});

test('per-tool policies override the default', () => {
  try {
    setPolicy('shell', 'always_allow');
    assert.equal(policyFor(USER, 'shell', {}).decision, 'allow');
    setPolicy('shell', 'blocked');
    assert.equal(policyFor(USER, 'shell', {}).decision, 'block');
    setPolicy('GMAIL_SEND_MESSAGE', 'always_allow');
    assert.equal(policyFor(USER, 'GMAIL_SEND_MESSAGE', {}).decision, 'allow');
    setPolicy('GMAIL_LIST_MESSAGES', 'needs_approval');
    assert.equal(policyFor(USER, 'GMAIL_LIST_MESSAGES', {}).decision, 'ask');
    setPolicy('GMAIL_LIST_MESSAGES', 'blocked');
    assert.equal(policyFor(USER, 'GMAIL_LIST_MESSAGES', {}).decision, 'block');
  } finally {
    clearPolicies();
  }
  assert.equal(policyFor(USER, 'shell', {}).decision, 'ask');
  assert.equal(policyFor(USER, 'GMAIL_LIST_MESSAGES', {}).decision, 'allow');
});

test('isReadOnlySlug is a name regex, not a capability check', () => {
  assert.equal(isReadOnlySlug('GMAIL_LIST_MESSAGES'), true);
  assert.equal(isReadOnlySlug('GITHUB_GET_REPO'), true);
  assert.equal(isReadOnlySlug('CALENDAR_CHECK_AVAILABILITY'), true);
  assert.equal(isReadOnlySlug('GMAIL_SEND_MESSAGE'), false);
  assert.equal(isReadOnlySlug('GITHUB_CREATE_ISSUE'), false);
  // Verbs outside the list read as write operations, even when read-only.
  assert.equal(isReadOnlySlug('DRIVE_DOWNLOAD_FILE'), false);
  // A slug that pairs a read verb with a write action is misread as read-only.
  // Documented limitation (docs/approval-policy.md finding 4), pinned here
  // so a future fix to the classifier shows up as a test change.
  assert.equal(isReadOnlySlug('GMAIL_GET_AND_DELETE_MESSAGE'), true);
});
