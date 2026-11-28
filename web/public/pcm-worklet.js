// Mic capture worklet: runs at the context's native rate (e.g. 48 kHz or 16 kHz HFP),
// resamples to 24 kHz, converts to Int16 and posts 40 ms frames plus a level for the UI.
class Pcm16Capture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const rate = options && options.processorOptions && options.processorOptions.rate;
    this.target = Number.isFinite(rate) && rate > 0 ? rate : 24000;
    const inputRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : this.target;
    this.ratio = inputRate / this.target;
    this.frame = new Int16Array(Math.max(1, Math.round(this.target * 0.04)));
    this.n = 0; this.sum = 0; this.cnt = 0; this.t = 0; this.peak = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const raw = ch[i];
      const s = Number.isFinite(raw) ? raw : 0;
      this.sum += s; this.cnt++; this.t += 1;
      const a = s < 0 ? -s : s; if (a > this.peak) this.peak = a;
      if (this.t >= this.ratio) {
        let v = this.sum / this.cnt; this.sum = 0; this.cnt = 0;
        v = v > 1 ? 1 : v < -1 ? -1 : v;
        const sample = v < 0 ? v * 0x8000 : v * 0x7fff;
        while (this.t >= this.ratio) {
          this.t -= this.ratio;
          this.frame[this.n++] = sample;
          if (this.n === this.frame.length) {
            const out = this.frame.slice(0);
            this.port.postMessage({ pcm: out.buffer, level: this.peak }, [out.buffer]);
            this.n = 0; this.peak = 0;
          }
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm16-capture', Pcm16Capture);
