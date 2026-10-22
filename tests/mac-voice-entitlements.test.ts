import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMacVoiceEntitlements } from '../scripts/mac-voice-entitlements.mjs';

test('signed microphone permission requires audio input, hardened runtime and a purpose without camera access', () => {
  const valid = { entitlements: { 'com.apple.security.device.audio-input': true }, hardenedRuntime: true, microphoneUsageDescription: 'Voice collaboration after Start voice.' };
  assert.doesNotThrow(() => assertMacVoiceEntitlements(valid));
  for (const entitlements of [{}, { 'com.apple.security.device.audio-input': false }]) assert.throws(() => assertMacVoiceEntitlements({ ...valid, entitlements }), /audio-input/);
  assert.throws(() => assertMacVoiceEntitlements({ ...valid, hardenedRuntime: false }), /hardened runtime/);
  assert.throws(() => assertMacVoiceEntitlements({ ...valid, microphoneUsageDescription: '  ' }), /purpose/);
  assert.throws(() => assertMacVoiceEntitlements({ ...valid, entitlements: { ...valid.entitlements, 'com.apple.security.device.camera': true } }), /camera/);
});
