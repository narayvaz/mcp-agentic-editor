import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { Express, Request, Response } from 'express';

export type ProposalStatus = 'pending' | 'validating' | 'validated' | 'failed' | 'cancelled' | 'rejected' | 'expired' | 'interrupted';
export interface CheckResult { name: string; passed: boolean; detail: string; }
export interface Proposal {
  id: string; createdAt: string; expiresAt: string; targetFile: string;
  instruction: string; summary: string; diffPreview: string;
  baselineRoot: string; baselineHash: string; candidateHash: string; originalHash: string; updatedHash: string;
  status: ProposalStatus; checks: CheckResult[]; error?: string;
  validatedAt?: string; artifactDirectory?: string; manifestPath?: string;
}
interface Store { version: 1; proposals: Proposal[]; }
export interface ControllerConfig { enabled: boolean; workspaceRoot: string; }
export interface ValidationContext {
  workspacePath: string; baselineRoot: string; signal: AbortSignal;
  log: (message: string) => void; assertCurrent: () => void;
}
export interface SelfDevelopmentOptions {
  getConfig: () => ControllerConfig;
  stateRoot?: string;
  generate: (request: { instruction: string; targetFile: string; originalContent: string; signal: AbortSignal }) => Promise<{ summary: string; updatedContent: string }>;
  validate?: (context: ValidationContext) => Promise<CheckResult[]>;
  now?: () => number;
  log?: (message: string) => void;
}
export class WorkflowError extends Error {
  constructor(message: string, public statusCode = 409) { super(message); }
}
export const hashText = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const excludedDirectories = new Set(['node_modules', '.git', 'dist', 'dist-server', 'dist-electron', 'release', 'backups', 'logs', 'work', '.cache']);
const sensitiveName = /(^\.env(?:\.|$))|(?:credentials?|secrets?|service[-_]?account)|^(?:config|settings)\.json$|\.log$/i;
const copyExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.html', '.md', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.woff', '.woff2', '.ico']);

export function assertEditableTarget(root: string, relative: string): string {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').includes('..')) {
    throw new WorkflowError('Choose a relative frontend source file.', 400);
  }
  const normalized = path.posix.normalize(relative);
  // The release controller, authentication, server, Electron and build scripts are outside this capability.
  if (!/^src\/(?:components\/.+\.(?:tsx|ts)|index\.css)$/.test(normalized) || sensitiveName.test(path.basename(normalized)) || /(?:^|\/)Settings\.tsx$/i.test(normalized)) {
    throw new WorkflowError('This controller may propose frontend components and src/index.css only. Runtime, authentication and release code are protected.', 403);
  }
  const base = fs.realpathSync(root);
  let cursor = base;
  for (const segment of normalized.split('/')) {
    cursor = path.join(cursor, segment);
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new WorkflowError('Symlink targets cannot be edited.', 403);
  }
  const real = fs.realpathSync(cursor);
  if (!real.startsWith(base + path.sep) || !fs.statSync(real).isFile()) throw new WorkflowError('Target must be a regular file within the configured workspace.', 403);
  return real;
}

