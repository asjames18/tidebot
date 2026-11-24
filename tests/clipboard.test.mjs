import test from 'node:test';
import assert from 'node:assert/strict';
import { copyText } from '../web/src/lib/clipboard.ts';

test('failed clipboard fallback removes the temporary text field', async (t) => {
  const children = new Set();
  const field = { style: {}, setAttribute() {}, focus() {}, select() {}, setSelectionRange() {}, remove() { children.delete(this); } };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  globalThis.document = { createElement: () => field, body: { appendChild(el) { children.add(el); } }, execCommand() { throw Error('copy unavailable'); } };
  assert.equal(await copyText('test text'), false);
  assert.equal(field.value, 'test text');
  assert.equal(children.size, 0);
});

for (const allowed of [true, false]) test(`fallback copy restores focus (allowed=${allowed})`, async (t) => {
  const button = { isConnected: true, focus() { doc.activeElement = this; } };
  const field = { style: {}, setAttribute() {}, focus() { doc.activeElement = this; }, select() {}, setSelectionRange() {}, remove() { doc.activeElement = null; } };
  const doc = { activeElement: button, createElement: () => field, body: { appendChild() {} }, execCommand: () => allowed };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  globalThis.document = doc;
  assert.equal(await copyText('sample'), allowed);
  assert.equal(doc.activeElement, button);
});
