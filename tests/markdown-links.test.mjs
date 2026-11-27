import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { classifyMarkdownHref, Markdown } from '../web/src/components/Markdown.tsx';

test('agent Markdown distinguishes loopback and external links', () => {
  const render = (url) => renderToStaticMarkup(createElement(Markdown, { text: `[Open](${url})` }));
  for (const url of [
    'http://localhost',
    'http://localhost.:3000',
    'http://app.localhost:5173',
    'http://127.0.0.1',
    'http://127.0.0.2:8080',
    'http://0.0.0.0:8000',
    'http://[::1]:8787',
    'http://[::]:3000',
    'http://[::ffff:127.0.0.1]:8080',
    '//localhost:3000',
    '//127.0.0.1:8787',
  ]) {
    assert.match(render(url), /<span class="md-localhost"/, `expected loopback span for ${url}`);
    assert.doesNotMatch(render(url), /<a /, `expected no anchor for ${url}`);
  }
  assert.match(render('https://example.org'), /<a href="https:\/\/example.org" target="_blank" rel="noreferrer noopener"/);
});

test('agent Markdown renders preview/relative and native links cleanly and neutralizes blocked schemes', () => {
  const render = (url) => renderToStaticMarkup(createElement(Markdown, { text: `[Open](${url})` }));

  // Relative TideBot preview link stays a clickable link.
  assert.match(render('/api/preview/bot_1/index.html'), /<a href="\/api\/preview\/bot_1\/index\.html" target="_blank" rel="noreferrer noopener"/);

  // Native mailto/tel links omit target="_blank".
  const mail = render('mailto:hello@example.org');
  assert.match(mail, /<a href="mailto:hello@example\.org"/);
  assert.doesNotMatch(mail, /target="_blank"/);

  // Dangerous or sanitized-empty links render plain spans instead of broken <a href="">.
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi']) {
    assert.equal(classifyMarkdownHref(bad), 'blocked', bad);
    assert.doesNotMatch(render(bad), /<a /, `blocked scheme must not render anchor: ${bad}`);
  }
  assert.equal(classifyMarkdownHref(''), 'blocked');
  assert.equal(classifyMarkdownHref(undefined), 'blocked');
  assert.equal(classifyMarkdownHref('//cdn.example.org/file.js'), 'link');
});
