/** Run only after windows close, so renderer unload vetoes cannot stop a live backend. */
export function createRuntimeQuitHandler(options: { shutdown: () => Promise<unknown>; quit: () => void; timeoutMs?: number }) {
  let stopping = false, allowed = false;
  return (event: { preventDefault(): void }) => {
    if (allowed) return;
    event.preventDefault();
    if (stopping) return;
    stopping = true;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<void>(resolve => { timer = setTimeout(resolve, Math.max(1, options.timeoutMs ?? 4000)); });
    const work = Promise.resolve().then(options.shutdown).catch(() => {});
    void Promise.race([work, deadline]).then(() => {
      clearTimeout(timer); allowed = true; options.quit();
    });
  };
}

type RuntimeQuitEvent = { preventDefault(): void };
type RuntimeQuitApplication = {
  on(event: 'will-quit', listener: (event: RuntimeQuitEvent) => void): unknown;
  exit(code: number): void;
};

/** Electron emits will-quit only after every window has accepted its unload. */
export function registerRuntimeQuitHandler(app: RuntimeQuitApplication, options: { shutdown: () => Promise<unknown>; timeoutMs?: number }) {
  let stopping = false;
  const handle = createRuntimeQuitHandler({ ...options, quit: () => app.exit(0) });
  app.on('will-quit', event => {
    stopping = true;
    handle(event);
  });
  return { isStopping: () => stopping };
}

/** Electron's preventDefault here permits unload: do so only after explicit discard. */
export function createRendererUnloadHandler(confirmDiscard: () => boolean) {
  return (event: RuntimeQuitEvent) => {
    let discard = false;
    try { discard = confirmDiscard(); } catch { /* A failed dialog must preserve unsaved changes. */ }
    if (discard === true) event.preventDefault();
  };
}
