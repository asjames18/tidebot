import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// RAK-31: tool copy must not promise cross-device preview access.
// Preview URLs sit behind the session guard, so they open only for
// sessions signed in to this TideBot instance.
const toolsSource = readFileSync(new URL('../server/src/agent/tools.ts', import.meta.url), 'utf8');
const promptSource = readFileSync(new URL('../server/src/agent/prompt.ts', import.meta.url), 'utf8');

test('tool descriptions do not promise cross-device preview access', () => {
  for (const [file, source] of [['tools.ts', toolsSource], ['prompt.ts', promptSource]]) {
    assert.doesNotMatch(source, /any device/i, `${file} promises access from any device`);
    assert.doesNotMatch(source, /including their phone/i, `${file} promises phone access`);
  }
});

test('publish_preview states the preview opens for signed-in sessions only', () => {
  assert.match(toolsSource, /signed in to this TideBot instance/i);
});
