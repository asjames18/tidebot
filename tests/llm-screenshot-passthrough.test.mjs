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
