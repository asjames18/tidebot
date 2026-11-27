import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { rfbClientMsgLength, WatchFilter } from '../server/src/lib/vncFilter.ts';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidebot-vnc-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.ENV_PATH = path.join(tmpDir, '.env');
fs.writeFileSync(process.env.ENV_PATH, '');

const { isAllowedVncOrigin, sanitizeVncError, truncateWsCloseReason } = await import('../server/src/lib/vncSecurity.ts');
const { db } = await import('../server/src/db.ts');
const { attachVncRelay } = await import('../server/src/vnc.ts');

after(() => {
  try { db.close(); } catch { /* ignore */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

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

test('isAllowedVncOrigin blocks cross-origin, sibling-subdomain, localhost-port, and null origins', () => {
  const allowed = ['http://localhost:5173', 'https://tidebot.example.com'];

  assert.equal(isAllowedVncOrigin(undefined, '127.0.0.1:8787', allowed), true);
  assert.equal(isAllowedVncOrigin('http://localhost:5173', 'localhost:5173', allowed), true);
  assert.equal(isAllowedVncOrigin('http://127.0.0.1:8787', '127.0.0.1:8787', allowed), true);
  assert.equal(isAllowedVncOrigin('https://tidebot.example.com', '127.0.0.1:8787', allowed), true);

  // Cross-site, sibling subdomain, other localhost port, sandboxed iframe, non-HTTP schemes.
  assert.equal(isAllowedVncOrigin('https://evil.test', 'tidebot.example.com', allowed), false);
  assert.equal(isAllowedVncOrigin('https://evil.example.com', 'tidebot.example.com', allowed), false);
  assert.equal(isAllowedVncOrigin('http://localhost:3000', 'localhost:8787', allowed), false);
  assert.equal(isAllowedVncOrigin('null', '127.0.0.1:8787', allowed), false);
  assert.equal(isAllowedVncOrigin('file:///tmp/index.html', '127.0.0.1:8787', allowed), false);
  assert.equal(isAllowedVncOrigin('not-a-url', '127.0.0.1:8787', allowed), false);
});

test('sanitizeVncError redacts VNC passwords (including short RFB passwords) and token query params', () => {
  const shortPw = 'p@ss+1';
  const err = new Error(`Unexpected server response: 502 for wss://www.orgo.ai/desktops/c1/ws/websockify?token=${encodeURIComponent(shortPw)}&screen=s1 (pw=${shortPw})`);
  const sanitized = sanitizeVncError(err, shortPw);
  assert.ok(!sanitized.includes(shortPw), 'raw VNC password must not leak');
  assert.ok(!sanitized.includes(encodeURIComponent(shortPw)), 'encoded VNC password must not leak');
  assert.match(sanitized, /\?token=\[redacted\]&screen=s1/);
});

test('truncateWsCloseReason caps multi-byte UTF-8 strings within RFC 6455 byte limit', () => {
  const emojiReason = '🚫'.repeat(50); // 200 UTF-8 bytes
  const out = truncateWsCloseReason(emojiReason, 120);
  assert.ok(Buffer.byteLength(out, 'utf8') <= 120);
  assert.equal(out, '🚫'.repeat(30));
});

function rawUpgrade(port, reqPath, headers) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      const lines = [
        `GET ${reqPath} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        'Sec-WebSocket-Version: 13',
        ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
        '',
        '',
      ];
      sock.write(lines.join('\r\n'));
    });
    let data = '';
    sock.on('data', (chunk) => { data += chunk.toString('utf8'); });
    sock.on('end', () => resolve(data.split('\r\n')[0] ?? ''));
    sock.on('error', reject);
  });
}

test('attachVncRelay rejects cross-origin WebSocket upgrades with 403 before auth', async (t) => {
  const server = http.createServer();
  attachVncRelay(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const crossOrigin = await rawUpgrade(port, '/api/bots/bot-1/screen?mode=control', { Origin: 'http://localhost:3000' });
  assert.equal(crossOrigin, 'HTTP/1.1 403 Forbidden');

  const nullOrigin = await rawUpgrade(port, '/api/bots/bot-1/screen?mode=control', { Origin: 'null' });
  assert.equal(nullOrigin, 'HTTP/1.1 403 Forbidden');

  const sameOriginNoAuth = await rawUpgrade(port, '/api/bots/bot-1/screen?mode=control', { Origin: `http://127.0.0.1:${port}` });
  assert.equal(sameOriginNoAuth, 'HTTP/1.1 401 Unauthorized');
});
