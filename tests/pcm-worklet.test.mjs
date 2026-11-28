import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../web/public/pcm-worklet.js', import.meta.url), 'utf8');

function createWorklet(inputRate, options = { processorOptions: { rate: 24000 } }) {
  const frames = [];
  let ProcessorCtor;
  class AudioWorkletProcessor {
    constructor() {
      this.port = {
        postMessage(msg) {
          frames.push({ pcm: new Int16Array(msg.pcm), level: msg.level });
        },
      };
    }
  }
  const ctx = vm.createContext({
    AudioWorkletProcessor,
    sampleRate: inputRate,
    registerProcessor(name, ctor) {
      assert.equal(name, 'pcm16-capture');
      ProcessorCtor = ctor;
    },
  });
  vm.runInContext(source, ctx);
  const proc = new ProcessorCtor(options);
  return { proc, frames };
}

function feedOneSecond(proc, inputRate, sampleFn = () => 0.5) {
  const quantum = 128;
  let remaining = inputRate;
  let idx = 0;
  while (remaining > 0) {
    const len = Math.min(quantum, remaining);
    const ch = new Float32Array(len);
    for (let i = 0; i < len; i++) ch[i] = sampleFn(idx++);
    proc.process([[ch]]);
    remaining -= len;
  }
}

test('resamples 48 kHz, 44.1 kHz, 24 kHz, 16 kHz (Bluetooth HFP), and 8 kHz (SCO) to 24 kHz', () => {
  for (const inputRate of [48000, 44100, 24000, 16000, 8000]) {
    const { proc, frames } = createWorklet(inputRate);
    feedOneSecond(proc, inputRate, () => 0.5);
    const totalSamples = frames.reduce((sum, f) => sum + f.pcm.length, 0) + proc.n;
    assert.ok(
      Math.abs(totalSamples - 24000) <= 2,
      `inputRate=${inputRate} produced ${totalSamples} samples in 1s (expected ~24000)`,
    );
    assert.ok(proc.t < proc.ratio, `accumulator t=${proc.t} stayed bounded below ratio=${proc.ratio}`);
    for (const f of frames) {
      assert.equal(f.pcm.length, 960);
      assert.equal(f.pcm[0], Math.trunc(0.5 * 0x7fff));
    }
  }
});

test('handles NaN/out-of-range samples, missing inputs, and missing options safely', () => {
  const { proc, frames } = createWorklet(24000, undefined);
  assert.equal(proc.process([]), true);
  assert.equal(proc.process([[]]), true);

  const ch = new Float32Array(960);
  ch[0] = Number.NaN;
  ch[1] = Number.POSITIVE_INFINITY;
  ch[2] = 2.5;
  ch[3] = -2.5;
  proc.process([[ch]]);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].pcm[0], 0);
  assert.equal(frames[0].pcm[1], 0);
  assert.equal(frames[0].pcm[2], 0x7fff);
  assert.equal(frames[0].pcm[3], -0x8000);
});
