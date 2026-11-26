// After npm run build: node --test tests/rate-limit-ip.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {clientIp, defaultGateways} from '../server/dist/lib/rateLimit.js';

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
test('CDN plus local proxy: unlisted CDN edge is the conservative key', () => {
  assert.equal(clientIp('127.0.0.1', '9.9.9.9, 198.51.100.7, 192.0.2.50'), '192.0.2.50');
});
test('CDN plus local proxy: listing the CDN range (IP or CIDR) recovers the real client', () => {
  assert.equal(clientIp('127.0.0.1', '198.51.100.7, 192.0.2.50', '192.0.2.0/24'), '198.51.100.7');
  assert.equal(clientIp('127.0.0.1', '198.51.100.7, 192.0.2.50', '192.0.2.50'), '198.51.100.7');
  assert.equal(clientIp('127.0.0.1', '2001:db8::1, 2001:db8:ffff::5', '2001:db8:ffff::/48'), '2001:db8::1');
});
test('walk stops at the first untrusted address, so client-prepended entries are ignored', () => {
  assert.equal(clientIp('127.0.0.1', '6.6.6.6, 198.51.100.7, 192.0.2.50', '192.0.2.0/24'), '198.51.100.7');
  assert.equal(clientIp('127.0.0.1', '6.6.6.6, 5.5.5.5', '5.5.5.0/24'), '6.6.6.6');
});
test('malformed entry in the chain stops at the last trusted address', () => {
  assert.equal(clientIp('127.0.0.1', 'junk, 192.0.2.50', '192.0.2.0/24'), '192.0.2.50');
});
test('defaultGateways parses /proc/net/route and ignores non-default routes', () => {
  const route = 'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n' +
    'eth0\t00000000\t010012AC\t0003\t0\t0\t0\t00000000\t0\t0\t0\n' +
    'eth0\t000012AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0\n';
  assert.deepEqual(defaultGateways(route), ['172.18.0.1']);
  assert.deepEqual(defaultGateways(''), []);
});
test('* trusts every hop and uses the leftmost entry', () => {
  assert.equal(clientIp('10.0.0.5', '1.1.1.1, 2.2.2.2', '*'), '1.1.1.1');
});
test('invalid TRUST_PROXY entries are ignored, not trusted', () => {
  assert.equal(clientIp('172.18.0.1', '198.51.100.7', 'garbage,999.1.1.1/8'), '172.18.0.1');
});
test('empty or malformed header falls back to the peer', () => {
  for (const h of ['', ' ', ',', ', ,', 'not-an-ip', '1.2.3.4, garbage']) assert.equal(clientIp('127.0.0.1', h), '127.0.0.1');
});
