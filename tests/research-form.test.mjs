import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendResearchFile,
  buildResearchPayload,
  filterSelectableResearchFiles,
  isValidResearchFilePath,
  parseSourceLines,
} from '../web/src/lib/researchForm.ts';

test('parseSourceLines handles LF, CRLF, whitespace, and blank lines', () => {
  assert.deepEqual(parseSourceLines('  https://a.example \r\n\n  https://b.example\r\n  '), [
    'https://a.example',
    'https://b.example',
  ]);
  assert.deepEqual(parseSourceLines('   \r\n\t '), []);
});

test('isValidResearchFilePath and filterSelectableResearchFiles exclude dotfiles, directories, and unsafe paths', () => {
  assert.equal(isValidResearchFilePath('notes.md'), true);
  assert.equal(isValidResearchFilePath('sub/DATA.CSV'), true);
  assert.equal(isValidResearchFilePath('.hidden.json'), false);
  assert.equal(isValidResearchFilePath('dir/.secret.md'), false);
  assert.equal(isValidResearchFilePath('../escape.txt'), false);
  assert.equal(isValidResearchFilePath('bad:name.txt'), false);
  assert.equal(isValidResearchFilePath('bad\\path.md'), false);
  assert.equal(isValidResearchFilePath('image.png'), false);
  assert.equal(isValidResearchFilePath(`${'a'.repeat(238)}.md`), false); // 241 > 240

  const entries = [
    { name: 'report.md', isDir: false },
    { name: '.settings.json', isDir: false },
    { name: 'notes.txt', isDir: true },
    { name: 'summary.csv', isDir: false },
    { name: 'photo.png', isDir: false },
  ];
  assert.deepEqual(filterSelectableResearchFiles(entries), ['report.md', 'summary.csv']);
});

test('appendResearchFile deduplicates and ignores empty selections', () => {
  assert.equal(appendResearchFile('', 'notes.md'), 'notes.md');
  assert.equal(appendResearchFile('notes.md', '  '), 'notes.md');
  assert.equal(appendResearchFile('notes.md', 'notes.md'), 'notes.md');
  assert.equal(appendResearchFile('notes.md\n', 'data.csv'), 'notes.md\ndata.csv');
});

test('buildResearchPayload trims fields and enforces 1..8 total sources', () => {
  assert.equal(buildResearchPayload({ question: '   ', outline: 'Plan', links: 'https://a.example', files: '' }), null);
  assert.equal(buildResearchPayload({ question: 'Q', outline: '   ', links: 'https://a.example', files: '' }), null);
  assert.equal(buildResearchPayload({ question: 'Q', outline: 'Plan', links: '', files: '' }), null);

  const nineLinks = Array.from({ length: 9 }, (_, i) => `https://s${i}.example`).join('\n');
  assert.equal(buildResearchPayload({ question: 'Q', outline: 'Plan', links: nineLinks, files: '' }), null);

  const valid = buildResearchPayload({
    question: '  Compare Q3 metrics  ',
    outline: '  Summarize differences  ',
    links: 'https://a.example\r\nhttps://b.example',
    files: 'notes.md',
  });
  assert.deepEqual(valid, {
    question: 'Compare Q3 metrics',
    outline: 'Summarize differences',
    links: ['https://a.example', 'https://b.example'],
    files: ['notes.md'],
  });
});
