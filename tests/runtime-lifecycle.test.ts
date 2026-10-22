import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeQuitHandler } from '../electron/runtime-lifecycle.ts';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };

test('desktop quit waits for a deferred backend import and shuts down exactly once', async () => {
  const imported = deferred(), stopped = deferred(); let prevented = 0, shutdowns = 0, quits = 0;
  const handler = createRuntimeQuitHandler({ shutdown: async () => { await imported.promise; shutdowns++; await stopped.promise; }, quit: () => { quits++; handler({ preventDefault() { assert.fail('The final quit must not be prevented.'); } }); } });
  const event = { preventDefault() { prevented++; } };
  handler(event); handler(event); await flush(); assert.equal(prevented, 2); assert.equal(quits, 0); assert.equal(shutdowns, 0);
  imported.resolve(); await flush(); assert.equal(shutdowns, 1); assert.equal(quits, 0);
  stopped.resolve(); await flush(); assert.equal(quits, 1);
});

test('desktop quit deadline survives a backend that never settles and ignores late completion', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stopped = deferred(); let quits = 0;
  const handler = createRuntimeQuitHandler({ shutdown: () => stopped.promise, quit: () => { quits++; }, timeoutMs: 50 });
  handler({ preventDefault() {} }); await flush(); t.mock.timers.tick(49); await flush(); assert.equal(quits, 0);
  t.mock.timers.tick(1); await flush(); assert.equal(quits, 1);
  stopped.resolve(); await flush(); assert.equal(quits, 1);
});

test('a rejected shutdown still permits quit without exposing its error', async () => {
  let quits = 0;
  createRuntimeQuitHandler({ shutdown: async () => { throw new Error('private provider details'); }, quit: () => { quits++; } })({ preventDefault() {} });
  await flush(); assert.equal(quits, 1);
});
