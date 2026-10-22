import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import express from 'express';
import { WebSocket } from 'ws';
import { registerVoiceRoutes, type VoiceServiceOptions } from '../server/voice-service';
import { createRuntimeSecurity } from '../server/runtime-security';
import type { VoiceConnection, VoiceProvider, VoiceProviderOptions } from '../server/voice-provider';

const token = 'a'.repeat(64);
const delay = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function mockProvider() {
  const options: VoiceProviderOptions[] = [];
  const actions: { type: string; value?: unknown }[] = [];
  const connection: VoiceConnection = {
    sendActivity: value => { actions.push({ type: 'activity', value }); },
    sendAudio: value => { actions.push({ type: 'audio', value }); },
    sendText: value => { actions.push({ type: 'text', value }); },
    interrupt: () => { actions.push({ type: 'interrupt' }); },
    sendToolResponse: (id, name, response) => { actions.push({ type: 'tool-response', value: { id, name, response } }); },
    close: () => { actions.push({ type: 'close' }); },
  };
  const provider: VoiceProvider = { async connect(value) { options.push(value); return connection; } };
  return { provider, options, actions, connection };
}
async function fixture(extra: Partial<VoiceServiceOptions> = {}) {
  const mock = mockProvider();
  const app = express(); app.use(express.json({ limit: '128kb' }));
  const server = createServer(app);
  let origin = '';
  let security: ReturnType<typeof createRuntimeSecurity>;
  const service = registerVoiceRoutes(app, {
    resolveApiKey: () => 'fixture-private-key', isConfigured: () => true, provider: mock.provider,
    authorize: (req, action) => {
      const authenticated = req.headers.upgrade ? security.acceptSocket(req) : security.authenticated(req.headers);
      return authenticated && (action !== 'task-control' || security.capabilities.includes('agent:run'));
    }, ...extra,
  });
  server.on('upgrade', (req, socket, head) => { if (!service.handleUpgrade(req, socket, head)) socket.destroy(); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  origin = `http://127.0.0.1:${port}`;
  security = createRuntimeSecurity({ token, port });
  async function request(path: string, body?: unknown, authenticated = true) {
    return fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  async function reserve(body: unknown = { threadId: 'thread-1', context: 'Untrusted article excerpt.', history: [{ role: 'user', text: 'Hello' }] }) {
    const result = await request('/api/voice/sessions', body);
    return { result, session: await result.json() as any };
  }
  function socket(path: string, protocols = [`azat-session.${token}`], requestOrigin = origin) {
    const messages: any[] = [];
    const ws = new WebSocket(origin.replace('http:', 'ws:') + path, protocols, { headers: { Origin: requestOrigin } });
    ws.on('message', value => messages.push(JSON.parse(value.toString())));
    ws.on('error', () => { /* Expected rejection paths are asserted through readyState. */ });
    async function wait(predicate: (item: any) => boolean) {
      for (let i = 0; i < 300; i++) { const item = messages.find(predicate); if (item) return item; await delay(); }
      assert.fail(`Expected voice message was not received; types: ${messages.map(item => item.type).join(', ')}`);
    }
    return { ws, messages, wait, send: (message: unknown) => ws.send(JSON.stringify(message)) };
  }
  async function connected(body?: unknown) {
    const { result, session } = await reserve(body);
    assert.equal(result.status, 201);
    const client = socket(session.websocketPath);
    await client.wait(message => message.type === 'ready');
    return { ...client, session };
  }
  async function close() { await service.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
  return { ...mock, request, reserve, socket, connected, close, service, origin };
}

test('voice availability is truthful, private, authenticated, and does not open a paid provider connection', async () => {
  let reads = 0;
  const f = await fixture({ isConfigured: () => false, resolveApiKey: () => { reads++; return undefined; } });
  try {
    assert.equal((await f.request('/api/voice/status', undefined, false)).status, 403);
    const status = await (await f.request('/api/voice/status')).json() as any;
    assert.equal(status.available, false); assert.equal(status.provider, 'gemini-live'); assert.equal(f.options.length, 0);
    assert.equal(reads, 0);
    const { result, session } = await f.reserve(); assert.equal(result.status, 503);
    assert.ok(!JSON.stringify(session).includes('fixture-private-key'));
    assert.equal((await f.request('/api/voice/sessions', { threadId: 'x' }, false)).status, 403);
  } finally { await f.close(); }
});

test('voice session reservation bounds context and history and prevents concurrent calls', async () => {
  const f = await fixture();
  try {
    for (const body of [{}, { threadId: 'x', context: 'a'.repeat(24001) }, { threadId: 'x', history: [{ role: 'system', text: 'Injected authority' }] }, { threadId: 'x', history: Array(17).fill({ role: 'user', text: 'hello' }) }]) {
      assert.equal((await f.reserve(body)).result.status, 400);
    }
    const first = await f.reserve(); assert.equal(first.result.status, 201);
    assert.equal((await f.reserve()).result.status, 409); assert.equal(f.options.length, 0);
    assert.ok(!JSON.stringify(first.session).includes('fixture-private-key'));
    const bad = f.socket(first.session.websocketPath, [`azat-session.${'b'.repeat(64)}`]);
    await delay(25); assert.equal(bad.ws.readyState, WebSocket.CLOSED); assert.equal(f.options.length, 0);
    const crossSite = f.socket(first.session.websocketPath, undefined, 'https://attacker.invalid');
    await delay(25); assert.equal(crossSite.ws.readyState, WebSocket.CLOSED); assert.equal(f.options.length, 0);
    const client = f.socket(first.session.websocketPath);
    await client.wait(message => message.type === 'ready'); assert.equal(f.options.length, 1);
    const duplicate = f.socket(first.session.websocketPath);
    await delay(25); assert.equal(duplicate.ws.readyState, WebSocket.CLOSED);
    client.send({ type: 'end' }); await delay(20);
    assert.equal((await f.reserve()).result.status, 201);
  } finally { await f.close(); }
});

test('voice relay passes only explicitly opened PCM turns and supports text and interruption', async () => {
  const f = await fixture();
  try {
    const client = await f.connected();
    client.send({ type: 'activity', active: true });
    client.send({ type: 'audio', data: 'AAABAA==', mimeType: 'audio/pcm;rate=16000' });
    client.send({ type: 'activity', active: false });
    client.send({ type: 'text', text: 'What is next?' });
    client.send({ type: 'interrupt' });
    await delay(25);
    assert.deepEqual(f.actions.filter(action => ['activity', 'audio', 'text', 'interrupt'].includes(action.type)), [
      { type: 'activity', value: true }, { type: 'audio', value: 'AAABAA==' }, { type: 'activity', value: false }, { type: 'text', value: 'What is next?' }, { type: 'interrupt' },
    ]);
    const text = client.messages.filter(message => message.type === 'transcript');
    assert.equal(text[0].text, 'What is next?'); assert.equal(text[1].final, true); assert.equal(text[0].turnId, text[1].turnId);
    client.send({ type: 'audio', data: 'AAAA' });
    assert.equal((await client.wait(message => message.type === 'error')).code, 'microphone-closed');
  } finally { await f.close(); }
});

test('voice relay rejects other audio formats and malformed PCM without sending them to the provider', async () => {
  for (const frame of [{ data: 'AAAA', mimeType: 'audio/webm' }, { data: 'AA==' }, { data: 'invalid' }]) {
    const f = await fixture();
    try {
      const client = await f.connected(); client.send({ type: 'activity', active: true });
      client.send({ type: 'audio', ...frame });
      assert.equal((await client.wait(message => message.type === 'error')).code, 'audio-format');
      assert.equal(f.actions.filter(action => action.type === 'audio').length, 0);
    } finally { await f.close(); }
  }
});

test('voice provider audio and transcript chunks share bounded stable turn identities and finalize once', async () => {
  const f = await fixture();
  try {
    const client = await f.connected();
    f.options[0].onEvent({ inputTranscript: 'Hello ', outputTranscript: 'Բարև ', audio: [{ data: 'AAA=', mimeType: 'audio/pcm;rate=24000' }, { data: 'AQABAA==', mimeType: 'audio/pcm;rate=24000' }] });
    f.options[0].onEvent({ inputTranscript: 'Studio', outputTranscript: 'Նարեկ', turnComplete: true });
    await client.wait(message => message.type === 'turn-complete');
    assert.equal(client.messages.filter(message => message.type === 'audio').length, 2);
    for (const role of ['user', 'agent']) {
      const chunks = client.messages.filter(message => message.type === 'transcript' && message.role === role);
      assert.equal(chunks.length, 3); assert.equal(chunks[2].final, true);
      assert.equal(new Set(chunks.map(chunk => chunk.turnId)).size, 1);
    }
    f.options[0].onEvent({ outputTranscript: 'New turn', turnComplete: true });
    await delay(15);
    const turns = client.messages.filter(message => message.type === 'transcript' && message.role === 'agent');
    assert.notEqual(turns[0].turnId, turns[3].turnId);
  } finally { await f.close(); }
});

test('voice assignment tools prepare reviewable instructions once and cannot execute unselected or external actions', async () => {
  let calls = 0;
  const f = await fixture({ taskBridge: async () => { calls++; return {}; } });
  try {
    const client = await f.connected();
    const proposed = { id: 'proposal-1', name: 'prepare_assignment', args: { instruction: 'Research this article and prepare a sourced draft.' } };
    f.options[0].onEvent({ tools: [proposed] });
    await client.wait(message => message.type === 'task-proposal');
    f.options[0].onEvent({ tools: [proposed, { id: 'write-1', name: 'wordpress_publish', args: {} }, { id: 'pause-1', name: 'selected_task_pause', args: { taskId: 'not-selected' } }] });
    await delay(25);
    assert.equal(client.messages.filter(message => message.type === 'task-proposal').length, 1);
    assert.equal(calls, 0);
    const receipts = f.actions.filter(action => action.type === 'tool-response').map(action => (action.value as any).response);
    assert.equal(receipts[0].started, false); assert.equal(receipts.filter(receipt => receipt.ok === false).length, 2);
    assert.ok(!f.options[0].taskControls);
  } finally { await f.close(); }
});

test('selected task control uses only the captured selection, aborts on end, and ignores late tool/provider callbacks', async () => {
  const pending = deferred<unknown>();
  let selected = ''; let signal: AbortSignal | undefined;
  const f = await fixture({ taskBridge: async (_action, id, value) => { selected = id; signal = value; return pending.promise; } });
  try {
    const client = await f.connected({ threadId: 'thread-1', selectedTaskId: 'task-selected' });
    f.options[0].onEvent({ tools: [{ id: 'pause-1', name: 'selected_task_pause', args: { taskId: 'attacker-task' } }] });
    await delay(10); assert.equal(selected, 'task-selected'); assert.equal(signal?.aborted, false);
    client.send({ type: 'end' }); await delay(15); assert.equal(signal?.aborted, true);
    const before = client.messages.length;
    pending.resolve({ status: 'paused' });
    f.options[0].onEvent({ outputTranscript: 'late secret', audio: [{ data: 'AAAA', mimeType: 'audio/pcm;rate=24000' }] });
    await delay(20);
    assert.equal(client.messages.length, before);
    assert.equal(f.actions.filter(action => action.type === 'tool-response').length, 0);
  } finally { await f.close(); }
});

test('provider reconnect resumes only a fresh private handle without replaying history, microphone, or task controls', async () => {
  const f = await fixture();
  try {
    const client = await f.connected();
    f.options[0].onEvent({ resumption: { resumable: true, handle: 'private-resume-handle' } });
    f.options[0].onEvent({ goAway: true });
    await client.wait(message => message.type === 'status' && message.state === 'reconnecting');
    for (let i = 0; i < 50 && f.options.length < 2; i++) await delay();
    assert.equal(f.options.length, 2); assert.equal(f.options[1].resumeHandle, 'private-resume-handle');
    assert.deepEqual(f.options[1].history, []);
    assert.ok(!JSON.stringify(client.messages).includes('private-resume-handle'));
    f.options[0].onEvent({ outputTranscript: 'stale generation' });
    await delay(15); assert.ok(!JSON.stringify(client.messages).includes('stale generation'));
    assert.equal(f.actions.filter(action => ['audio', 'text', 'tool-response'].includes(action.type)).length, 0);
  } finally { await f.close(); }
});

test('revoked provider resumption state never reuses an older handle', async () => {
  const f = await fixture();
  try {
    const client = await f.connected();
    f.options[0].onEvent({ resumption: { resumable: true, handle: 'stale-handle' } });
    f.options[0].onEvent({ resumption: { resumable: false }, goAway: true });
    assert.equal((await client.wait(message => message.type === 'error')).code, 'connection');
    assert.equal(f.options.length, 1);
  } finally { await f.close(); }
});

test('connection timeout and shutdown abort pending provider connections and close late sessions', async () => {
  const pending = deferred<VoiceConnection>();
  const mock = mockProvider(); let attempt: VoiceProviderOptions | undefined;
  const f = await fixture({ provider: { connect: value => { attempt = value; return pending.promise; } }, limits: { connectMs: 25 } });
  try {
    const { session } = await f.reserve(); const client = f.socket(session.websocketPath);
    assert.equal((await client.wait(message => message.type === 'error')).code, 'timeout');
    assert.equal(attempt?.signal.aborted, true);
    pending.resolve(mock.connection); await delay(20);
    assert.equal(mock.actions.filter(action => action.type === 'close').length, 1);
    assert.equal(client.messages.filter(message => message.type === 'ready').length, 0);
    await f.service.close();
    assert.equal((await f.reserve()).result.status, 503);
  } finally { await f.close(); }
});

test('unused reservations and inactive voice calls expire without leaving an active provider', async () => {
  const f = await fixture({ limits: { reservationMs: 25, idleMs: 40, lifetimeMs: 150 } });
  try {
    await f.reserve(); await delay(50);
    assert.equal((await (await f.request('/api/voice/status')).json() as any).active, false);
    assert.equal(f.options.length, 0);
    const client = await f.connected();
    assert.equal((await client.wait(message => message.type === 'error')).code, 'session-ended');
    assert.ok(f.actions.some(action => action.type === 'close'));
  } finally { await f.close(); }
});

test('voice status uses configured metadata without opening or resolving the saved connection', async () => {
  let reads = 0;
  const f = await fixture({ isConfigured: () => true, resolveApiKey: () => { reads++; throw new Error('private Keychain failure'); } });
  try {
    const status = await (await f.request('/api/voice/status')).json() as any;
    assert.equal(status.available, true); assert.equal(reads, 0); assert.equal(f.options.length, 0);
    const { result, session } = await f.reserve(); assert.equal(result.status, 503); assert.equal(reads, 1);
    assert.ok(!JSON.stringify(session).includes('private Keychain failure'));
  } finally { await f.close(); }
});

test('an abandoned credential lookup cannot create a late reservation and successful reservations can be cancelled before websocket start', async () => {
  const key = deferred<string>(); let reads = 0;
  const f = await fixture({ resolveApiKey: () => ++reads === 1 ? key.promise : 'fixture-private-key' });
  try {
    const abort = new AbortController();
    const creating = fetch(f.origin + '/api/voice/sessions', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ threadId: 'thread-1' }), signal: abort.signal });
    void creating.catch(() => {});
    for (let i = 0; i < 50 && !reads; i++) await delay();
    assert.equal(reads, 1); abort.abort(); await assert.rejects(creating); await delay(15);
    key.resolve('fixture-private-key'); await delay(15);
    assert.equal((await (await f.request('/api/voice/status')).json() as any).active, false);
    const { session } = await f.reserve();
    const unauthorized = await fetch(f.origin + `/api/voice/sessions/${session.id}`, { method: 'DELETE' });
    assert.equal(unauthorized.status, 403);
    assert.equal((await f.reserve()).result.status, 409);
    const ended = await fetch(f.origin + `/api/voice/sessions/${session.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    assert.equal(ended.status, 200);
    assert.equal((await f.reserve()).result.status, 201); assert.equal(f.options.length, 0);
  } finally { await f.close(); }
});

test('confirmed selected task receipts are visible and repeated provider call ids never repeat a control', async () => {
  let calls = 0;
  const f = await fixture({ taskBridge: async (action, id) => { calls++; assert.equal(id, 'selected'); return { status: action === 'pause' ? 'paused' : 'running', revision: 4, instruction: 'Review sources' }; } });
  try {
    const client = await f.connected({ threadId: 'thread-1', selectedTaskId: 'selected' });
    const call = { id: 'pause-1', name: 'selected_task_pause', args: {} };
    f.options[0].onEvent({ tools: [call] });
    const receipt = await client.wait(message => message.type === 'task-receipt');
    assert.equal(receipt.action, 'pause'); assert.equal(receipt.task.status, 'paused');
    f.options[0].onEvent({ tools: [call] }); await delay(15);
    assert.equal(calls, 1); assert.equal(client.messages.filter(message => message.type === 'task-receipt').length, 1);
  } finally { await f.close(); }
});

test('uncertain timed out task controls are aborted and never automatically retried on duplicate calls', async () => {
  let calls = 0; let signal: AbortSignal | undefined; const pending = deferred<unknown>();
  const f = await fixture({ limits: { toolMs: 20 }, taskBridge: async (_action, _id, value) => { calls++; signal = value; return pending.promise; } });
  try {
    const client = await f.connected({ threadId: 'thread-1', selectedTaskId: 'selected' });
    const call = { id: 'pause-1', name: 'selected_task_pause', args: {} };
    f.options[0].onEvent({ tools: [call] }); await delay(40);
    assert.equal(signal?.aborted, true);
    f.options[0].onEvent({ tools: [call] }); pending.resolve({ status: 'paused' }); await delay(15);
    assert.equal(calls, 1); assert.equal(client.messages.filter(message => message.type === 'task-receipt').length, 0);
    const receipts = f.actions.filter(action => action.type === 'tool-response');
    assert.equal(receipts.length, 2); assert.ok(receipts.every(receipt => (receipt.value as any).response.uncertain));
  } finally { await f.close(); }
});
