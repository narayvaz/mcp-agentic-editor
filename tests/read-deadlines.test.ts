import test from 'node:test';
import assert from 'node:assert/strict';
import { withReadDeadline } from '../shared/deadline';
import { readVpsStatus, type SshStatusExecutor } from '../server/integrations';
import { observeProduction, registerObservationRoutes } from '../server/observation';
import { request } from '../src/lib/studio';

const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const never = () => new Promise<any>(() => {});

test('a read deadline settles even when the provider ignores abort and later completes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish!: (value: string) => void; let signal!: AbortSignal;
  const pending = withReadDeadline(current => { signal = current; return new Promise(resolve => { finish = resolve; }); }, 50, 'Read deadline reached.');
  const rejected = assert.rejects(pending, error => error instanceof Error && error.name === 'TimeoutError' && error.message === 'Read deadline reached.');
  await flush(); t.mock.timers.tick(50); await rejected;
  assert.equal(signal.aborted, true); finish('Late success'); await flush();
  assert.equal(await withReadDeadline(async () => 'Retry success', 50, 'Read deadline reached.'), 'Retry success');
});

test('caller cancellation settles independently and a cancelled read never starts', async () => {
  const cancelled = new AbortController(); cancelled.abort(); let calls = 0;
  await assert.rejects(withReadDeadline(async () => { calls++; return 'unexpected'; }, 100, 'Deadline.', { signal: cancelled.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
  const active = new AbortController(); const pending = withReadDeadline(never, 1000, 'Deadline.', { signal: active.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' }); active.abort(); await rejected;
});

test('SSH hard deadline kills and releases pipes without waiting for its callback', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let callback!: Parameters<SshStatusExecutor>[3]; let killed = 0; let destroyed = 0; let sent = ''; let stdinError!: (error: Error) => void;
  const execute: SshStatusExecutor = (file, args, options, done) => {
    assert.equal(file, '/usr/bin/ssh'); assert.ok(args.includes('StrictHostKeyChecking=yes')); assert.ok(args.includes('BatchMode=yes'));
    assert.equal(options.killSignal, 'SIGKILL'); assert.equal(options.timeout, 25_000); callback = done;
    return { kill: signal => { assert.equal(signal, 'SIGKILL'); killed++; }, stdin: { end: value => { sent = value; }, destroy: () => { destroyed++; }, on: (_event, listener) => { stdinError = listener; } }, stdout: { destroy: () => { destroyed++; } }, stderr: { destroy: () => { destroyed++; } } };
  };
  const pending = readVpsStatus({ transport: 'ssh', sshIdentityPath: '/fixture/identity', apiToken: 'fixture-token' }, '/api/expert/status', { sshExecutor: execute });
  const rejected = assert.rejects(pending, /SSH status read timed out/);
  await flush(); assert.deepEqual(JSON.parse(sent), { path: '/api/expert/status', token: 'fixture-token' });
  t.mock.timers.tick(25_000); await rejected; assert.equal(killed, 1); assert.equal(destroyed, 3);
  callback(null, JSON.stringify({ is_running: false, manifest: {} }), ''); stdinError(new Error('Late pipe error')); await flush();
  assert.equal(killed, 1); assert.equal(destroyed, 3);
});

test('SSH pipe errors fail closed and clean up without exposing helper text', async () => {
  const secret = 'fixture-private-error'; let destroyed = 0;
  const execute: SshStatusExecutor = (_file, _args, _options, _done) => ({ kill: () => {}, stdin: { end: () => {}, destroy: () => { destroyed++; }, on: (_event, listener) => { queueMicrotask(() => listener(new Error(secret))); } }, stdout: { destroy: () => { destroyed++; } }, stderr: { destroy: () => { destroyed++; } } });
  await assert.rejects(readVpsStatus({ transport: 'ssh', sshIdentityPath: '/fixture/identity' }, '/api/expert/status', { sshExecutor: execute }), error => error instanceof Error && /could not be sent/.test(error.message) && !error.message.includes(secret));
  assert.equal(destroyed, 3);
});

test('synchronous SSH launch failures are redacted rather than escaping the bounded reader', async () => {
  const secret = '/fixture/private-identity-do-not-return';
  await assert.rejects(readVpsStatus({ transport: 'ssh', sshIdentityPath: secret }, '/api/expert/status', { sshExecutor: () => { throw Object.assign(new Error(secret), { code: 'EACCES' }); } }), error => error instanceof Error && /operating system denied/.test(error.message) && !error.message.includes(secret));
});

test('HTTPS status deadline includes a response body that never settles', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let signal!: AbortSignal;
  t.mock.method(globalThis, 'fetch', async (_url: any, options: any) => { signal = options.signal; assert.equal(options.redirect, 'error'); return { ok: true, json: never }; });
  const pending = readVpsStatus({ baseUrl: 'https://fixture.invalid' }, '/api/expert/status');
  const rejected = assert.rejects(pending, /VPS status read timed out/);
  await flush(); t.mock.timers.tick(15_000); await rejected; assert.equal(signal.aborted, true);
});

test('one timed-out worker preserves the other worker receipt and identifies the missing worker', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = observeProduction({ vps: { baseUrl: 'https://fixture.invalid' } }, undefined, { readStatus: async (_config, route) => route === '/api/expert/status' ? { is_running: false, manifest: { status: 'complete' } } : never() });
  await flush(); t.mock.timers.tick(30_000); const result = await pending;
  assert.equal(result.available, true); assert.deepEqual(result.items.map(item => item.id), ['expert']);
  assert.equal(result.errors[0].id, 'smart'); assert.match(result.errors[0].error, /Smart status observation timed out/);
});

test('expired observations never begin transport when credentials resolve late', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let resolveCredentials!: (value: any) => void; let reads = 0;
  const pending = observeProduction({ vps: { baseUrl: 'https://fixture.invalid' } }, () => new Promise(resolve => { resolveCredentials = resolve; }), { readStatus: async () => { reads++; return {}; } });
  await flush(); t.mock.timers.tick(30_000); const result = await pending;
  assert.equal(result.available, false); assert.equal(result.errors.length, 2);
  resolveCredentials({ baseUrl: 'https://fixture.invalid' }); await flush(); assert.equal(reads, 0);
});

test('cached observation timeouts settle and permit a fresh successful retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 }); let reads = 0; let failing = true;
  t.mock.method(globalThis, 'fetch', async (url: any) => { reads++; if (failing) return never(); return Response.json(String(url).endsWith('/api/expert/status') ? { is_running: false, manifest: {} } : { is_running: false }); });
  const routes = new Map<string, Function>(); const app: any = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, (path: string, handler: Function) => routes.set(`${method} ${path}`, handler)]));
  registerObservationRoutes(app, { readConfig: () => ({ vps: { baseUrl: 'https://fixture.invalid' } }), getGoogleAccessToken: never });
  const read = async (path: string) => { let value: any; await routes.get(`get ${path}`)!({}, { json: (data: any) => { value = data; } }); return value; };
  const first = read('/api/production/status'), shared = read('/api/pipeline/status');
  await flush(); assert.equal(reads, 2); t.mock.timers.tick(15_000);
  const [failed, cached] = await Promise.all([first, shared]); assert.equal(failed.available, false); assert.deepEqual(cached, failed);
  failing = false; t.mock.timers.tick(1); const retry = await read('/api/production/status'); assert.equal(retry.available, true); assert.equal(reads, 4);
});

