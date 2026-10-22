import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeVoicePcm, encodeVoicePcm, guardVoiceMicrophone, voiceHistory, VoiceResampler, VoiceTranscripts, voicePlaybackWindow } from '../src/lib/voice-audio';

test('microphone resampling preserves a single clock across uneven 44.1kHz and 48kHz worklet blocks', () => {
  for (const rate of [44100, 48000, 16000]) {
    const samples = Float32Array.from({ length: rate }, (_, index) => Math.sin(index * 2 * Math.PI * 440 / rate));
    const expected = new VoiceResampler(rate).process(samples);
    const resampler = new VoiceResampler(rate), received: number[] = [];
    for (let offset = 0; offset < samples.length; offset += 137) received.push(...resampler.process(samples.slice(offset, offset + 137)));
    assert.equal(received.length, expected.length);
    assert.ok(Math.abs(received.length - 16000) <= 1);
    for (let index = 0; index < received.length; index++) assert.ok(Math.abs(received[index] - expected[index]) < 1e-6);
  }
});

test('PCM16 voice round trip has correct endianness, clipping and finite silence', () => {
  const restored = decodeVoicePcm(encodeVoicePcm(Float32Array.from([-2, -1, -.5, 0, .5, 1, 2, NaN])));
  assert.deepEqual([...restored].map(value => Math.round(value * 100)), [-100, -100, -50, 0, 50, 100, 100, 0]);
  assert.deepEqual([...decodeVoicePcm('AIA=')], [-1]);
  assert.throws(() => decodeVoicePcm('AA=='), /incomplete/);
  assert.throws(() => decodeVoicePcm('not audio!'), /invalid/);
});

test('downsampling preserves speech frequencies and suppresses frequencies that would alias', () => {
  const amplitude = (frequency: number) => {
    const input = Float32Array.from({ length: 48000 }, (_, index) => Math.sin(index * 2 * Math.PI * frequency / 48000));
    const output = new VoiceResampler(48000).process(input).slice(100);
    return Math.sqrt(output.reduce((sum, value) => sum + value * value, 0) / output.length);
  };
  assert.ok(amplitude(1000) > .65);
  assert.ok(amplitude(11000) < .01);
});

test('playback scheduling is ordered but refuses growing latency after a stalled audio device', () => {
  assert.deepEqual(voicePlaybackWindow(2, 0, .2), { start: 2, end: 2.2 });
  assert.deepEqual(voicePlaybackWindow(2, 2.2, .5), { start: 2.2, end: 2.7 });
  assert.throws(() => voicePlaybackWindow(2, 13.8, .5), /fell behind/);
  assert.throws(() => voicePlaybackWindow(2, 2, NaN), /too large/);
});

test('a microphone permission response after a cancelled or failed start always stops its tracks', async () => {
  let current = true, stopped = 0;
  let accept!: (stream: { getTracks(): { stop(): void }[] }) => void;
  const pending = new Promise<{ getTracks(): { stop(): void }[] }>(resolve => { accept = resolve; });
  const acquired = guardVoiceMicrophone(pending, () => current);
  current = false; // End/chat switch/setup failure happens while the OS prompt is open.
  accept({ getTracks: () => [{ stop: () => { stopped++; } }, { stop: () => { stopped++; } }] });
  await acquired; assert.equal(stopped, 2);
});

test('voice history keeps newest conversation within backend total and per-turn limits', () => {
  const history = voiceHistory(Array.from({ length: 20 }, (_, index) => ({ role: 'user' as const, text: `${index}:` + 'x'.repeat(8000) })));
  assert.equal(history.length, 4);
  assert.equal(history.reduce((size, item) => size + item.text.length, 0), 24000);
  assert.ok(history.every(item => item.text.length <= 6000));
  assert.deepEqual(voiceHistory([{ role: 'user', text: 'Earlier' }, { role: 'agent', text: 'Newest' }], 8), [{ role: 'user', text: 'er' }, { role: 'agent', text: 'Newest' }]);
});

test('partial transcript appends become one saved turn, never a repeated final or another role', () => {
  const transcripts = new VoiceTranscripts();
  assert.equal(transcripts.append({ role: 'user', turnId: '1', text: 'Բարև ' }), null);
  assert.equal(transcripts.append({ role: 'agent', turnId: '1', text: 'Hello' }), null);
  assert.equal(transcripts.append({ role: 'user', turnId: '1', text: 'Studio' }), null);
  assert.equal(transcripts.append({ role: 'user', turnId: '1', text: '', final: true })?.text, 'Բարև Studio');
  assert.equal(transcripts.append({ role: 'user', turnId: '1', text: '', final: true }), null);
  assert.deepEqual(transcripts.finish().map(item => item.text), ['Hello']);
  assert.deepEqual(transcripts.pending(), []);
  assert.equal(transcripts.append({ role: 'agent', turnId: '1', text: ' late', final: true }), null);
});
