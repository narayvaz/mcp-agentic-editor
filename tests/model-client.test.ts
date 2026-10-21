import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyModelError, generateWithBoundedFallback, ModelRequestError, type ModelErrorCode } from '../server/model-client.ts';

const flush = async () => { for (let index = 0; index < 24; index++) await Promise.resolve(); };
const deferred = () => {
  let resolve!: (value: { text?: string }) => void, reject!: (error: unknown) => void;
  const promise = new Promise<{ text?: string }>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const hasCode = (code: ModelErrorCode) => (error: unknown) => error instanceof ModelRequestError && error.code === code;

test('only configured models are attempted, deduplicated, and the actual answering model is recorded', async () => {
  const calls: string[] = [];
  const ai = { models: { generateContent: async (input: any) => {
    calls.push(input.model);
    if (input.model === 'first') throw Object.assign(new Error('private provider body'), { status: 503 });
    if (input.model === 'second') return { text: ' ' };
    return { text: ' Reviewed response\n' };
  } } };
  const result = await generateWithBoundedFallback(ai, 'first', ['first', 'second', 'third', 'second'], [], 0.2);
  assert.deepEqual(calls, ['first', 'second', 'third']);
  assert.equal(result.modelUsed, 'third'); assert.equal(result.fallback, true);
  assert.equal(result.text, ' Reviewed response\n'); assert.match(result.warning!, /configured fallback third/);
});

test('a sole configured model may finish after 30 seconds and successful cleanup leaves it un-aborted', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const work = deferred(); let calls = 0, signal!: AbortSignal, settled = false;
  const ai = { models: { generateContent: (input: any) => { calls++; signal = input.config.abortSignal; return work.promise; } } };
  const pending = generateWithBoundedFallback(ai, 'same', ['same'], [], 0.2).then(value => { settled = true; return value; });
  await flush(); t.mock.timers.tick(45_000); await flush();
  assert.equal(settled, false); assert.equal(signal.aborted, false);
  work.resolve({ text: 'Detailed answer' }); const result = await pending;
  assert.equal(result.text, 'Detailed answer'); assert.equal(result.fallback, false); assert.equal(result.warning, undefined); assert.equal(calls, 1);
  t.mock.timers.tick(100_000); await flush(); assert.equal(signal.aborted, false);
});

test('an ignored primary abort settles at 60 seconds and leaves time for the configured fallback', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const primary = deferred(); const calls: string[] = []; const signals: AbortSignal[] = [];
  const ai = { models: { generateContent: (input: any) => {
    calls.push(input.model); signals.push(input.config.abortSignal);
    return input.model === 'primary' ? primary.promise : Promise.resolve({ text: 'Fallback answer' });
  } } };
  const pending = generateWithBoundedFallback(ai, 'primary', 'fallback', [], 0.2);
  await flush(); t.mock.timers.tick(59_999); await flush(); assert.deepEqual(calls, ['primary']);
  t.mock.timers.tick(1); await flush(); const result = await pending;
  assert.deepEqual(calls, ['primary', 'fallback']); assert.equal(signals[0].aborted, true); assert.equal(signals[1].aborted, false);
  assert.equal(result.modelUsed, 'fallback'); primary.resolve({ text: 'Late primary answer' }); await flush();
  assert.equal(result.text, 'Fallback answer');
});

test('the total deadline settles when both providers ignore abort and ignores their late outcomes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const work = [deferred(), deferred()]; const signals: AbortSignal[] = []; let calls = 0, settled = false;
  const ai = { models: { generateContent: (input: any) => { signals.push(input.config.abortSignal); return work[calls++].promise; } } };
  const pending = generateWithBoundedFallback(ai, 'primary', 'fallback', [], 0.2);
  const rejected = assert.rejects(pending, hasCode('MODEL_TIMEOUT')).then(() => { settled = true; });
  await flush(); t.mock.timers.tick(60_000); await flush(); assert.equal(calls, 2);
  t.mock.timers.tick(29_999); await flush(); assert.equal(settled, false);
  t.mock.timers.tick(1); await rejected; assert.ok(signals.every(signal => signal.aborted));
  work[0].reject(new Error('late private rejection')); work[1].resolve({ text: 'Late answer' }); await flush();
  assert.equal(calls, 2);
});

test('an early primary error leaves its unused time to fallback without resetting the total deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const primary = deferred(), fallback = deferred(); let calls = 0, settled = false;
  const ai = { models: { generateContent: () => calls++ === 0 ? primary.promise : fallback.promise } };
  const pending = generateWithBoundedFallback(ai, 'primary', 'fallback', [], 0.2);
  const rejected = assert.rejects(pending, hasCode('MODEL_TIMEOUT')).then(() => { settled = true; });
  await flush(); t.mock.timers.tick(15_000); primary.reject({ status: 503 }); await flush(); assert.equal(calls, 2);
  t.mock.timers.tick(74_999); await flush(); assert.equal(settled, false);
  t.mock.timers.tick(1); await rejected;
});

test('cancellation before work starts never calls a model', async () => {
  const abort = new AbortController(); abort.abort(new Error('private cancellation reason')); let calls = 0;
  await assert.rejects(generateWithBoundedFallback({ models: { generateContent: async () => { calls++; return { text: 'Unexpected' }; } } },
    'primary', 'fallback', [], 0.2, 1000, abort.signal), hasCode('MODEL_CANCELLED'));
  assert.equal(calls, 0);
});

