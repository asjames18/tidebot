import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTranscriptItems, cornerClass, formatSpeechText } from '../web/src/lib/transcriptItems.ts';

function msg(seq, createdAt, role, text, extra = {}) {
  return {
    botId: 'b1',
    generation: 1,
    seq,
    updatedSeq: seq,
    kind: 'message',
    createdAt,
    body: { type: 'message', role, text, ...extra },
  };
}

test('buildTranscriptItems skips empty non-streaming messages without emitting orphan date dividers', () => {
  const t0 = 1_700_000_000_000;
  const rows = [
    msg(1, t0, 'assistant', ''),
    msg(2, t0 + 2 * 60 * 60 * 1000, 'user', 'Hello'),
    msg(3, t0 + 5 * 60 * 60 * 1000, 'assistant', ''),
  ];
  const items = buildTranscriptItems(rows);
  assert.deepEqual(
    items.map((it) => it.kind),
    ['divider', 'group'],
  );
  assert.equal(items[0].ts, t0 + 2 * 60 * 60 * 1000);
});

test('buildTranscriptItems preserves non-streaming reasoning-only messages and groups adjacent messages', () => {
  const t0 = 1_700_000_000_000;
  const rows = [
    msg(1, t0, 'assistant', '', { reasoning: 'Checked all files.' }),
    msg(2, t0 + 10_000, 'assistant', 'Done.'),
    msg(3, t0 + 10 * 60 * 1000, 'assistant', 'Later follow-up.'),
  ];
  const items = buildTranscriptItems(rows);
  assert.deepEqual(items.map((it) => it.kind), ['divider', 'group', 'group']);
  assert.equal(items[1].rows.length, 2);
  assert.equal(items[2].rows.length, 1);
});

test('cornerClass returns first/mid/last classes for multi-message groups only', () => {
  assert.equal(cornerClass(0, 1), '');
  assert.equal(cornerClass(0, 3), ' is-first');
  assert.equal(cornerClass(1, 3), ' is-mid');
  assert.equal(cornerClass(2, 3), ' is-last');
});

test('formatSpeechText strips Markdown link URLs, replaces code fences, and avoids splitting surrogate pairs', () => {
  assert.equal(
    formatSpeechText('See [the docs](https://example.com/a?b=1) and ```js\nconst x = 1;\n``` now.'),
    'See the docs and code block now.',
  );
  assert.equal(formatSpeechText('![diagram](https://example.com/img.png)'), 'diagram');

  const truncated = formatSpeechText('a'.repeat(1199) + '😀tail', 1200);
  assert.equal(truncated, 'a'.repeat(1199));
  assert.equal(truncated.isWellFormed(), true);
});
