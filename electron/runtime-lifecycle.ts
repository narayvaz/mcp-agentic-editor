/** Electron-independent quit coordination, so a stalled backend cannot trap the desktop. */
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
