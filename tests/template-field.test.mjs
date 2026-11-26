import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTemplateField } from '../web/src/lib/templateField.ts';

test('template switch overwrites a field the user has not edited', () => {
  assert.equal(nextTemplateField('Research Analyst', 'Research Analyst', 'Executive Assistant'), 'Executive Assistant');
  assert.equal(nextTemplateField('', undefined, 'Executive Assistant'), 'Executive Assistant');
  assert.equal(nextTemplateField('   ', 'Research Analyst', 'Executive Assistant'), 'Executive Assistant');
});

test('template switch preserves a user-edited field', () => {
  assert.equal(nextTemplateField('My custom label', 'Research Analyst', 'Executive Assistant'), 'My custom label');
  assert.equal(nextTemplateField('My custom label', undefined, 'Executive Assistant'), 'My custom label');
});

test('blank template description round-trips through its empty applied value', () => {
  // Blank applies '' for description; switching away then fills the new template's text.
  assert.equal(nextTemplateField('', '', 'Deep-dives topics.'), 'Deep-dives topics.');
  assert.equal(nextTemplateField('My notes', '', 'Deep-dives topics.'), 'My notes');
});
