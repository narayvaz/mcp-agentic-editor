import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoicePermissionHandlers, type VoicePermissionDetails } from '../electron/voice-permissions.ts';

function fixture() {
  const state = { url: 'http://127.0.0.1:3210/', foreground: true, destroyed: false, granted: false, requests: 0 };
  const contents = { getURL: () => state.url, isDestroyed: () => state.destroyed };
  let ask: () => Promise<boolean> = async () => { state.granted = true; return true; };
  const handlers = createVoicePermissionHandlers({
    studioOrigin: () => 'http://127.0.0.1:3210', trustedContents: () => contents,
    isForeground: () => state.foreground, microphoneAccessGranted: () => state.granted,
    requestMicrophoneAccess: () => { state.requests++; return ask(); },
  });
  const details: VoicePermissionDetails = { isMainFrame: true, requestingUrl: state.url, securityOrigin: 'http://127.0.0.1:3210', mediaType: 'audio', mediaTypes: ['audio'] };
  const request = (change: Partial<VoicePermissionDetails> = {}, permission = 'media', target = contents) => new Promise<boolean>(resolve => handlers.request(target, permission, resolve, { ...details, ...change }));
  return { state, contents, handlers, details, request, setAsk: (value: typeof ask) => { ask = value; } };
}

test('only foreground Studio main-frame audio can ask for native microphone consent', async () => {
  const f = fixture();
  assert.equal(f.handlers.check(f.contents, 'media', 'http://127.0.0.1:3210', f.details), false);
  assert.equal(f.state.requests, 0);
  assert.equal(await f.request(), true);
  assert.equal(f.state.requests, 1);
  assert.equal(f.handlers.check(f.contents, 'media', 'http://127.0.0.1:3210', f.details), true);
  assert.equal(await f.request(), true);
  assert.equal(f.state.requests, 1);
});

test('camera, combined media, unknown media and every unrelated permission fail closed', async () => {
  const f = fixture(); f.state.granted = true;
  for (const mediaTypes of [undefined, [], ['video'], ['audio', 'video'], ['audio', 'audio'], ['unknown']]) assert.equal(await f.request({ mediaTypes }), false);
  for (const mediaType of [undefined, 'unknown', 'video']) assert.equal(f.handlers.check(f.contents, 'media', 'http://127.0.0.1:3210', { ...f.details, mediaType }), false);
  for (const permission of ['display-capture', 'clipboard-read', 'geolocation', 'notifications', 'speaker-selection', 'unknown']) assert.equal(await f.request({}, permission), false);
  assert.equal(f.state.requests, 0);
});

test('subframes, other windows, origins, ports and missing URLs cannot use microphone', async () => {
  const f = fixture(); f.state.granted = true;
  for (const detail of [
    { isMainFrame: false }, { isMainFrame: undefined }, { requestingUrl: undefined },
    { requestingUrl: 'http://127.0.0.1:3211/' }, { requestingUrl: 'https://attacker.example/' },
    { securityOrigin: 'http://localhost:3210' }, { securityOrigin: 'null' }, { embeddingOrigin: 'https://attacker.example' },
  ]) assert.equal(await f.request(detail), false);
  assert.equal(await f.request({}, 'media', { ...f.contents }), false);
  assert.equal(f.handlers.check(f.contents, 'media', 'http://127.0.0.1:3211', f.details), false);
  f.state.url = 'https://attacker.example/'; assert.equal(await f.request(), false);
  f.state.url = 'http://127.0.0.1:3210/'; f.state.foreground = false; assert.equal(await f.request(), false);
  f.state.foreground = true; f.state.destroyed = true; assert.equal(await f.request(), false);
  assert.equal(f.state.requests, 0);
});

test('losing focus, navigation or window lifetime while consent is pending revokes grant', async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.state.foreground = false; },
    (f: ReturnType<typeof fixture>) => { f.state.url = 'https://attacker.example/'; },
    (f: ReturnType<typeof fixture>) => { f.state.destroyed = true; },
  ]) {
    const f = fixture(); let complete!: (value: boolean) => void;
    f.setAsk(() => new Promise(resolve => { complete = resolve; }));
    const pending = f.request(); await Promise.resolve();
    change(f); f.state.granted = true; complete(true);
    assert.equal(await pending, false);
  }
});

test('native rejection and concurrent requests cannot prompt repeatedly or grant accidentally', async () => {
  const f = fixture(); let complete!: (value: boolean) => void;
  f.setAsk(() => new Promise(resolve => { complete = resolve; }));
  const first = f.request(), second = f.request(); await Promise.resolve();
  assert.equal(f.state.requests, 1); complete(false);
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
  f.setAsk(async () => { throw new Error('native refusal'); });
  assert.equal(await f.request(), false);
  f.setAsk(async () => true); assert.equal(await f.request(), false); // No OS grant status.
});
