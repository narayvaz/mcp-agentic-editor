import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceProviderEvent } from '../server/voice-provider';
import { voiceError } from '../server/voice-service';

test('voice provider processes all PCM parts and independent transcripts without exposing thought parts', () => {
  const event = voiceProviderEvent({
    serverContent: {
      modelTurn: { parts: [{ inlineData: { data: 'AQI=', mimeType: 'audio/pcm;rate=24000' } }, { text: 'private reasoning', thought: true }, { inlineData: { data: 'AwQ=', mimeType: 'audio/pcm;rate=24000' } }, { thought: true, inlineData: { data: 'BQY=', mimeType: 'audio/pcm;rate=24000' } }] },
      inputTranscription: { text: 'Բարև', finished: true }, outputTranscription: { text: 'Hello', finished: true }, interrupted: true, turnComplete: true,
    },
    sessionResumptionUpdate: { resumable: true, newHandle: 'server-only-handle' },
    toolCall: { functionCalls: [{ id: 'a1', name: 'prepare_assignment', args: { instruction: 'Research this' } }] },
    toolCallCancellation: { ids: ['a2'] }, goAway: { timeLeft: '30s' },
  } as any);
  assert.equal(event.audio?.length, 2);
  assert.equal(event.inputTranscript, 'Բարև'); assert.equal(event.outputTranscript, 'Hello');
  assert.equal(event.inputFinished, true); assert.equal(event.outputFinished, true);
  assert.equal(event.interrupted, true); assert.equal(event.turnComplete, true); assert.equal(event.goAway, true);
  assert.equal(event.resumption?.handle, 'server-only-handle');
  assert.deepEqual(event.cancelledTools, ['a2']); assert.equal(event.tools?.[0].name, 'prepare_assignment');
  assert.ok(!JSON.stringify(event).includes('private reasoning'));
});

test('voice errors expose actionable classes without provider key, payload, or endpoint diagnostics', () => {
  for (const [error, code] of [[{ status: 429, message: 'secret-key-here quota payload' }, 'quota'], [{ status: 403, message: 'secret-key-here denied' }, 'credentials'], [{ status: 404, message: 'secret-key-here model' }, 'model-unavailable'], [new Error('secret-key-here endpoint payload'), 'connection']] as const) {
    const safe = voiceError(error);
    assert.equal(safe.code, code);
    assert.ok(!JSON.stringify(safe).includes('secret-key-here'));
  }
});
