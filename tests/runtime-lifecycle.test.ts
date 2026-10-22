import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRendererUnloadHandler, createRuntimeQuitHandler, registerRuntimeQuitHandler } from '../electron/runtime-lifecycle.ts';

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

/** Model Electron's documented before-quit → window beforeunload → will-quit sequence. */
class QuitApplication extends EventEmitter {
  dirty = true;
  windowOpen = true;
  exits: number[] = [];
  quit() {
    const event = () => ({ prevented: false, preventDefault() { this.prevented = true; } });
    const before = event(); this.emit('before-quit', before);
    if (before.prevented || this.windowOpen && this.dirty) return;
    this.windowOpen = false;
    const will = event(); this.emit('will-quit', will);
    if (!will.prevented) this.exit(0);
  }
  exit(code: number) {
    assert.equal(this.windowOpen, false, 'Exit must never bypass a renderer unload decision.');
    this.exits.push(code);
  }
}

test('a dirty renderer veto leaves the backend usable until every window accepts quit', async () => {
  const app = new QuitApplication(), stopped = deferred();
  let backendAvailable = true, shutdowns = 0;
  const lifecycle = registerRuntimeQuitHandler(app, {
    shutdown: async () => { shutdowns++; backendAvailable = false; await stopped.promise; },
  });
  app.quit(); await flush();
  assert.equal(app.windowOpen, true); assert.equal(backendAvailable, true);
  assert.equal(shutdowns, 0); assert.equal(lifecycle.isStopping(), false); assert.deepEqual(app.exits, []);

  app.dirty = false; app.quit(); await flush();
  assert.equal(app.windowOpen, false); assert.equal(backendAvailable, false);
  assert.equal(shutdowns, 1); assert.equal(lifecycle.isStopping(), true); assert.deepEqual(app.exits, []);
  app.quit(); await flush(); assert.equal(shutdowns, 1);
  stopped.resolve(); await flush(); assert.deepEqual(app.exits, [0]);
});

test('after renderer consent a stalled backend exits within its bound without a second quit cycle', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = new QuitApplication(), stopped = deferred(); let shutdowns = 0;
  registerRuntimeQuitHandler(app, { shutdown: () => { shutdowns++; return stopped.promise; }, timeoutMs: 50 });
  app.quit(); await flush(); t.mock.timers.tick(100); await flush();
  assert.equal(shutdowns, 0); assert.equal(app.windowOpen, true); assert.deepEqual(app.exits, []);
  app.dirty = false; app.quit(); await flush();
  t.mock.timers.tick(49); await flush(); assert.deepEqual(app.exits, []);
  t.mock.timers.tick(1); await flush(); assert.deepEqual(app.exits, [0]);
  assert.equal(shutdowns, 1); stopped.resolve(); await flush(); assert.deepEqual(app.exits, [0]);
});

test('renderer unload is permitted only by explicit discard, never cancel or a failed dialog', () => {
  let unloads = 0;
  const event = { preventDefault() { unloads++; } };
  createRendererUnloadHandler(() => false)(event); assert.equal(unloads, 0);
  createRendererUnloadHandler(() => { throw Error('Dialog unavailable.'); })(event); assert.equal(unloads, 0);
  createRendererUnloadHandler(() => true)(event); assert.equal(unloads, 1);
});
