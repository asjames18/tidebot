import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeProjectReferences } from '../web/src/lib/projectReferences.ts';

function fakeFile(name, content, size = Buffer.byteLength(content)) {
  return { name, size, text: async () => content };
}

test('mergeProjectReferences appends valid files and trims filenames', async () => {
  const existing = [{ name: 'brief.md', text: 'Overview' }];
  const merged = await mergeProjectReferences(existing, [
    fakeFile('  notes.TXT ', 'Key findings'),
    fakeFile('data.json', '{"ok":true}'),
  ]);
  assert.deepEqual(merged, [
    { name: 'brief.md', text: 'Overview' },
    { name: 'notes.TXT', text: 'Key findings' },
    { name: 'data.json', text: '{"ok":true}' },
  ]);
});

test('mergeProjectReferences rejects >6 total files, unsupported extensions, unsafe names, and oversized/empty files', async () => {
  const five = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.md`, text: 'x' }));
  await assert.rejects(() => mergeProjectReferences(five, [fakeFile('a.md', '1'), fakeFile('b.md', '2')]), /up to six/);
  await assert.rejects(() => mergeProjectReferences([], [fakeFile('image.png', 'abc')]), /Markdown, text, CSV, or JSON/);
  await assert.rejects(() => mergeProjectReferences([], [fakeFile('../escape.md', 'abc')]), /Markdown, text, CSV, or JSON/);
  await assert.rejects(() => mergeProjectReferences([], [fakeFile('.secret.md', 'abc')]), /Markdown, text, CSV, or JSON/);
  await assert.rejects(() => mergeProjectReferences([], [fakeFile('big.md', 'x', 32_001)]), /up to 8,000/);
  await assert.rejects(() => mergeProjectReferences([], [fakeFile('empty.md', '   ')]), /between 1 and 8,000/);
  await assert.rejects(() => mergeProjectReferences([], [fakeFile('long.md', 'x'.repeat(8001))]), /between 1 and 8,000/);
});

test('mergeProjectReferences rejects case-insensitive duplicates across existing and incoming files', async () => {
  await assert.rejects(
    () => mergeProjectReferences([{ name: 'Brief.md', text: 'hi' }], [fakeFile('brief.md', 'hi')]),
    /already in this project/,
  );
  await assert.rejects(
    () => mergeProjectReferences([], [fakeFile('Notes.md', 'a'), fakeFile('notes.md', 'b')]),
    /already in this project/,
  );
});
