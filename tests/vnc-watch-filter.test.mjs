import test from 'node:test';
import assert from 'node:assert/strict';
import { rfbClientMsgLength, WatchFilter } from '../server/src/lib/vncFilter.ts';

const cut = (text, extended = false) => {
  const head = Buffer.alloc(8);
  head[0] = 6;
  head.writeInt32BE(extended ? -text.length : text.length, 4);
  const body = Buffer.from(text);
  if (!extended) return Buffer.concat([head, body]);
  const pad = Buffer.alloc(4);
  return Buffer.concat([head, pad, body]); // extended form: 4 reserved bytes before text
};

const fbRequest = () => {
  const m = Buffer.alloc(10);
  m[0] = 3;
  return m; // FramebufferUpdateRequest
};

test('watch filter drops input events and forwards requests', () => {
  const f = new WatchFilter();
  const key = Buffer.alloc(8); key[0] = 4;
  const ptr = Buffer.alloc(6); ptr[0] = 5;
  const out = f.feed(Buffer.concat([key, fbRequest(), ptr]));
  assert.equal(out.length, 10);
  assert.equal(out[0], 3);
});

test('classic ClientCutText is framed by 8 + text length', () => {
  const msg = cut('hello');
  assert.equal(rfbClientMsgLength(msg), 8 + 5);
  const f = new WatchFilter();
  const out = f.feed(Buffer.concat([msg, fbRequest()]));
  assert.equal(out.length, 10, 'only the framebuffer request is forwarded');
});

test('extended ClientCutText keeps the stream aligned for later messages', () => {
  const f = new WatchFilter();
  const stream = Buffer.concat([cut('clip', true), fbRequest()]);
  const out = f.feed(stream);
  assert.equal(rfbClientMsgLength(cut('clip', true)), 12 + 4);
  assert.equal(out.length, 10, 'the framebuffer request after an extended cut text must survive intact');
  assert.equal(out[0], 3);
});
