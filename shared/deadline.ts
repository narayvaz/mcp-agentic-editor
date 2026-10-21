export class ReadDeadlineError extends Error {
  constructor(message: string) { super(message); this.name = 'TimeoutError'; }
}

/** Settle independently of a provider's abort support, including response-body reads. */
export async function withReadDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>, timeoutMs: number, message: string,
  options: { signal?: AbortSignal; onTimeout?: () => void } = {},
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    const cancel = () => {
      const error = new Error('The read was cancelled.'); error.name = 'AbortError';
      reject(error); controller.abort(error);
    };
    onAbort = cancel;
    if (options.signal?.aborted) { cancel(); return; }
    options.signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => {
      const error = new ReadDeadlineError(message);
      reject(error); controller.abort(error);
      try { options.onTimeout?.(); } catch { /* Cleanup must not prevent settlement. */ }
    }, Math.max(1, timeoutMs));
  });
  const work = Promise.resolve().then(() => {
    if (controller.signal.aborted) throw controller.signal.reason;
    return run(controller.signal);
  });
  try { return await Promise.race([work, interrupted]); }
  finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) options.signal?.removeEventListener('abort', onAbort);
  }
}
