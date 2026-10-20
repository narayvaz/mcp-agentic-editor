import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export const KEYCHAIN_REFERENCE_PREFIX = 'keychain://';
type Operation = { promise: Promise<string>; cancel: () => void };
type CommandOptions = { timeout: number; maxBuffer: number; encoding: 'utf8'; killSignal: 'SIGKILL' };
export type CredentialExecutor = (args: string[], options: CommandOptions) => Operation;

export class CredentialError extends Error {
  constructor(public code: 'CREDENTIAL_UNAVAILABLE' | 'CREDENTIAL_TIMEOUT' | 'CREDENTIAL_STORAGE_UNAVAILABLE', message: string) { super(message); this.name = 'CredentialError'; }
}

const executeSecurity: CredentialExecutor = (args, options) => {
  let child: ReturnType<typeof execFile>;
  const promise = new Promise<string>((resolve, reject) => {
    child = execFile('/usr/bin/security', args, options, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
  return { promise, cancel: () => { child?.kill('SIGKILL'); } };
};

/** Keychain values remain backend memory only. Metadata/configuration reads never invoke this store. */
export function createCredentialStore(options: { executor?: CredentialExecutor; platform?: string; timeoutMs?: number; cacheTtlMs?: number; now?: () => number } = {}) {
  const executor = options.executor ?? executeSecurity;
  const platform = options.platform ?? process.platform;
  const timeout = Math.max(1, Math.min(10_000, options.timeoutMs ?? 3000));
  const ttl = Math.max(0, Math.min(300_000, options.cacheTtlMs ?? 60_000));
  const now = options.now ?? Date.now;
  const cache = new Map<string, { value: string; expiresAt: number }>();
  const pending = new Map<string, Promise<string>>();
  const unavailable = (write = false) => new CredentialError('CREDENTIAL_UNAVAILABLE', write
    ? 'The system Keychain could not save the credential. Settings were not saved.'
    : 'A configured credential is unavailable from the system Keychain. Unlock it and check this application’s access before retrying.');
  const accountFromReference = (reference: string) => {
    const account = reference.slice(KEYCHAIN_REFERENCE_PREFIX.length);
    if (!account || account.length > 500 || /[\r\n\0]/.test(account)) throw unavailable();
    return account;
  };
  const run = async (args: string[], write: boolean): Promise<string> => {
    if (platform !== 'darwin') throw new CredentialError('CREDENTIAL_STORAGE_UNAVAILABLE', 'System Keychain storage is unavailable on this platform.');
    let operation: Operation;
    try { operation = executor(args, { timeout, maxBuffer: 512 * 1024, encoding: 'utf8', killSignal: 'SIGKILL' }); }
    catch { throw unavailable(write); }
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        try { operation.cancel(); } catch { /* A finished helper may already be gone. */ }
        reject(new CredentialError('CREDENTIAL_TIMEOUT', write
          ? 'The system Keychain save timed out. Settings were not saved.'
          : 'The system Keychain read timed out. Unlock it and check this application’s access before retrying.'));
      }, timeout);
    });
    try { return await Promise.race([operation.promise, deadline]); }
    catch (error) {
      if (error instanceof CredentialError) throw error;
      // execFile's own deadline can win the race. Never return its message/args/stderr.
      if ((error as any)?.killed === true) throw new CredentialError('CREDENTIAL_TIMEOUT', write ? 'The system Keychain save timed out. Settings were not saved.' : 'The system Keychain read timed out. Unlock it and check this application’s access before retrying.');
      throw unavailable(write);
    } finally { clearTimeout(timer!); }
  };
  return {
    async resolve(value: string | undefined | null): Promise<string> {
      const trimmed = (value ?? '').trim();
      if (!trimmed || !trimmed.startsWith(KEYCHAIN_REFERENCE_PREFIX)) return trimmed;
      const account = accountFromReference(trimmed);
      const cached = cache.get(account);
      if (cached && cached.expiresAt > now()) return cached.value;
      if (pending.has(account)) return pending.get(account)!;
      const promise = run(['find-generic-password', '-a', account, '-s', 'Azat Studio', '-w'], false).then(result => {
        const secret = result.trim();
        if (!secret) throw unavailable();
        cache.set(account, { value: secret, expiresAt: now() + ttl });
        return secret;
      }).finally(() => { pending.delete(account); });
      pending.set(account, promise);
      return promise;
    },
    async store(account: string, value: string | undefined | null): Promise<string> {
      const trimmed = (value ?? '').trim();
      if (!trimmed) return '';
      if (trimmed.startsWith(KEYCHAIN_REFERENCE_PREFIX)) { accountFromReference(trimmed); return trimmed; }
      if (!account || account.length > 300 || /[\r\n\0]/.test(account)) throw unavailable(true);
      const versioned = `${account}.${now()}.${randomUUID()}`;
      await run(['add-generic-password', '-a', versioned, '-s', 'Azat Studio', '-w', trimmed, '-U'], true);
      cache.set(versioned, { value: trimmed, expiresAt: now() + ttl });
      return `${KEYCHAIN_REFERENCE_PREFIX}${versioned}`;
    },
    clearCache() { cache.clear(); },
  };
}
