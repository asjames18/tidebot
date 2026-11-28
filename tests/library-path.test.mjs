import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RequestGate,
  isMarkdownFilename,
  joinLibraryPath,
  sanitizeLibraryFilename,
} from '../web/src/lib/libraryPath.ts';

test('sanitizeLibraryFilename cleans valid names and rejects empty, dot, traversal, and hidden names', () => {
  assert.equal(sanitizeLibraryFilename('notes.md'), 'notes.md');
  assert.equal(sanitizeLibraryFilename('  my report (v2).md  '), 'my_report__v2_.md');
  for (const bad of ['', '   ', '.', '..', '.env', '.hidden.md', '  ..  ']) {
    assert.equal(sanitizeLibraryFilename(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('joinLibraryPath joins nested paths cleanly', () => {
  assert.equal(joinLibraryPath('', 'notes.md'), 'notes.md');
  assert.equal(joinLibraryPath('reports/2026', 'summary.md'), 'reports/2026/summary.md');
});

test('isMarkdownFilename matches .md and .markdown case-insensitively', () => {
  assert.equal(isMarkdownFilename('README.md'), true);
  assert.equal(isMarkdownFilename('README.MD'), true);
  assert.equal(isMarkdownFilename('guide.Markdown'), true);
  assert.equal(isMarkdownFilename('notes.txt'), false);
  assert.equal(isMarkdownFilename('md'), false);
});

test('RequestGate invalidates superseded or cancelled requests', () => {
  const gate = new RequestGate();
  const r1 = gate.next();
  assert.equal(gate.isCurrent(r1), true);
  const r2 = gate.next();
  assert.equal(gate.isCurrent(r1), false);
  assert.equal(gate.isCurrent(r2), true);
  gate.invalidate();
  assert.equal(gate.isCurrent(r2), false);
});