test('Production GET requests settle when fetch or JSON parsing ignores abort', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return calls === 1 ? never() : { headers: new Headers({ 'Content-Type': 'application/json' }), ok: true, json: never }; });
  for (const route of ['/api/production/status', '/api/automations?view=schedules']) {
    const pending = request(route); const rejected = assert.rejects(pending, /production status check timed out/);
    await flush(); t.mock.timers.tick(40_000); await rejected;
  }
});

test('the status-read deadline never silently abandons writes or unrelated AI workflows', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let finish!: (value: any) => void; let response!: any;
  t.mock.method(globalThis, 'fetch', async () => { response = await new Promise(resolve => { finish = resolve; }); return response; });
  for (const [url, method] of [['/api/automations', 'POST'], ['/api/agent', 'POST'], ['/api/evidence', 'GET']]) {
    let settled = false; const pending = request(url, { method }).then(value => { settled = true; return value; });
    await flush(); t.mock.timers.tick(120_000); await flush(); assert.equal(settled, false);
    finish(Response.json({ ok: true })); assert.deepEqual(await pending, { ok: true });
  }
});

test('unexpected observation setup failures return a retryable response rather than escaping Express', async () => {
  const routes = new Map<string, Function>(); const app: any = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, (path: string, handler: Function) => routes.set(`${method} ${path}`, handler)]));
  registerObservationRoutes(app, { readConfig: () => { throw new Error('fixture-private-error'); }, getGoogleAccessToken: never });
  for (const path of ['/api/production/status', '/api/pipeline/status', '/api/automations']) {
    let status = 200; let data: any; const res: any = { status: (value: number) => { status = value; return res; }, json: (value: any) => { data = value; } };
    await routes.get(`get ${path}`)!({}, res); assert.equal(status, 503); assert.equal(data.available, false); assert.ok(!data.error.includes('fixture-private-error'));
  }
});
