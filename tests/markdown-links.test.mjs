import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../web/src/components/Markdown.tsx';

test('agent Markdown distinguishes loopback and external links', () => {
  const render = url => renderToStaticMarkup(createElement(Markdown, { text: `[Open](${url})` }));
  for (const url of ['http://localhost', 'http://127.0.0.1', 'http://[::1]:8787']) {
    assert.match(render(url), /<span class="md-localhost"/);
    assert.doesNotMatch(render(url), /<a /);
  }
  assert.match(render('https://example.org'), /<a href="https:\/\/example.org"/);
});
