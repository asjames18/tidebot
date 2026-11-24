import test from 'node:test';
import assert from 'node:assert/strict';
import { palette, BOT_COLORS } from '../web/src/lib/colors.ts';

test('only configured avatar colors override the default palette', () => {
  for (const name of [undefined, '', 'unknown', 'constructor', '__proto__', 'toString']) {
    assert.equal(palette(name), BOT_COLORS.black);
  }
  for (const [name, expected] of Object.entries(BOT_COLORS)) assert.equal(palette(name), expected);
});
