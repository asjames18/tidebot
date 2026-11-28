import test from 'node:test';
import assert from 'node:assert/strict';
import { MicCapture, PcmPlayer, base64ToPcm, micErrorMessage, pcmToBase64 } from '../web/src/voice/audio.ts';

function fakeStream() {
  let stopped = 0;
  const track = { enabled: true, stop() { stopped += 1; } };
  return {
    getAudioTracks: () => [track],
    getTracks: () => [track],
    get stopped() { return stopped; },
    track,
  };
}

test('pcmToBase64 and base64ToPcm round-trip subarrays, large chunks, and truncate trailing odd bytes', () => {
  const full = new Int16Array([-32768, -1, 0, 1, 12345, 32767]);
  const sub = full.subarray(1, 5);
  assert.deepEqual(base64ToPcm(pcmToBase64(sub)), sub);

  // Exceeds the 0x8000 byte chunk loop in pcmToBase64.
  const large = new Int16Array(20_000);
  for (let i = 0; i < large.length; i++) large[i] = ((i * 37) % 65536) - 32768;
  assert.deepEqual(base64ToPcm(pcmToBase64(large)), large);

  // Odd byte count (3 bytes) drops the incomplete trailing byte instead of throwing RangeError.
  const odd = base64ToPcm(btoa('\x01\x02\x03'));
  assert.equal(odd.length, 1);
  assert.equal(odd[0], 0x0201);
  assert.equal(base64ToPcm('').length, 0);
});

test('MicCapture.stop during pending addModule prevents node creation and retries after addModule failure', async () => {
  let resolveModule;
  let addCalls = 0;
  let sourceCreated = 0;
  const ctx = {
    audioWorklet: {
      addModule() {
        addCalls += 1;
        if (addCalls === 1) return Promise.reject(new Error('transient load failure'));
        return new Promise((r) => { resolveModule = r; });
      },
    },
    createMediaStreamSource() { sourceCreated += 1; return { connect() { return this; }, disconnect() {} }; },
    createGain() { return { gain: { value: 1 }, connect() { return this; }, disconnect() {} }; },
    destination: {},
  };

  // Failed addModule clears cache so a later retry can call addModule again.
  const s1 = fakeStream();
  const cap1 = new MicCapture(ctx, s1, () => {});
  await assert.rejects(() => cap1.start(), /transient load failure/);
  assert.equal(addCalls, 1);

  // Concurrent starts share a single addModule call; stopping before resolution skips node setup.
  const s2 = fakeStream();
  const s3 = fakeStream();
  const cap2 = new MicCapture(ctx, s2, () => {});
  const cap3 = new MicCapture(ctx, s3, () => {});
  const p2 = cap2.start();
  const p3 = cap3.start();
  assert.equal(addCalls, 2);
  cap2.stop();
  cap3.stop();
  resolveModule();
  await Promise.all([p2, p3]);
  assert.equal(sourceCreated, 0);
  assert.equal(s2.stopped, 1);
  assert.equal(s3.stopped, 1);
});

test('PcmPlayer ignores invalid sample rates, resolves whenIdle on clear and timeout, and cleans up waiters', async () => {
  const sources = [];
  const ctx = {
    state: 'running',
    currentTime: 10,
    resume: () => Promise.resolve(),
    createGain: () => ({ connect(target) { return target; }, disconnect() {} }),
    createAnalyser: () => ({ fftSize: 512, connect(target) { return target; }, disconnect() {}, getFloatTimeDomainData() {} }),
    createBuffer: (_ch, len, rate) => {
      const data = new Float32Array(len);
      return { duration: len / rate, getChannelData: () => data };
    },
    createBufferSource: () => {
      const src = { buffer: null, onended: null, stopped: false, connect() {}, start() {}, stop() { this.stopped = true; } };
      sources.push(src);
      return src;
    },
    destination: {},
  };

  const player = new PcmPlayer(ctx);
  let starts = 0;
  let idles = 0;
  player.onStart = () => { starts += 1; };
  player.onIdle = () => { idles += 1; };

  // Empty or invalid sample rates are ignored without creating sources.
  player.push(new Int16Array(0), 24000);
  player.push(new Int16Array([100]), 0);
  player.push(new Int16Array([100]), -1);
  player.push(new Int16Array([100]), Number.NaN);
  assert.equal(sources.length, 0);
  assert.equal(player.playing, false);

  // Push valid audio, test whenIdle timeout cleanup, then barge-in clear().
  player.push(new Int16Array([16384, -16384]), 24000);
  assert.equal(player.playing, true);
  assert.equal(starts, 1);
  await player.whenIdle(5);

  const idlePromise = player.whenIdle(5000);
  player.clear();
  await idlePromise;
  assert.equal(player.playing, false);
  assert.equal(idles, 1);
  assert.equal(sources[0].stopped, true);
});

test('micErrorMessage maps DOM errors and handles missing navigator safely', () => {
  assert.match(micErrorMessage({ name: 'NotAllowedError' }), /blocked/);
  assert.match(micErrorMessage({ name: 'NotFoundError' }), /No microphone/);
  assert.match(micErrorMessage({ name: 'NotReadableError' }), /another app/);
  assert.match(micErrorMessage(new Error('boom')), /HTTPS or localhost|boom/);
});
