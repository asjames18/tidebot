// After npm run build: node --test tests/rate-limit-ip.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {clientIp} from '../server/dist/lib/rateLimit.js';

test('ignores spoofed X-Forwarded-For from a direct, untrusted peer', () => {
  assert.equal(clientIp('203.0.113.9', '1.2.3.4'), '203.0.113.9');
});
test('uses the proxy-appended (rightmost) entry behind a loopback proxy', () => {
  assert.equal(clientIp('127.0.0.1', '6.6.6.6, 198.51.100.7'), '198.51.100.7');
  assert.equal(clientIp('::ffff:127.0.0.1', '198.51.100.7'), '198.51.100.7');
});
test('falls back to the peer when no header is present', () => {
  assert.equal(clientIp('127.0.0.1', undefined), '127.0.0.1');
});
test('TRUST_PROXY lists extra proxy peers or *', () => {
  assert.equal(clientIp('172.18.0.1', '198.51.100.7', '172.18.0.1'), '198.51.100.7');
  assert.equal(clientIp('172.18.0.1', '198.51.100.7'), '172.18.0.1');
  assert.equal(clientIp('10.0.0.5', '198.51.100.7', '*'), '198.51.100.7');
});
test('direct callers cannot rotate spoofed headers to get fresh buckets', () => {
  const keys = new Set(['1.1.1.1', '2.2.2.2', '3.3.3.3, 4.4.4.4', '::1'].map((h) => clientIp('203.0.113.9', h)));
  assert.deepEqual([...keys], ['203.0.113.9']);
  const viaTrustList = new Set(['1.1.1.1', '2.2.2.2'].map((h) => clientIp('203.0.113.9', h, '172.18.0.1')));
  assert.deepEqual([...viaTrustList], ['203.0.113.9']);
});
test('multi-hop chain: single trusted hop yields the entry its proxy appended', () => {
  assert.equal(clientIp('127.0.0.1', '9.9.9.9, 198.51.100.7, 192.0.2.50'), '192.0.2.50');
});
test('empty or malformed header falls back to the peer', () => {
  for (const h of ['', ' ', ',', ', ,', 'not-an-ip', '1.2.3.4, garbage']) assert.equal(clientIp('127.0.0.1', h), '127.0.0.1');
});
