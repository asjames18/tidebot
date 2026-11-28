// Gallery validation (Phase 4.2, issue #48): every templates/*.json must match
// the BotTemplate shape in web/src/components/modals/CreateBotModal.tsx —
// same fields, same length limits (label 60, description 500, instructions
// 8000), same shape/color/mode vocabularies — so a gallery file can be
// pasted into the modal's template list without edits.
// Shape list: PICKER_SHAPES in web/src/avatar/BotAvatar.tsx.
// Color list: COLOR_ORDER in web/src/lib/colors.ts.
// Mode: Bot['mode'] in server/src/types.ts ('personal' | 'teammate').
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES_DIR = join(ROOT, 'templates');

const SHAPES = new Set([
  'blob', 'cloud', 'square', 'sparkle', 'clover', 'heart', 'flower',
  'teardrop', 'tablet', 'wedge', 'house', 'star', 'hex',
]);
const COLORS = new Set([
  'black', 'brown', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue',
  'violet', 'magenta', 'gray',
]);
const MODES = new Set(['personal', 'teammate']);
// Exactly the BotTemplate fields — no extras, no omissions.
const FIELDS = ['id', 'title', 'name', 'label', 'description', 'instructions', 'shape', 'color', 'mode'];

function loadTemplates() {
  const files = readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.json')).sort();
  return files.map((file) => ({ file, data: JSON.parse(readFileSync(join(TEMPLATES_DIR, file), 'utf8')) }));
}

test('gallery has at least one template', () => {
  assert.ok(loadTemplates().length >= 1, 'templates/ must contain at least one .json file');
});

test('every template matches the BotTemplate shape', () => {
  for (const { file, data } of loadTemplates()) {
    assert.deepEqual(Object.keys(data).sort(), [...FIELDS].sort(), `${file}: fields must be exactly the BotTemplate set`);
    for (const field of ['id', 'title', 'name', 'label', 'description', 'instructions']) {
      assert.equal(typeof data[field], 'string', `${file}: ${field} must be a string`);
      assert.ok(data[field].trim().length > 0, `${file}: ${field} must not be empty`);
    }
    assert.ok(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(data.id), `${file}: id must be kebab-case`);
    assert.equal(file, `${data.id}.json`, `${file}: filename must match the template id`);
    assert.ok(data.label.length <= 60, `${file}: label exceeds the modal's 60-char limit`);
    assert.ok(data.description.length <= 500, `${file}: description exceeds the modal's 500-char limit`);
    assert.ok(data.instructions.length <= 8000, `${file}: instructions exceed the modal's 8000-char limit`);
    assert.ok(SHAPES.has(data.shape), `${file}: unknown shape ${data.shape}`);
    assert.ok(COLORS.has(data.color), `${file}: unknown color ${data.color}`);
    assert.ok(MODES.has(data.mode), `${file}: unknown mode ${data.mode}`);
  }
});

test('template ids are unique', () => {
  const ids = loadTemplates().map(({ data }) => data.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate template ids: ${ids.join(', ')}`);
});
