// Regression tests for RAK-38: screenshots from consecutive tool outputs must
// survive itemsToChatMessages. Runs against the compiled server:
// `npm run build -w server` first. Isolated from live data via DB_PATH;
// pure in-memory conversion, never touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-rak38-'));
process.env.DB_PATH = path.join(fixtures, 'test.db');
const { itemsToChatMessages } = await import('../server/dist/agent/llm.js');

const screenshotOut = (callId, url) => ({
  type: 'function_call_output',
  call_id: callId,
  output: [
    { type: 'input_text', text: 'Captured the screen.' },
    { type: 'input_image', image_url: url },
  ],
});

const textOut = (callId, text) => ({
  type: 'function_call_output',
  call_id: callId,
  output: text,
});

test('screenshot on the first of two consecutive tool outputs is kept', () => {
  const items = [
    { type: 'function_call', call_id: 'c1', name: 'screenshot', arguments: '{}' },
    screenshotOut('c1', 'data:image/png;base64,AAA'),
    textOut('c2', 'Clicked the button.'),
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] },
  ];
  const msgs = itemsToChatMessages('sys', items);
  const imageMsgs = msgs.filter(
    (m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'),
  );
  assert.equal(imageMsgs.length, 1, 'expected exactly one image message');
  assert.equal(imageMsgs[0].content[0].text, '[Screenshot from tool c1]');
  assert.equal(imageMsgs[0].content[1].image_url.url, 'data:image/png;base64,AAA');
  // The image message must come after the c1 tool output and before the c2 one.
  const idxToolC1 = msgs.findIndex((m) => m.role === 'tool' && m.tool_call_id === 'c1');
  const idxToolC2 = msgs.findIndex((m) => m.role === 'tool' && m.tool_call_id === 'c2');
  const idxImage = msgs.indexOf(imageMsgs[0]);
  assert.ok(idxToolC1 < idxImage && idxImage < idxToolC2, 'image message misplaced');
});

test('screenshot on the final tool output is still attached', () => {
  const items = [
    { type: 'function_call', call_id: 'c1', name: 'screenshot', arguments: '{}' },
    screenshotOut('c1', 'data:image/png;base64,BBB'),
  ];
  const msgs = itemsToChatMessages('sys', items);
  const imageMsgs = msgs.filter(
    (m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'),
  );
  assert.equal(imageMsgs.length, 1);
  assert.equal(imageMsgs[0].content[1].image_url.url, 'data:image/png;base64,BBB');
});

test('text-only tool outputs produce no image messages', () => {
  const items = [textOut('c1', 'ok'), textOut('c2', 'done')];
  const msgs = itemsToChatMessages('sys', items);
  for (const m of msgs) {
    if (m.role === 'user') {
      assert.equal(Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'), false);
    }
  }
  assert.equal(msgs.filter((m) => m.role === 'tool').length, 2);
});

test('repairHistory keeps interrupted parallel tool calls grouped as one assistant batch', async () => {
  const { repairHistory } = await import('../server/dist/agent/history.js');
  const items = [
    { role: 'user', content: 'check both files' },
    { type: 'function_call', call_id: 'c1', name: 'read_file', arguments: '{"path":"a.md"}' },
    { type: 'function_call', call_id: 'c2', name: 'read_file', arguments: '{"path":"b.md"}' },
    { role: 'user', content: 'try again' },
  ];

  const repaired = repairHistory(items);
  assert.deepEqual(
    repaired.map((it) => `${it.type ?? it.role}:${it.call_id ?? ''}`),
    ['user:', 'function_call:c1', 'function_call:c2', 'function_call_output:c1', 'function_call_output:c2', 'user:'],
  );

  // Downstream Chat Completions conversion keeps both calls in one assistant message.
  const msgs = itemsToChatMessages('sys', repaired);
  const assistantCalls = msgs.filter((m) => m.role === 'assistant' && Array.isArray(m.tool_calls));
  assert.equal(assistantCalls.length, 1);
  assert.deepEqual(assistantCalls[0].tool_calls.map((tc) => tc.id), ['c1', 'c2']);
  assert.deepEqual(msgs.filter((m) => m.role === 'tool').map((m) => m.tool_call_id), ['c1', 'c2']);
});

test('repairHistory preserves a trailing pending-approval call alongside sibling completed outputs', async () => {
  const { repairHistory } = await import('../server/dist/agent/history.js');
  const items = [
    { role: 'user', content: 'read and run' },
    { type: 'function_call', call_id: 'c1', name: 'read_file', arguments: '{}' },
    { type: 'function_call', call_id: 'c2', name: 'shell', arguments: '{}' },
    textOut('c1', 'file contents'),
  ];

  const kept = repairHistory(items, new Set(['c2']));
  assert.deepEqual(
    kept.map((it) => `${it.type ?? it.role}:${it.call_id ?? ''}`),
    ['user:', 'function_call:c1', 'function_call:c2', 'function_call_output:c1'],
    'pending call c2 should not be marked interrupted while still in trailing batch',
  );

  // Once a subsequent user message arrives, c2 is no longer trailing and must be repaired.
  const superseded = repairHistory([...items, { role: 'user', content: 'never mind' }], new Set(['c2']));
  assert.deepEqual(
    superseded.map((it) => `${it.type ?? it.role}:${it.call_id ?? ''}`),
    ['user:', 'function_call:c1', 'function_call:c2', 'function_call_output:c2', 'function_call_output:c1', 'user:'],
  );
});

test('repairHistory drops orphaned, out-of-order, duplicate outputs and nullish entries', async () => {
  const { repairHistory } = await import('../server/dist/agent/history.js');
  const items = [
    null,
    textOut('orphan', 'no matching call'),
    textOut('c1', 'arrived before call'),
    { type: 'function_call', call_id: 'c1', name: 'read_file', arguments: '{}' },
    { type: 'function_call', call_id: 'c2', name: 'read_file', arguments: '{}' },
    textOut('c2', 'first answer'),
    textOut('c2', 'duplicate answer'),
    undefined,
  ];

  const repaired = repairHistory(items);
  assert.deepEqual(
    repaired.map((it) => `${it.type ?? it.role}:${it.call_id ?? ''}:${it.output ?? ''}`.slice(0, 42)),
    [
      'function_call:c1:',
      'function_call:c2:',
      'function_call_output:c1:This tool call was',
      'function_call_output:c2:first answer',
    ],
  );
});

