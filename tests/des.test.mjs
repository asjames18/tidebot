import test from 'node:test';
import assert from 'node:assert/strict';
import { desSelfTest, vncAuthResponse } from '../server/dist/lib/des.js';

test('desSelfTest passes the FIPS 81 known-answer vector', () => {
  assert.equal(desSelfTest(), true);
});

test('vncAuthResponse bit-reverses the key and matches the FIPS 81 DES-ECB vector on both blocks', () => {
  // Bit-reversal of FIPS 81 DES key 133457799bbcdff1 -> c82cea9ed93dfb8f.
  const password = Buffer.from('c82cea9ed93dfb8f', 'hex').toString('latin1');
  const challenge = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
  const copy = Buffer.from(challenge);

  const response = vncAuthResponse(password, challenge);
  assert.equal(response.length, 16);
  assert.equal(response.toString('hex'), '85e813540f0ab40585e813540f0ab405');
  assert.deepEqual(challenge, copy, 'challenge buffer must not be mutated');
});

test('vncAuthResponse enforces RFC 6143 8-byte password padding/truncation and block independence', () => {
  const challenge = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  assert.deepEqual(
    vncAuthResponse('12345678EXTRA', challenge),
    vncAuthResponse('12345678', challenge),
  );
  assert.deepEqual(
    vncAuthResponse('abc', challenge),
    vncAuthResponse('abc\0\0\0\0\0', challenge),
  );
  assert.equal(vncAuthResponse('', challenge).length, 16);

  // Changing only the second 8-byte half leaves the first 8-byte ECB output identical.
  const challenge2 = Buffer.from('00112233445566770000000000000000', 'hex');
  const r1 = vncAuthResponse('secret', challenge);
  const r2 = vncAuthResponse('secret', challenge2);
  assert.deepEqual(r1.subarray(0, 8), r2.subarray(0, 8));
  assert.notDeepEqual(r1.subarray(8, 16), r2.subarray(8, 16));
});

test('vncAuthResponse rejects challenges that are not exactly 16 bytes', () => {
  for (const len of [0, 7, 8, 15, 17, 32]) {
    assert.throws(
      () => vncAuthResponse('secret', new Uint8Array(len)),
      RangeError,
      `expected RangeError for challenge length ${len}`,
    );
  }
});
