import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { acceptsVoiceCapturePacket } from '../src/lib/voice-audio';

type Packet = { samples: Float32Array; captureId: number; ended?: boolean };
function harness() {
  const packets: Packet[] = []; let Processor: any;
  class AudioWorkletProcessor {
    port = { onmessage: null as any, postMessage: (packet: Packet, transfer: ArrayBuffer[]) => packets.push(structuredClone(packet, { transfer })) };
  }
  runInNewContext(readFileSync(new URL('../public/voice-capture-worklet.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor, Float32Array, registerProcessor: (name: string, implementation: any) => { assert.equal(name, 'studio-voice-capture'); Processor = implementation; },
  });
  const worklet = new Processor();
  return {
    packets,
    control: (active: boolean, captureId: number, flush = false) => worklet.port.onmessage({ data: { active, captureId, flush } }),
    render: (left: Float32Array, right?: Float32Array) => worklet.process([[left, ...(right ? [right] : [])]]),
  };
}

test('explicit turn finish flushes the final partial mono block exactly once before activity closes', () => {
  const mic = harness(); mic.control(true, 1);
  mic.render(Float32Array.from([.1, .2, .3]), Float32Array.from([.3, .4, .5]));
  assert.equal(mic.packets.length, 0);
  mic.control(false, 1, true);
  assert.equal(mic.packets.length, 1);
  const packet = mic.packets[0];
  assert.equal(packet.ended, true); assert.equal(packet.captureId, 1);
  assert.deepEqual([...packet.samples].map(value => Math.round(value * 10)), [2, 3, 4]);
  // The renderer accepts this finishing turn, sends the samples, then closes it.
  assert.equal(acceptsVoiceCapturePacket(packet.captureId, 1, false, 1), true);
  assert.equal(acceptsVoiceCapturePacket(packet.captureId, 1, false), false);
  mic.control(false, 1, true); mic.render(new Float32Array(2048).fill(.9));
  assert.equal(mic.packets.length, 1);
});

test('full blocks remain ordered before the partial finish and an empty finish still acknowledges closure', () => {
  const mic = harness(); mic.control(true, 1);
  mic.render(new Float32Array(2048).fill(.25)); mic.render(new Float32Array(128).fill(.75)); mic.control(false, 1, true);
  assert.deepEqual(mic.packets.map(packet => [packet.samples.length, packet.ended === true]), [[2048, false], [128, true]]);
  assert.ok(mic.packets[0].samples.every(value => value === .25));
  assert.ok(mic.packets[1].samples.every(value => value === .75));
  mic.control(true, 2); mic.render(new Float32Array(2048).fill(.5)); mic.control(false, 2, true);
  assert.equal(mic.packets.at(-1)?.samples.length, 0);
  assert.equal(mic.packets.at(-1)?.ended, true);
});

test('finished, cancelled and superseded capture IDs cannot reopen or leak queued old audio into a new turn', () => {
  const mic = harness(); mic.control(true, 1); mic.render(new Float32Array(128).fill(.1)); mic.control(false, 1, true);
  const lateFirst = mic.packets[0];
  mic.control(true, 1); mic.render(new Float32Array(2048).fill(.9)); // A stale Start after finish is fenced.
  assert.equal(mic.packets.length, 1);
  mic.control(true, 2); mic.control(false, 1, true); // A delayed old Finish cannot stop the new capture.
  mic.render(new Float32Array(128).fill(.5)); mic.control(false, 2, true);
  assert.equal(mic.packets.length, 2); assert.ok(mic.packets[1].samples.every(value => value === .5));
  assert.equal(acceptsVoiceCapturePacket(lateFirst.captureId, 2, true), false);
  assert.equal(acceptsVoiceCapturePacket(lateFirst.captureId, 2, false, 2), false);
  assert.equal(acceptsVoiceCapturePacket(mic.packets[1].captureId, 3, false), false); // End/timeout fences all queued packets.
  mic.control(true, 3); mic.render(new Float32Array(128).fill(.75)); mic.control(false, 4); // Discard without flushing on interruption/end.
  mic.control(false, 3, true); mic.control(true, 3); mic.render(new Float32Array(2048).fill(.9));
  assert.equal(mic.packets.length, 2);
});