async function snapshotFiles(root: string): Promise<Array<{ relative: string; content: Buffer }>> {
  const output: Array<{ relative: string; content: Buffer }> = [];
  let total = 0;
  async function visit(directory: string, relative = ''): Promise<void> {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        if (!excludedDirectories.has(entry.name)) throw new WorkflowError(`Source symlinks are not accepted: ${rel}`, 403);
        continue;
      }
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name) && !entry.name.startsWith('.')) await visit(path.join(directory, entry.name), rel);
      } else if (entry.isFile() && !entry.name.startsWith('.') && !sensitiveName.test(entry.name) && copyExtensions.has(path.extname(entry.name))) {
        const content = await fsp.readFile(path.join(directory, entry.name));
        total += content.length;
        if (content.length > 25 * 1024 * 1024 || total > 300 * 1024 * 1024) throw new WorkflowError('Workspace snapshot exceeds the bounded staging size.', 413);
        output.push({ relative: rel, content });
      }
    }
  }
  await visit(root);
  return output.sort((a, b) => a.relative.localeCompare(b.relative));
}
function fingerprint(files: Array<{ relative: string; content: Buffer }>): string {
  return hashText(files.map(file => `${file.relative}\0${hashText(file.content)}`).join('\n'));
}
function diff(before: string, after: string): string {
  const left = before.split('\n'), right = after.split('\n'), lines: string[] = [];
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    if (left[index] === right[index]) continue;
    if (left[index] !== undefined) lines.push(`- ${index + 1}: ${left[index]}`);
    if (right[index] !== undefined) lines.push(`+ ${index + 1}: ${right[index]}`);
  }
  return lines.join('\n');
}

