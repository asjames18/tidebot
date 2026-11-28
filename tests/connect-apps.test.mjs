import test from 'node:test';
import assert from 'node:assert/strict';
import {
  categoryPillLabel,
  getMoreCategories,
  isPrimaryAppCategory,
  mergeConnectedToolkits,
  partitionConnectedSlugs,
  shouldBlurAppSearchOnEnter,
  titleCaseCategory,
} from '../web/src/lib/connectApps.ts';

function fakeToolkit(slug, overrides = {}) {
  return {
    slug,
    name: slug,
    description: '',
    categories: [],
    managedAuth: true,
    noAuth: false,
    connected: false,
    ...overrides,
  };
}

test('category helpers match primary pills case-insensitively and preserve acronyms', () => {
  assert.equal(isPrimaryAppCategory('Developer Tools'), true);
  assert.equal(categoryPillLabel('DEVELOPER TOOLS'), 'Code');
  assert.equal(titleCaseCategory('  ai  crm  ocr  tools '), 'AI CRM OCR Tools');
  assert.deepEqual(
    getMoreCategories(['Productivity', 'analytics', 'ANALYTICS', '  ', 'crm']),
    ['analytics', 'crm'],
  );
});

test('partitionConnectedSlugs reuses already-loaded apps and requests only missing slugs', () => {
  const loaded = [fakeToolkit('slack', { name: 'Slack', connected: false }), fakeToolkit('gmail')];
  const { resolved, missing } = partitionConnectedSlugs(['slack', 'github', 'slack', 'linear'], loaded);

  assert.deepEqual(missing, ['github', 'linear']);
  assert.equal(resolved.size, 1);
  assert.equal(resolved.get('slack')?.connected, true);
  assert.equal(resolved.get('slack')?.name, 'Slack');
});

test('mergeConnectedToolkits preserves order and synthesizes disconnectable fallbacks for unresolved slugs', () => {
  const resolved = new Map([
    ['slack', fakeToolkit('slack', { name: 'Slack', connected: true })],
  ]);
  const merged = mergeConnectedToolkits(['slack', 'legacy_crm_app'], resolved);

  assert.equal(merged.length, 2);
  assert.equal(merged[0].slug, 'slack');
  assert.equal(merged[0].connected, true);
  assert.equal(merged[1].slug, 'legacy_crm_app');
  assert.equal(merged[1].name, 'Legacy CRM App');
  assert.equal(merged[1].connected, true);
});

test('shouldBlurAppSearchOnEnter blurs only on mobile non-IME Enter', () => {
  assert.equal(shouldBlurAppSearchOnEnter({ key: 'Enter' }, 390), true);
  assert.equal(shouldBlurAppSearchOnEnter({ key: 'Enter' }, 1200), false);
  assert.equal(shouldBlurAppSearchOnEnter({ key: 'Enter', isComposing: true }, 390), false);
  assert.equal(shouldBlurAppSearchOnEnter({ key: 'Enter', keyCode: 229 }, 390), false);
  assert.equal(shouldBlurAppSearchOnEnter({ key: 'Escape' }, 390), false);
});
