/* Raw mono blocks only. Resampling and transmission are controlled by Studio. */
class StudioVoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.frames = new Float32Array(2048); this.offset = 0; this.active = false; this.captureId = 0;
    this.port.onmessage = event => {
      const { active, captureId, flush } = event.data || {};
      if (!Number.isSafeInteger(captureId) || captureId < this.captureId) return;
      if (active === true) {
        // A repeated or late Start cannot reset/reopen a turn already finished.
        if (captureId <= this.captureId) return;
        this.active = true; this.captureId = captureId; this.offset = 0;
      } else if (active === false) {
        if (captureId > this.captureId) { this.active = false; this.captureId = captureId; this.offset = 0; return; }
        if (!this.active) return;
        this.active = false;
        if (flush === true) {
          const samples = this.frames.slice(0, this.offset);
          this.port.postMessage({ samples, captureId, ended: true }, [samples.buffer]);
        }
        this.offset = 0;
      }
    };
  }
  process(inputs) {
    if (!this.active) return true;
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let index = 0; index < channels[0].length; index++) {
      let sample = 0;
      for (const channel of channels) sample += channel[index] || 0;
      this.frames[this.offset++] = sample / channels.length;
      if (this.offset === this.frames.length) {
        this.port.postMessage({ samples: this.frames, captureId: this.captureId }, [this.frames.buffer]);
        this.frames = new Float32Array(2048); this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('studio-voice-capture', StudioVoiceCapture);