/** No shell, inherited provider credentials, package lifecycle scripts or shared build directory. */
export async function runIsolatedCommand(command: string, args: string[], cwd: string, signal: AbortSignal, timeoutMs = 180_000): Promise<{ code: number; output: string }> {
  if (signal.aborted) throw new WorkflowError('Operation cancelled.');
  const privateHome = path.join(cwd, '.validation-home');
  await fsp.mkdir(path.join(privateHome, 'tmp'), { recursive: true, mode: 0o700 });
  if (process.platform !== 'darwin' || !fs.existsSync('/usr/bin/sandbox-exec')) throw new WorkflowError('The required operating-system validation sandbox is unavailable. No check was passed.');
  const literal = (value: string) => JSON.stringify(value);
  const runtimeRoots = process.execPath.includes('.app/Contents/')
    ? [path.dirname(process.execPath), process.execPath.split('.app/Contents/')[0] + '.app/Contents/Frameworks']
    : [path.dirname(fs.realpathSync(process.execPath))];
  const readRoots = [fs.realpathSync(cwd), ...runtimeRoots, '/System', '/usr', '/bin', '/sbin', '/Library/Apple', '/Library/Developer/CommandLineTools', '/opt/homebrew'];
  // dyld needs directory data on the literal root while starting even /bin/echo.
  // Granting '/' as a subpath would expose every private file; only the directory itself is readable.
  const profile = `(version 1)(deny default)(allow process*)(allow sysctl-read)(allow file-read-metadata)(allow file-write* (subpath "/dev"))(allow mach-lookup)(deny mach-lookup (global-name "com.apple.securityd") (global-name "com.apple.securityd.xpc") (global-name "com.apple.security.agent"))(allow file-read* (literal "/") ${readRoots.map(root => `(subpath ${literal(root)})`).join(' ')})(allow file-write* (subpath ${literal(fs.realpathSync(cwd))}))(allow file-read* file-write* (literal "/dev/null") (literal "/dev/urandom"))`;
  return new Promise((resolve, reject) => {
    let output = '', settled = false;
    const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, command, ...args], {
      cwd, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin`, HOME: privateHome, TMPDIR: path.join(privateHome, 'tmp'), XDG_CACHE_HOME: path.join(privateHome, 'cache'), NODE_ENV: 'production', CI: 'true', ELECTRON_RUN_AS_NODE: '1', AZAT_VALIDATION_SANDBOX: '1' },
    });
    let killed = false;
    const stopGroup = (signal: NodeJS.Signals) => { try { if (child.pid) process.kill(-child.pid, signal); } catch { child.kill(signal); } };
    const kill = () => { killed = true; stopGroup('SIGTERM'); };
    const timer = setTimeout(kill, timeoutMs);
    const forceTimer = setTimeout(() => { if (!settled) stopGroup('SIGKILL'); }, timeoutMs + 2000);
    const cancel = () => { kill(); setTimeout(() => { if (!settled) stopGroup('SIGKILL'); }, 2000).unref(); };
    signal.addEventListener('abort', cancel, { once: true });
    const finish = () => { settled = true; clearTimeout(timer); clearTimeout(forceTimer); signal.removeEventListener('abort', cancel); };
    child.stdout.on('data', data => { output = (output + String(data)).slice(-64_000); });
    child.stderr.on('data', data => { output = (output + String(data)).slice(-64_000); });
    child.on('error', error => { finish(); reject(error); });
    child.on('close', code => {
      finish();
      if (signal.aborted) return reject(new WorkflowError('Operation cancelled.'));
      if (killed) return reject(new WorkflowError('Validation exceeded its time limit.'));
      resolve({ code: code ?? 1, output });
    });
  });
}

export async function validateStagedWorkspace(context: ValidationContext): Promise<CheckResult[]> {
  const { workspacePath, baselineRoot, signal, assertCurrent, log } = context;
  const sourceModules = path.join(baselineRoot, 'node_modules');
  if (!fs.existsSync(sourceModules)) throw new WorkflowError('Validation unavailable: dependencies are absent. No check was passed.');
  // Copy dependencies, rather than symlinking them: bundlers may write cache files into node_modules.
  assertCurrent();
  log('Preparing private validation dependencies.');
  await fsp.cp(await fsp.realpath(sourceModules), path.join(workspacePath, 'node_modules'), {
    recursive: true, dereference: false, mode: fs.constants.COPYFILE_FICLONE,
    filter: source => !/[/\\](?:\.cache|\.vite-temp)(?:[/\\]|$)/.test(source) && !/[/\\]electron[/\\]dist(?:[/\\]|$)/.test(source),
  });
  assertCurrent();
  const checks: CheckResult[] = [];
  const testsDirectory = path.join(workspacePath, 'tests');
  // Host boundary probes exercise sandbox-exec itself. Nested macOS sandboxes cannot
  // reapply that mechanism; they are run separately by the full host regression suite.
  const testFiles = fs.existsSync(testsDirectory) ? fs.readdirSync(testsDirectory).filter(file => file.endsWith('.test.ts') && !file.endsWith('.host.test.ts')).map(file => `tests/${file}`) : [];
  if (!testFiles.length) throw new WorkflowError('Required behavioral regression tests are absent. Validation failed closed.');
  const tools = [
    // The tsx CLI opens an IPC socket. Node's import loader needs no network allowance.
    { name: 'Behavioral regressions', file: 'tsx/dist/loader.mjs', args: ['--test', ...testFiles], loader: true },
    { name: 'TypeScript', file: 'typescript/bin/tsc', args: ['--noEmit'] },
    { name: 'Backend build', file: 'tsup/dist/cli-default.js', args: ['server.ts', '--out-dir', 'dist-server', '--format', 'esm', '--clean'] },
    { name: 'Frontend build', file: 'vite/bin/vite.js', args: ['build'] },
  ];
  for (const tool of tools) {
    assertCurrent();
    const entry = path.join(workspacePath, 'node_modules', tool.file);
    if (!fs.existsSync(entry)) throw new WorkflowError(`Required ${tool.name} tool is absent. Validation failed closed.`);
    log(`Running ${tool.name} in the isolated candidate.`);
    const args = tool.loader ? ['--import', entry, ...tool.args] : [entry, ...tool.args];
    const result = await runIsolatedCommand(process.execPath, args, workspacePath, signal);
    const check = { name: tool.name, passed: result.code === 0, detail: result.code === 0 ? tool.name === 'Behavioral regressions' ? 'Core behavior tests passed in the isolated candidate. Host-level sandbox boundary probes require the separate host suite.' : 'Passed in the isolated candidate.' : result.output.slice(-5000) || `Exited ${result.code}` };
    checks.push(check);
    if (!check.passed) return checks;
  }
  for (const artifact of ['dist/index.html', 'dist-server/server.js']) {
    if (!fs.existsSync(path.join(workspacePath, artifact))) checks.push({ name: artifact, passed: false, detail: 'Expected build artifact was not produced.' });
  }
  return checks;
}

export function createSelfDevelopmentController(options: SelfDevelopmentOptions) {
  const now = options.now || Date.now;
  const stateRoot = options.stateRoot || process.env.AZAT_STATE_DIR || path.join(os.homedir(), '.mcp-agentic-editor');
  const root = path.join(stateRoot, 'self-development');
  const stateFile = path.join(root, 'state.json');
  const lockFile = path.join(root, 'operation.lock');
  let active: { id: string; label: string; startedAt: number; controller: AbortController } | null = null;
  let recovered = false;
  const log = (message: string) => options.log?.(`[SELF-DEVELOPMENT] ${message}`);
  function readStore(): Store {
    if (!fs.existsSync(stateFile)) return { version: 1, proposals: [] };
    try {
      const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (parsed.version !== 1 || !Array.isArray(parsed.proposals)) throw new Error('Unexpected state shape');
      return parsed;
    } catch { throw new WorkflowError('Candidate state is unreadable. Preserve it for recovery; no automatic reset was performed.', 503); }
  }
  function writeStore(store: Store) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const temp = `${stateFile}.${randomUUID()}.tmp`;
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(store, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, stateFile);
  }
  function recover() {
    if (recovered) return;
    // A different live process may own this state. Never rewrite its in-progress journal.
    if (fs.existsSync(lockFile)) {
      let owner: { pid: number };
      try { owner = JSON.parse(fs.readFileSync(lockFile, 'utf8')); } catch { throw new WorkflowError('Candidate lock is unreadable. Preserve it for operator recovery.', 503); }
      try { process.kill(owner.pid, 0); return; } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw new WorkflowError('Candidate lock owner cannot be verified.', 503);
        fs.unlinkSync(lockFile);
      }
    }
    const store = readStore();
    let changed = false;
    for (const proposal of store.proposals) if (proposal.status === 'validating') {
      proposal.status = 'interrupted'; proposal.error = 'Validation was interrupted. Nothing was activated; create a fresh proposal.'; changed = true;
    }
    if (changed) writeStore(store);
    recovered = true;
  }
  function list() { recover(); return readStore().proposals.slice().reverse(); }
  function update(proposal: Proposal) {
    const store = readStore();
    const index = store.proposals.findIndex(item => item.id === proposal.id);
    if (index < 0) store.proposals.push(proposal); else store.proposals[index] = proposal;
    writeStore(store);
  }
  function configuredRoot(requireEnabled = true): string {
    const config = options.getConfig();
    if (requireEnabled && !config.enabled) throw new WorkflowError('Self-development is disabled. No file was changed.', 403);
    const configured = process.env.AZAT_WORKSPACE_ROOT || config.workspaceRoot;
    if (!configured || !fs.existsSync(configured)) throw new WorkflowError('A valid source workspace is required.', 400);
    return fs.realpathSync(configured);
  }
  function assertCurrent(signal: AbortSignal, baselineRoot?: string) {
    if (signal.aborted) throw new WorkflowError('Operation cancelled.');
    const current = configuredRoot();
    if (baselineRoot && current !== baselineRoot) throw new WorkflowError('The configured workspace changed. Create a fresh proposal.');
  }
  async function withLock<T>(label: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    recover();
    if (active) throw new WorkflowError(`Another candidate operation is running (${active.label}). Cancel it or wait.`);
    const operation = { id: randomUUID(), label, startedAt: now(), controller: new AbortController() };
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    let lock: number;
    try { lock = fs.openSync(lockFile, 'wx', 0o600); }
    catch { throw new WorkflowError('A candidate operation is already owned by another process.'); }
    try { fs.writeFileSync(lock, JSON.stringify({ id: operation.id, pid: process.pid, startedAt: operation.startedAt })); fs.fsyncSync(lock); }
    finally { fs.closeSync(lock); }
    active = operation;
    try { assertCurrent(operation.controller.signal); return await work(operation.controller.signal); }
    finally {
      if (active?.id === operation.id) active = null;
      try { const owner = JSON.parse(fs.readFileSync(lockFile, 'utf8')); if (owner.id === operation.id) fs.unlinkSync(lockFile); } catch { /* retain an unverifiable lock for operator recovery */ }
    }
  }
  function operationStatus() {
    return { active: Boolean(active), operationId: active?.id || null, label: active?.label || null, startedAt: active ? new Date(active.startedAt).toISOString() : null, heartbeatAt: null, elapsedSeconds: active ? Math.floor((now() - active.startedAt) / 1000) : 0, idleSeconds: 0, mode: 'proposal-only', enabled: options.getConfig().enabled, activationEnabled: false };
  }
  async function propose(input: { targetFile: string; instruction: string; workspacePath?: string }) {
    return withLock('Prepare proposal', async signal => {
      const baselineRoot = configuredRoot();
      if (input.workspacePath && fs.realpathSync(input.workspacePath) !== baselineRoot) throw new WorkflowError('Requests cannot override the configured workspace.', 403);
      if (!input.instruction?.trim()) throw new WorkflowError('Describe the requested improvement.', 400);
      const target = assertEditableTarget(baselineRoot, input.targetFile);
      const targetFile = path.relative(baselineRoot, target).split(path.sep).join('/');
      const originalContent = await fsp.readFile(target, 'utf8');
      if (originalContent.length > 200_000) throw new WorkflowError('Choose a source file below 200 KB.', 413);
      const files = await snapshotFiles(baselineRoot);
      assertCurrent(signal, baselineRoot);
      log(`Preparing an isolated proposal for ${targetFile}.`);
      const result = await options.generate({ instruction: input.instruction.trim(), targetFile, originalContent, signal });
      assertCurrent(signal, baselineRoot);
      if (!result.updatedContent || result.updatedContent.length > 400_000) throw new WorkflowError('Model returned invalid candidate content.', 422);
      if (result.updatedContent === originalContent) throw new WorkflowError('No source change was proposed.', 422);
      const proposal: Proposal = {
        id: `candidate-${randomUUID()}`, createdAt: new Date(now()).toISOString(), expiresAt: new Date(now() + 24 * 60 * 60 * 1000).toISOString(),
        targetFile, instruction: input.instruction.trim(), summary: result.summary || 'Requested frontend improvement', diffPreview: diff(originalContent, result.updatedContent),
        baselineRoot, baselineHash: fingerprint(files), candidateHash: fingerprint(files.map(file => file.relative === targetFile ? { ...file, content: Buffer.from(result.updatedContent) } : file)), originalHash: hashText(originalContent), updatedHash: hashText(result.updatedContent), status: 'pending', checks: [],
      };
      const directory = path.join(root, 'proposals', proposal.id);
      const workspacePath = path.join(directory, 'workspace');
      await fsp.mkdir(workspacePath, { recursive: true, mode: 0o700 });
      for (const file of files) {
        assertCurrent(signal, baselineRoot);
        const destination = path.join(workspacePath, file.relative);
        await fsp.mkdir(path.dirname(destination), { recursive: true });
        await fsp.writeFile(destination, file.relative === targetFile ? result.updatedContent : file.content, { mode: 0o600 });
      }
      await fsp.writeFile(path.join(directory, 'original.txt'), originalContent, { mode: 0o600 });
      await fsp.writeFile(path.join(directory, 'candidate.txt'), result.updatedContent, { mode: 0o600 });
      assertCurrent(signal, baselineRoot);
      update(proposal);
      log(`Proposal ${proposal.id} is ready for exact-diff review. Active source is unchanged.`);
      return proposal;
    });
  }
  async function approve(id: string, approvedHash: string) {
    return withLock('Validate reviewed candidate', async signal => {
      const proposal = list().find(item => item.id === id);
      if (!proposal) throw new WorkflowError('Proposal not found.', 404);
      if (proposal.status !== 'pending') throw new WorkflowError(`Proposal is ${proposal.status}; approval cannot be replayed.`);
      if (new Date(proposal.expiresAt).getTime() <= now()) { proposal.status = 'expired'; update(proposal); throw new WorkflowError('Proposal expired. Create a fresh proposal.', 410); }
      if (!approvedHash || approvedHash !== proposal.updatedHash) throw new WorkflowError('The approval hash must match the exact reviewed candidate.', 403);
      assertCurrent(signal, proposal.baselineRoot);
      assertEditableTarget(proposal.baselineRoot, proposal.targetFile);
      if (fingerprint(await snapshotFiles(proposal.baselineRoot)) !== proposal.baselineHash) throw new WorkflowError('The source baseline changed. Create a fresh proposal.');
      const directory = path.join(root, 'proposals', proposal.id), workspacePath = path.join(directory, 'workspace');
      const candidate = await fsp.readFile(path.join(directory, 'candidate.txt'));
      if (hashText(candidate) !== proposal.updatedHash || hashText(await fsp.readFile(path.join(workspacePath, proposal.targetFile))) !== proposal.updatedHash) throw new WorkflowError('Candidate integrity check failed.', 409);
      if (fingerprint(await snapshotFiles(workspacePath)) !== proposal.candidateHash) throw new WorkflowError('The reviewed candidate workspace changed. Create a fresh proposal.');
      proposal.status = 'validating'; update(proposal);
      try {
        const checks = await (options.validate || validateStagedWorkspace)({ workspacePath, baselineRoot: proposal.baselineRoot, signal, log, assertCurrent: () => assertCurrent(signal, proposal.baselineRoot) });
        assertCurrent(signal, proposal.baselineRoot);
        if (fingerprint(await snapshotFiles(workspacePath)) !== proposal.candidateHash) throw new WorkflowError('Validation modified reviewed source. This candidate cannot be released.');
        if (fingerprint(await snapshotFiles(proposal.baselineRoot)) !== proposal.baselineHash) throw new WorkflowError('The source changed during validation; no candidate was activated.');
        if (!checks.length || checks.some(check => !check.passed)) {
          proposal.checks = checks; throw new WorkflowError('Required validation did not pass. Active files are unchanged.');
        }
        proposal.checks = checks;
        proposal.status = 'validated'; proposal.validatedAt = new Date(now()).toISOString(); proposal.artifactDirectory = workspacePath;
        proposal.manifestPath = path.join(directory, 'release-candidate.json');
        await fsp.writeFile(proposal.manifestPath, JSON.stringify({ version: 1, proposalId: proposal.id, baselineHash: proposal.baselineHash, candidateHash: proposal.candidateHash, updatedHash: proposal.updatedHash, workspacePath, targetFile: proposal.targetFile, validatedAt: proposal.validatedAt, checks, activation: 'requires-stable-release-supervisor' }, null, 2), { mode: 0o600 });
        update(proposal);
        log(`Candidate ${proposal.id} passed the required checks. It has not been activated or proven to improve outcomes.`);
        return proposal;
      } catch (error) {
        proposal.status = signal.aborted ? 'cancelled' : 'failed'; proposal.error = String((error as Error).message || error); update(proposal); throw error;
      }
    });
  }
  function cancel() { active?.controller.abort(); log('Cancellation requested. No activation will occur.'); return operationStatus(); }
  async function reject(id: string) {
    return withLock('Reject proposal', async () => {
      const proposal = list().find(item => item.id === id);
      if (!proposal || proposal.status !== 'pending') throw new WorkflowError('Only a pending proposal can be rejected.');
      proposal.status = 'rejected'; update(proposal); return proposal;
    });
  }
  function getValidatedCandidate(id: string) {
    const proposal = list().find(item => item.id === id);
    if (!proposal || proposal.status !== 'validated') throw new WorkflowError('Candidate has not passed validation.');
    return { proposalId: proposal.id, workspacePath: proposal.artifactDirectory!, baselineRoot: proposal.baselineRoot, manifestPath: proposal.manifestPath!, updatedHash: proposal.updatedHash, checks: proposal.checks };
  }
  async function gitStatus() {
    const cwd = configuredRoot(false);
    // Git is a read-only inspection here. No stage/commit/push endpoint is provided.
    const run = async (args: string[]) => {
      const result = await new Promise<{ code: number; output: string }>((resolve, reject) => {
        const child = spawn('git', args, { cwd, shell: false, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = ''; const timer = setTimeout(() => child.kill('SIGTERM'), 8000);
        child.stdout.on('data', chunk => { output = (output + String(chunk)).slice(-20000); });
        child.stderr.on('data', chunk => { output = (output + String(chunk)).slice(-20000); });
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('close', code => { clearTimeout(timer); resolve({ code: code ?? 1, output: output.trim() }); });
      });
      if (result.code !== 0) throw new WorkflowError('The configured source is not an accessible Git checkout. No simulated status was substituted.', 422);
      return result.output;
    };
    const branch = await run(['rev-parse', '--abbrev-ref', 'HEAD']);
    const changes = await run(['status', '--porcelain']);
    return { ok: true, branch, clean: changes.length === 0, modified: changes.split('\n').filter(Boolean).map(row => row.slice(3)), source: 'configured-workspace', lastCommit: await run(['log', '-1', '--format=%h %s']) };
  }
  async function files() { return (await snapshotFiles(configuredRoot(false))).map(file => file.relative).filter(file => /^src\/(?:components\/.+\.(?:tsx|ts)|index\.css)$/.test(file) && !/(?:^|\/)Settings\.tsx$/i.test(file)); }
  return { propose, approve, reject, cancel, list, operationStatus, getValidatedCandidate, gitStatus, files };
}

export type SelfDevelopmentController = ReturnType<typeof createSelfDevelopmentController>;
function publicProposal(proposal: Proposal) {
  const { baselineRoot, artifactDirectory, manifestPath, ...safe } = proposal;
  return { ...safe, proposalId: proposal.id, approvalCode: proposal.updatedHash, validationOnly: true, activated: false };
}
export function registerSelfDevelopmentRoutes(app: Express, controller: SelfDevelopmentController) {
  const handle = (callback: (req: Request, res: Response) => unknown) => async (req: Request, res: Response) => {
    try { await callback(req, res); } catch (error) { res.status(error instanceof WorkflowError ? error.statusCode : 500).json({ ok: false, message: (error as Error).message || 'Candidate operation failed.' }); }
  };
  app.get('/api/self-mod/status', (_req, res) => res.json(controller.operationStatus()));
  app.get('/api/self-mod/files', handle(async (_req, res) => res.json({ files: await controller.files() })));
  app.get('/api/self-mod/proposals', (_req, res) => { try { res.json({ proposals: controller.list().map(publicProposal) }); } catch (error) { res.status(503).json({ ok: false, message: (error as Error).message }); } });
  app.post('/api/self-mod/propose', handle(async (req, res) => {
    if (req.body?.autoApply) throw new WorkflowError('Automatic application is disabled. Prepare and review a candidate first.', 403);
    const proposal = await controller.propose(req.body || {});
    res.json({ ok: true, ...publicProposal(proposal), autoApplied: false, message: 'Proposal prepared. Active source is unchanged.' });
  }));
  app.post('/api/self-mod/apply', handle(async (req, res) => {
    if (req.body?.autoApply) throw new WorkflowError('Automatic application is disabled.', 403);
    const proposal = await controller.approve(req.body?.proposalId, req.body?.updatedHash || req.body?.approvalCode);
    res.json({ ok: true, ...publicProposal(proposal), restartScheduled: false, message: 'The reviewed candidate passed validation. It was not activated. A separate release review is required.' });
  }));
  app.post('/api/self-mod/cancel', (_req, res) => res.json({ ok: true, operation: controller.cancel() }));
  app.delete('/api/self-mod/lock', (_req, res) => res.status(409).json({ ok: false, message: 'A running operation cannot be unlocked. Use Cancel, which waits for the worker to stop.' }));
  app.post('/api/self-mod/auto', (_req, res) => res.status(403).json({ ok: false, message: 'Autonomous source application is disabled. Use the reviewed candidate workflow.' }));
  app.get('/api/autoresearch/status', (_req, res) => res.json({ ...controller.operationStatus(), running: false, mode: 'proposal-only', benefit: 'unmeasured', automaticActivation: false }));
  app.get('/api/autoresearch/log', handle((_req, res) => res.json({ experiments: controller.list().map(publicProposal), benefit: 'unmeasured' })));
  app.get('/api/autoresearch/program', (_req, res) => res.json({ content: 'Prepare one immutable frontend change. Review its exact diff. Validate it in a private workspace. Outcome benefit is unmeasured until a separate product experiment. Running code is never edited or activated by this controller.' }));
  app.post('/api/autoresearch/start', handle(async (req, res) => {
    if (req.body?.autonomous || req.body?.requireApproval === false) throw new WorkflowError('Autonomous application and promotion are disabled.', 403);
    const proposal = await controller.propose({ targetFile: req.body?.targetFile, instruction: req.body?.instruction || req.body?.customDirective });
    res.json({ ok: true, proposal: publicProposal(proposal), message: 'One proposal prepared. No loop or active source change was started.' });
  }));
  app.post('/api/autoresearch/stop', (_req, res) => res.json({ ok: true, operation: controller.cancel() }));
  app.post('/api/autoresearch/approve', handle(async (req, res) => {
    if (typeof req.body?.approved !== 'boolean') throw new WorkflowError('An explicit approve or reject decision is required.', 400);
    const id = req.body?.proposalId || req.body?.experimentId;
    const proposal = req.body.approved ? await controller.approve(id, req.body?.updatedHash) : await controller.reject(id);
    res.json({ ok: true, proposal: publicProposal(proposal), activated: false });
  }));
  for (const route of ['mode', 'approve-all', 'retry']) app.post(`/api/autoresearch/${route}`, (_req, res) => res.status(409).json({ ok: false, message: 'Review each immutable proposal individually. Autonomous mode, approval replay and batch activation are unavailable.' }));
  app.delete('/api/autoresearch/clear-failed', (_req, res) => res.status(403).json({ ok: false, message: 'Failed and interrupted attempts are retained as audit evidence.' }));
  app.get('/devops/git-status', handle(async (_req, res) => res.json(await controller.gitStatus())));
  app.get('/devops/backups', handle((_req, res) => res.json({ backups: controller.list().map(proposal => ({ file: proposal.id, original: proposal.targetFile, timestamp: proposal.createdAt, status: proposal.status })), scope: 'isolated-candidates', activeReleaseBackups: false })));
  for (const route of ['git-push', 'self-heal', 'build', 'deploy', 'restore']) app.post(`/devops/${route}`, (_req, res) => res.status(409).json({ ok: false, message: 'Runtime edits and release operations are unavailable here. Validate a reviewed candidate; the stable release supervisor owns promotion and rollback.' }));
  app.get('/devops/build-log', (_req, res) => res.json({ status: 'not-started', exit_code: null, lines: ['Build checks are attached to each reviewed candidate. No runtime build is running.'] }));
  app.post('/api/agent/self-heal', (_req, res) => res.status(409).json({ ok: false, message: 'Automatic runtime repair is disabled. Prepare a reviewed candidate in Development.' }));
}
