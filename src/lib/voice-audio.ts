/** Streaming conversion keeps the same sample clock across worklet blocks. */
export class VoiceResampler {
  private tail = new Float32Array(0);
  private position = 0;
  private filter?: Float64Array;
  private history?: Float32Array;
  private filterPosition = 0;
  constructor(readonly inputRate: number, readonly outputRate = 16000) {
    if (!Number.isFinite(inputRate) || inputRate < 8000 || inputRate > 192000 || !Number.isFinite(outputRate) || outputRate < 8000 || outputRate > 48000) throw new Error('Unsupported microphone sample rate.');
    if (inputRate > outputRate) {
      // Remove frequencies above the target Nyquist limit before decimation.
      const taps = 63, cutoff = .45 * outputRate / inputRate;
      this.filter = Float64Array.from({ length: taps }, (_, index) => {
        const distance = index - (taps - 1) / 2;
        const sinc = distance === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * distance) / (Math.PI * distance);
        return sinc * (.54 - .46 * Math.cos(2 * Math.PI * index / (taps - 1)));
      });
      const sum = this.filter.reduce((total, value) => total + value, 0);
      this.filter = this.filter.map(value => value / sum); this.history = new Float32Array(taps);
    }
  }
  process(input: Float32Array): Float32Array {
    let incoming = input;
    if (this.filter && this.history) {
      incoming = new Float32Array(input.length);
      for (let index = 0; index < input.length; index++) {
        this.history[this.filterPosition] = Number.isFinite(input[index]) ? input[index] : 0;
        let sample = 0;
        for (let tap = 0; tap < this.filter.length; tap++) sample += this.history[(this.filterPosition - tap + this.filter.length) % this.filter.length] * this.filter[tap];
        incoming[index] = sample; this.filterPosition = (this.filterPosition + 1) % this.filter.length;
      }
    }
    const samples = new Float32Array(this.tail.length + incoming.length);
    samples.set(this.tail); samples.set(incoming, this.tail.length);
    const step = this.inputRate / this.outputRate;
    const output: number[] = [];
    while (this.position + 1 < samples.length) {
      const index = Math.floor(this.position), fraction = this.position - index;
      output.push(samples[index] * (1 - fraction) + samples[index + 1] * fraction);
      this.position += step;
    }
    const discard = Math.min(Math.floor(this.position), samples.length);
    this.tail = samples.slice(discard); this.position -= discard;
    return Float32Array.from(output);
  }
  reset() { this.tail = new Float32Array(0); this.position = 0; this.history?.fill(0); this.filterPosition = 0; }
}

export function encodeVoicePcm(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2), view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index++) {
    const value = Number.isFinite(samples[index]) ? Math.max(-1, Math.min(1, samples[index])) : 0;
    view.setInt16(index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  let text = '';
  for (let index = 0; index < bytes.length; index += 8192) text += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(text);
}

export function decodeVoicePcm(data: string): Float32Array {
  if (typeof data !== 'string' || data.length > 2 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error('Studio received invalid voice audio.');
  const binary = atob(data);
  if (binary.length % 2) throw new Error('Studio received an incomplete voice audio frame.');
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0)), view = new DataView(bytes.buffer);
  const result = new Float32Array(bytes.length / 2);
  for (let index = 0; index < result.length; index++) { const sample = view.getInt16(index * 2, true); result[index] = sample / (sample < 0 ? 32768 : 32767); }
  return result;
}

/** Limit lag instead of allowing a slow device to accumulate minutes of audio. */
export function voicePlaybackWindow(currentTime: number, queuedUntil: number, duration: number, maximumAhead = 12) {
  if (![currentTime, queuedUntil, duration].every(Number.isFinite) || duration <= 0 || duration > maximumAhead) throw new Error('The voice response audio is too large.');
  const start = Math.max(currentTime, queuedUntil);
  if (start + duration - currentTime > maximumAhead) throw new Error('Voice playback fell behind. Interrupt and try again.');
  return { start, end: start + duration };
}

/** Permission dialogs can resolve after End, a chat switch or audio setup failure. */
export function guardVoiceMicrophone<T extends { getTracks(): { stop(): void }[] }>(pending: Promise<T>, isCurrent: () => boolean): Promise<T> {
  return pending.then(stream => { if (!isCurrent()) stream.getTracks().forEach(track => track.stop()); return stream; });
}

export function voiceHistory(messages: { role: 'user' | 'agent'; text: string }[], maximumCharacters = 24000) {
  const result: typeof messages = []; let remaining = maximumCharacters;
  for (const message of messages.slice(-12).reverse()) {
    const text = message.text.slice(-Math.min(6000, remaining));
    if (text) { result.unshift({ role: message.role, text }); remaining -= text.length; }
    if (!remaining) break;
  }
  return result;
}

/** Keep queued packets fenced while a completed PTT block is being flushed. */
export function acceptsVoiceCapturePacket(packetId: unknown, currentId: number, active: boolean, finishingId?: number) {
  return Number.isSafeInteger(packetId) && packetId === currentId && (active || finishingId === currentId);
}

export type VoiceTranscript = { role: 'user' | 'agent'; text: string; turnId: string; final?: boolean };
/** Provider transcript packets are appends, with an empty final packet per turn. */
export class VoiceTranscripts {
  private parts = new Map<string, VoiceTranscript>();
  private completed = new Set<string>();
  append(packet: VoiceTranscript): VoiceTranscript | null {
    const key = `${packet.role}:${packet.turnId}`;
    if (!packet.turnId || this.completed.has(key)) return null;
    const previous = this.parts.get(key);
    const next = { ...packet, text: `${previous?.text || ''}${packet.text || ''}`.slice(0, 24000) };
    if (packet.final) { this.parts.delete(key); this.completed.add(key); return next.text.trim() ? next : null; }
    this.parts.set(key, next); return null;
  }
  pending(): VoiceTranscript[] { return [...this.parts.values()].filter(item => item.text.trim()); }
  finish(): VoiceTranscript[] { const pending = this.pending(); this.parts.clear(); for (const item of pending) this.completed.add(`${item.role}:${item.turnId}`); return pending; }
}