test('external cancellation settles immediately even when the provider ignores abort and never starts fallback', async () => {
  const abort = new AbortController(), work = deferred(); let calls = 0, signal!: AbortSignal;
  const ai = { models: { generateContent: (input: any) => { calls++; signal = input.config.abortSignal; return work.promise; } } };
  const pending = generateWithBoundedFallback(ai, 'primary', 'fallback', [], 0.2, 90_000, abort.signal);
  const rejected = assert.rejects(pending, hasCode('MODEL_CANCELLED'));
  await flush(); abort.abort(new Error('private cancellation reason')); await rejected;
  assert.equal(signal.aborted, true); assert.equal(calls, 1);
  work.reject(new Error('late private rejection')); await flush(); assert.equal(calls, 1);
});

test('empty, blank and missing text never become apparent success', async () => {
  for (const text of ['', ' \n ', undefined]) {
    await assert.rejects(generateWithBoundedFallback({ models: { generateContent: async () => ({ text }) } }, 'first', [], [], 0.2), error =>
      hasCode('MODEL_EMPTY_OUTPUT')(error) && /usable output/.test((error as Error).message));
  }
});

test('provider statuses become fixed categories and never return raw values or nested causes', () => {
  const secret = 'fixture-private-key /private/credential.json https://provider.invalid?key=fixture-private-key';
  const cases: [unknown, ModelErrorCode][] = [
    [{ status: 401, message: secret }, 'MODEL_AUTH'],
    [{ code: 403, message: secret }, 'MODEL_AUTH'],
    [{ status: 429, message: secret }, 'MODEL_RATE_LIMIT'],
    [{ status: 'RESOURCE_EXHAUSTED', message: secret }, 'MODEL_RATE_LIMIT'],
    [{ error: { code: 503, status: 'UNAVAILABLE', message: secret } }, 'MODEL_UNAVAILABLE'],
    [{ status: 503, cause: { status: 401, message: secret } }, 'MODEL_UNAVAILABLE'],
    [{ status: 429, error: { code: 403, message: secret } }, 'MODEL_RATE_LIMIT'],
    [new Error(JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE', message: secret, details: [{ secret }] } })), 'MODEL_UNAVAILABLE'],
    [new Error('Provider rejected: ' + JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE', message: secret } })), 'MODEL_UNAVAILABLE'],
    [{ status: 504, message: secret }, 'MODEL_TIMEOUT'],
    [{ name: 'TimeoutError', message: secret }, 'MODEL_TIMEOUT'],
    [{ name: 'TypeError', cause: { code: 'UND_ERR_CONNECT_TIMEOUT', message: secret } }, 'MODEL_TIMEOUT'],
    [{ status: 400, message: secret }, 'MODEL_INVALID_REQUEST'],
    [{ code: 413, message: secret }, 'MODEL_INVALID_REQUEST'],
    [{ status: 'INVALID_ARGUMENT', message: secret }, 'MODEL_INVALID_REQUEST'],
    [{ cause: { code: 'ECONNRESET', message: secret } }, 'MODEL_UNAVAILABLE'],
    [new Error(secret), 'MODEL_PROVIDER_ERROR'],
    [{ code: 'MODEL_AUTH', message: secret }, 'MODEL_PROVIDER_ERROR'],
    [{ get status() { throw new Error(secret); }, message: secret }, 'MODEL_PROVIDER_ERROR'],
  ];
  for (const [input, expected] of cases) {
    const error = classifyModelError(input);
    assert.equal(error.code, expected); assert.ok(error instanceof ModelRequestError);
    assert.equal(error.message, new ModelRequestError(expected).message);
    assert.equal('cause' in error, false); assert.equal(JSON.stringify(error).includes(secret), false); assert.equal(String(error).includes(secret), false);
  }
});

test('typed errors are reconstructed so altered messages or forged codes cannot escape', () => {
  const secret = 'private-provider-message'; const original = new ModelRequestError('MODEL_AUTH');
  original.message = secret; (original as any).cause = { secret };
  const safe = classifyModelError(original); assert.equal(safe.code, 'MODEL_AUTH'); assert.equal(safe.retryable, false);
  assert.equal(safe.message.includes(secret), false); assert.equal('cause' in safe, false);
  assert.equal(new ModelRequestError('FORGED_PRIVATE_CODE' as ModelErrorCode).code, 'MODEL_PROVIDER_ERROR');
  assert.equal(classifyModelError({ status: 503 }).retryable, true);
});

test('the helper preserves the last configured provider category without retaining its error body', async () => {
  const secret = 'fixture-secret-never-return'; const calls: string[] = [];
  const ai = { models: { generateContent: async (input: any) => { calls.push(input.model); throw new Error(JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE', message: secret } })); } } };
  await assert.rejects(generateWithBoundedFallback(ai, 'primary', 'fallback', [], 0.2), error =>
    hasCode('MODEL_UNAVAILABLE')(error) && !(error as Error).message.includes(secret));
  assert.deepEqual(calls, ['primary', 'fallback']);
});
