// Mic capture worklet: runs at the context's native rate (usually 48 kHz), box-filters down to
// 24 kHz, converts to Int16 and posts 40 ms frames plus a level for the UI.
class Pcm16Capture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.target = (options.processorOptions && options.processorOptions.rate) || 24000;
    this.ratio = sampleRate / this.target;
    this.frame = new Int16Array(Math.round(this.target * 0.04));
    this.n = 0; this.sum = 0; this.cnt = 0; this.t = 0; this.peak = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = ch[i];
      this.sum += s; this.cnt++; this.t += 1;
      const a = s < 0 ? -s : s; if (a > this.peak) this.peak = a;
      if (this.t >= this.ratio) {
        this.t -= this.ratio;
        let v = this.sum / this.cnt; this.sum = 0; this.cnt = 0;
        v = v > 1 ? 1 : v < -1 ? -1 : v;
        this.frame[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        if (this.n === this.frame.length) {
          const out = this.frame.slice(0);
          this.port.postMessage({ pcm: out.buffer, level: this.peak }, [out.buffer]);
          this.n = 0; this.peak = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm16-capture', Pcm16Capture);
