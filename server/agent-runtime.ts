import { createHash, randomUUID } from 'node:crypto';
import { AGENT_WORKFLOW_VERSION, AgentError, type AgentApproval, type AgentArtifact, type AgentDecision, type AgentDecider, type AgentRun, type AgentStep, type AgentStore, type AgentTool, type AgentToolResult } from '../shared/agent-contracts.ts';
import { withReadDeadline } from '../shared/deadline.ts';
import { assertAgentCompletionOutputs, supportedCompletionContract } from './agent-completion.ts';
import { createAgentExecutionBinding, validAgentExecutionBinding, type AgentExecutionBinding } from './agent-executor-identity.ts';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const MAX_STEPS = 20, MAX_ACTIVE_MS = 15 * 60_000, APPROVAL_MS = 15 * 60_000;
const PUBLIC_ERROR_CODES = new Set(['AGENT_DECISION_INVALID', 'AGENT_TOOL_DENIED', 'AGENT_LIMIT', 'AGENT_COMPLETION_INVALID', 'AGENT_REPLAY_BLOCKED', 'AGENT_APPROVAL_INVALID', 'MODEL_TIMEOUT', 'MODEL_CANCELLED', 'MODEL_AUTH', 'MODEL_RATE_LIMIT', 'MODEL_UNAVAILABLE', 'MODEL_INVALID_REQUEST', 'MODEL_EMPTY_OUTPUT', 'MODEL_PROVIDER_ERROR']);
const SECRET_KEY = /^(?:password|passphrase|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|authorization|private[_-]?key|credentials?)$/i;
const clone = <T>(value: T): T => structuredClone(value);
const invalid = () => new AgentError('The agent decision is invalid or exceeds its supported bounds.', 400, 'AGENT_DECISION_INVALID');
const conflict = (message = 'This run changed. Refresh it before continuing.') => new AgentError(message, 409, 'AGENT_CONFLICT');
const denied = () => new AgentError('This action is not authorized for the selected run.', 403, 'AGENT_TOOL_DENIED');
const lost = () => new AgentError('The execution lease was lost. Reconcile interrupted actions before continuing.', 409, 'AGENT_LEASE_LOST');
const requiresReconciliation = (step: AgentStep) => step.status === 'uncertain' || step.status === 'running' || (step.status === 'failed' && step.effect !== 'read');
const blocksCompletion = (step: AgentStep) => step.status === 'prepared' || requiresReconciliation(step);
function adaptiveReadError(error: unknown): boolean {
  // Tool, scope, lease and model validation failures never become permission to continue.
  const code = (error as { code?: unknown })?.code;
  return !(typeof code === 'string' && (/^MODEL_/.test(code) || /^AGENT_(?:TOOL_DENIED|SCOPE|VALIDATION|DECISION_INVALID|REQUEST|CONFLICT|LEASE_LOST|CANCELLED|UNCERTAIN|REPLAY_BLOCKED|APPROVAL_INVALID)$/.test(code)));
}
function readFailureReceipt(error: unknown): { code: string; status?: number } {
  let status: number | undefined;
  try {
    const issue = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
    const candidate = issue?.status ?? issue?.statusCode ?? issue?.response?.status;
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 400 && candidate <= 599) status = candidate;
  } catch { /* Provider objects cannot introduce unsafe error details. */ }
  const code = status === 404 ? 'AGENT_READ_NOT_FOUND' : status === 401 || status === 403 ? 'AGENT_READ_AUTH' : status === 429 ? 'AGENT_READ_RATE_LIMIT' : status && status >= 500 ? 'AGENT_READ_UNAVAILABLE' : 'AGENT_READ_FAILED';
  return { code, ...(status !== undefined ? { status } : {}) };
}

function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function boundedText(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw invalid();
  return value.trim();
}
function redact(value: string): string {
  return value.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[redacted]')
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:AIza[\w-]{20,}|(?:sk-|ghp_|github_pat_)[\w-]{16,})\b/g, '[redacted]')
    .replace(/((?:password|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*)[^\s,;&"'<>]+/gi, '$1[redacted]')
    .replace(/([?&](?:token|key|api_key|password|secret)=)[^&\s]+/gi, '$1[redacted]');
}
function jsonInput(value: unknown): Record<string, unknown> {
  if (!plain(value)) throw invalid();
  const active = new Set<object>();
  let nodes = 0, characters = 0;
  const visit = (item: unknown, depth: number) => {
    if (depth > 8 || ++nodes > 2000) throw invalid();
    if (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) return;
    if (typeof item === 'string') { characters += item.length; if (characters > 32_000 || item.includes('\0') || redact(item) !== item) throw invalid(); return; }
    if (typeof item !== 'object' || active.has(item)) throw invalid();
    if (!Array.isArray(item) && !plain(item)) throw invalid();
    if (Object.keys(item).length > 100 || (Array.isArray(item) && item.length > 50)) throw invalid();
    active.add(item);
    for (const [key, child] of Object.entries(item)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key) || SECRET_KEY.test(key)) throw invalid();
      visit(child, depth + 1);
    }
    active.delete(item);
  };
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 32_000) throw invalid();
  return clone(value);
}

/** Decisions are data, never executable code or a source of permission. */
export function validateAgentDecision(input: unknown): AgentDecision {
  let value = input;
  if (typeof input === 'string') {
    if (input.length > 40_000) throw invalid();
    try { value = JSON.parse(input); } catch { throw invalid(); }
  }
  if (!plain(value)) throw invalid();
  const fields: Record<string, string[]> = { plan: ['kind', 'summary', 'plan'], tool: ['kind', 'summary', 'tool', 'arguments'], finish: ['kind', 'summary'], ask: ['kind', 'summary', 'question'] };
  if (typeof value.kind !== 'string' || !Object.hasOwn(fields, value.kind) || Object.keys(value).some(key => !fields[value.kind as string].includes(key))) throw invalid();
  const summary = redact(boundedText(value.summary, 2000));
  if (value.kind === 'finish') return { kind: 'finish', summary };
  if (value.kind === 'ask') return { kind: 'ask', summary, question: redact(boundedText(value.question, 2000)) };
  if (value.kind === 'plan') {
    if (!Array.isArray(value.plan) || value.plan.length < 1 || value.plan.length > 8) throw invalid();
    return { kind: 'plan', summary, plan: value.plan.map(item => redact(boundedText(item, 500))) };
  }
  const tool = boundedText(value.tool, 120);
  if (!/^[a-z][a-z\d_.:-]*$/i.test(tool)) throw invalid();
  return { kind: 'tool', summary, tool, arguments: jsonInput(value.arguments) };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function canonicalActionDigest(run: Pick<AgentRun, 'id' | 'projectId' | 'selection' | 'policyVersion' | 'workflowVersion' | 'completionContract'>, action: Pick<AgentStep, 'tool' | 'effect' | 'arguments' | 'binding'>): string {
  return createHash('sha256').update(canonical({ runId: run.id, projectId: run.projectId, selection: run.selection ?? null, policyVersion: run.policyVersion, workflowVersion: run.workflowVersion,
    ...(run.completionContract !== undefined ? { completionContract: run.completionContract } : {}),
    action: { tool: action.tool, effect: action.effect, arguments: jsonInput(action.arguments), ...(action.binding !== undefined ? { binding: action.binding } : {}) } })).digest('hex');
}

type OutputBounds = { truncated: boolean; nodes: number; characters: number };
function safeData(value: unknown, bounds: OutputBounds, depth = 0): unknown {
  if (depth > 6 || ++bounds.nodes > 1000 || bounds.characters > 30_000) { bounds.truncated = true; return '[truncated]'; }
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (typeof value === 'string') { const limit = Math.max(0, Math.min(6000, 30_000 - bounds.characters)); if (value.length > limit) bounds.truncated = true; const result = redact(value).slice(0, limit); bounds.characters += result.length; return result; }
  if (Array.isArray(value)) { if (value.length > 30) bounds.truncated = true; return value.slice(0, 30).map(item => safeData(item, bounds, depth + 1)); }
  if (plain(value)) { const entries = Object.entries(value); if (entries.length > 60) bounds.truncated = true; return Object.fromEntries(entries.slice(0, 60).map(([key, item]) => [key, SECRET_KEY.test(key) ? '[redacted]' : safeData(item, bounds, depth + 1)]).filter(([key]) => !['__proto__', 'constructor', 'prototype'].includes(String(key)))); }
  return '[unsupported]';
}
function sanitizeResult(value: AgentToolResult): AgentToolResult & { dataTruncated: boolean } {
  if (!plain(value)) throw new AgentError('The tool returned an invalid receipt.', 502, 'AGENT_TOOL_FAILED');
  const summary = redact(boundedText(value.summary, 2000));
  const bounds: OutputBounds = { truncated: false, nodes: 0, characters: 0 };
  let data = value.data === undefined ? undefined : safeData(value.data, bounds);
  if (data !== undefined && Buffer.byteLength(JSON.stringify(data), 'utf8') > 32_000) { bounds.truncated = true; data = { truncated: true, reason: 'The tool receipt exceeded the retained output limit.' }; }
  if (bounds.truncated && plain(data)) data.dataTruncated = true;
  if (value.artifacts !== undefined && (!Array.isArray(value.artifacts) || value.artifacts.length > 10)) throw new AgentError('The tool returned an invalid artifact receipt.', 502, 'AGENT_TOOL_FAILED');
  const artifacts: AgentArtifact[] = (value.artifacts ?? []).map(item => {
    if (!plain(item) || !['evidence', 'draft', 'report', 'wordpress'].includes(item.kind)) throw new AgentError('The tool returned an invalid artifact receipt.', 502, 'AGENT_TOOL_FAILED');
    const artifact: AgentArtifact = { id: boundedText(item.id, 200), kind: item.kind, title: redact(boundedText(item.title, 1000)), resourceId: boundedText(item.resourceId, 2000) };
    if (item.siteId !== undefined) artifact.siteId = boundedText(item.siteId, 200);
    if (item.language !== undefined) artifact.language = boundedText(item.language, 30);
    if (item.revision !== undefined) {
      if (typeof item.revision === 'number' && Number.isSafeInteger(item.revision) && item.revision >= 0) artifact.revision = item.revision;
      else artifact.revision = boundedText(item.revision, 200);
    }
    return artifact;
  });
  return { summary, dataTruncated: bounds.truncated, ...(data !== undefined ? { data } : {}), ...(artifacts.length ? { artifacts } : {}) };
}

export type AgentAuthorizationContext = { run: AgentRun; tool: AgentTool; arguments: Record<string, unknown>; actionId: string; digest: string; phase: 'prepare' | 'approve' | 'execute' };
export type AgentRuntimeOptions = {
  authorize?: (context: AgentAuthorizationContext) => boolean | Promise<boolean>;
  /** Captured once from the launcher's verified release. Mandatory in the installed service. */
  executorIdentity?: string; requireExecutionBinding?: boolean;
  /** Dependency injection for deterministic, credential-free tests. Production defaults remain bounded. */
  now?: () => number; id?: () => string; leaseTtlMs?: number; heartbeatMs?: number; decisionTimeoutMs?: number;
};
type Owned = { id: string; owner: string; fence: number; lost: boolean; stop: AbortController; operation?: AbortController; timer?: ReturnType<typeof setInterval>; expiry?: ReturnType<typeof setTimeout>; accountedAt: number };

export class AgentRuntime {
  private tools: Map<string, AgentTool>;
  private bindings = new Map<string, AgentExecutionBinding>();
  private bindingRequired: boolean;
  private active = new Map<string, Owned>();
  private starts = new Map<string, Promise<AgentRun>>();
  private tail: Promise<unknown> = Promise.resolve();
  private closing = false;
  private shutdownTask?: Promise<void>;
  private shutdownSettled = false;
  private stopping = new Set<Owned>();
  private leases = new Set<Owned>();
  private now: () => number;
  private id: () => string;
  private ttl: number;
  private heartbeatMs: number;
  constructor(private store: AgentStore, tools: AgentTool[], private decide: AgentDecider, private options: AgentRuntimeOptions = {}) {
    this.tools = new Map();
    this.bindingRequired = options.requireExecutionBinding === true || options.executorIdentity !== undefined;
    if (this.bindingRequired && !/^[a-f\d]{64}$/.test(options.executorIdentity ?? '')) throw new AgentError('Agent tasks require an identified, verified application build.', 503, 'AGENT_EXECUTOR_UNIDENTIFIED');
    for (const tool of tools) {
      if (!/^[a-z][a-z\d_.:-]{0,119}$/i.test(tool.name) || this.tools.has(tool.name) || !['read', 'local-write', 'external-write'].includes(tool.effect)) throw new AgentError('The agent tool registry is invalid.', 500, 'AGENT_TOOL_REGISTRY');
      const snapshot = Object.freeze({ ...tool, inputSchema: clone(tool.inputSchema) });
      this.tools.set(snapshot.name, snapshot);
      if (this.bindingRequired) {
        const binding = createAgentExecutionBinding(options.executorIdentity, snapshot);
        if (!binding) throw new AgentError('The agent tool registry is invalid.', 500, 'AGENT_TOOL_REGISTRY');
        this.bindings.set(snapshot.name, binding);
      }
    }
    this.now = options.now ?? Date.now; this.id = options.id ?? randomUUID;
    this.ttl = Math.max(100, Math.min(options.leaseTtlMs ?? 30_000, 30_000));
    this.heartbeatMs = Math.max(1, Math.min(options.heartbeatMs ?? 10_000, 10_000, this.ttl / 3));
  }
  /** Resolves after a run reaches a durable wait/terminal state. Routes may detach and poll. */
  start(runId: string): Promise<AgentRun> {
    if (this.closing) return this.store.getRun(runId);
    const existing = this.starts.get(runId);
    if (existing) return existing.then(async () => {
      const current = await this.store.getRun(runId);
      return current.status === 'queued' ? this.start(runId) : current;
    });
    const task = this.tail.catch(() => {}).then(() => this.executeRun(runId)).then(() => this.store.getRun(runId));
    this.tail = task.catch(() => {}); this.starts.set(runId, task);
    void task.finally(() => this.starts.delete(runId)).catch(() => {});
    return task;
  }
  private assertLease(ctx: Owned): void { if (ctx.lost || ctx.stop.signal.aborted) throw lost(); }
  private async mutate(ctx: Owned, type: string, message: string, mutate: (run: AgentRun) => void, expectedRevision?: number, allowClosing = false): Promise<AgentRun> {
    this.assertLease(ctx);
    if (this.closing && !allowClosing) throw conflict();
    try {
      return await this.store.mutateRun(ctx.id, { lease: { owner: ctx.owner, fence: ctx.fence }, ...(expectedRevision !== undefined ? { expectedRevision } : {}), event: { type, message } }, run => { this.assertLease(ctx); if (this.closing && !allowClosing) throw conflict(); mutate(run); });
    } catch (error) {
      if (error instanceof AgentError && error.code === 'AGENT_LEASE_LOST') this.lose(ctx);
      throw error;
    }
  }
  private lose(ctx: Owned): void { ctx.lost = true; ctx.stop.abort(); ctx.operation?.abort(); }
  private watchLease(ctx: Owned, deadline: number): void {
    if (ctx.expiry) clearTimeout(ctx.expiry);
    ctx.expiry = setTimeout(() => this.lose(ctx), Math.max(1, Math.min(this.ttl, deadline - this.now())));
  }
  private owned(run: AgentRun): Owned {
    const ctx: Owned = { id: run.id, owner: run.leaseOwner!, fence: run.fence, lost: false, stop: new AbortController(), accountedAt: this.now() };
    this.leases.add(ctx);
    // A claim may return after the bounded shutdown sweep. It has no authority
    // to renew its lease or report a durable pause after that budget has ended.
    if (this.shutdownSettled) { this.lose(ctx); return ctx; }
    this.watchLease(ctx, Math.min(this.now() + this.ttl, Date.parse(run.leaseUntil!)));
    let pending = false;
    ctx.timer = setInterval(() => {
      if (pending || ctx.lost) return; pending = true;
      const startedAt = this.now();
      void this.store.heartbeat(ctx.id, ctx.owner, ctx.fence, this.ttl).then(ok => {
        if (!ok) this.lose(ctx);
        else if (!ctx.lost) this.watchLease(ctx, startedAt + this.ttl);
      }, () => this.lose(ctx)).finally(() => { pending = false; });
    }, this.heartbeatMs);
    return ctx;
  }
  private async release(ctx: Owned): Promise<void> {
    if (ctx.timer) clearInterval(ctx.timer);
    if (ctx.expiry) clearTimeout(ctx.expiry);
    this.leases.delete(ctx);
    // Late claims still need fenced cleanup after shutdown revoked their authority.
    if (!ctx.lost || this.shutdownSettled) await this.store.releaseRun(ctx.id, ctx.owner, ctx.fence);
  }
  private account(ctx: Owned, run: AgentRun): void {
    const now = this.now(); run.activeMs += Math.max(0, Math.floor(now - ctx.accountedAt)); ctx.accountedAt = now;
  }
  private remaining(run: AgentRun, ctx: Owned): number { return Math.min(MAX_ACTIVE_MS, run.limits.maxActiveMs) - run.activeMs - Math.max(0, this.now() - ctx.accountedAt); }
  private executing(run: AgentRun): void { if (this.closing || run.status !== 'running' || run.pauseRequested || run.cancelRequested) throw conflict(); }
  private supported(run: AgentRun): boolean { return run.workflowVersion === AGENT_WORKFLOW_VERSION && run.policyVersion === 1 && supportedCompletionContract(run.completionContract); }
  private unsupported(ctx: Owned): Promise<AgentRun> {
    return this.mutate(ctx, 'run.version-unsupported', 'This retained workflow, policy or completion contract requires manual migration.', state => {
      state.status = 'paused'; state.pauseRequested = true;
      if (state.approval && ['pending', 'approved'].includes(state.approval.status)) state.approval.status = 'rejected';
      state.summary = 'This retained workflow, policy or completion contract is unsupported. Review its saved work and start a new current-version task. No action was replayed.';
    });
  }
  private compatible(step: AgentStep): boolean {
    if (!this.bindingRequired && step.binding === undefined) return true;
    const expected = this.bindings.get(step.tool);
    return !!expected && validAgentExecutionBinding(step.binding) && canonical(expected) === canonical(step.binding);
  }
  private incompatible(run: AgentRun): boolean { return run.steps.some(step => step.status === 'prepared' && !this.compatible(step)); }
  private quarantine(ctx: Owned, expectedRevision?: number): Promise<AgentRun> {
    return this.mutate(ctx, 'run.implementation-changed', 'Retained action authority does not match this application implementation.', state => {
      state.status = 'paused'; state.pauseRequested = true;
      if (state.approval && ['pending', 'approved'].includes(state.approval.status)) state.approval.status = 'rejected';
      state.summary = 'A prepared action belongs to a different or unidentified implementation. Review and redirect this task or start a new task; no action was replayed.';
    }, expectedRevision);
  }
  private async authorize(run: AgentRun, step: AgentStep, phase: AgentAuthorizationContext['phase']): Promise<AgentTool> {
    if (!this.supported(run) || !this.compatible(step)) throw denied();
    const tool = this.tools.get(step.tool);
    if (!tool || !run.allowedTools.includes(step.tool) || step.effect !== tool.effect) throw denied();
    const arguments_ = jsonInput(tool.validate(clone(step.arguments)));
    if (canonical(arguments_) !== canonical(step.arguments)) throw denied();
    const digest = canonicalActionDigest(run, step);
    if (this.options.authorize && !await this.options.authorize({ run: clone(run), tool, arguments: clone(arguments_), actionId: step.id, digest, phase })) throw denied();
    return tool;
  }
  private async operation<T>(ctx: Owned, timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.assertLease(ctx); const operation = new AbortController(); ctx.operation = operation;
    const stop = () => operation.abort(); ctx.stop.signal.addEventListener('abort', stop, { once: true });
    try { return await withReadDeadline(run, Math.max(1, timeoutMs), 'Agent operation exceeded its time limit.', { signal: operation.signal }); }
    finally { ctx.stop.signal.removeEventListener('abort', stop); if (ctx.operation === operation) delete ctx.operation; }
  }
  private async executeRun(runId: string): Promise<AgentRun> {
    const initial = await this.store.getRun(runId);
    if (this.closing) return initial;
    if (initial.status !== 'queued' && initial.status !== 'running') return initial;
    const claimed = await this.store.claimRun(runId, this.id(), this.ttl);
    if (!claimed) return this.store.getRun(runId);
    const ctx = this.owned(claimed); this.active.set(runId, ctx);
    try {
      // A running record acquired by a new execution has lost its original coordinator.
      // This check also covers leases that were still live during startup recovery.
      if (this.closing || claimed.status === 'running') return await this.mutate(ctx, 'run.recovered', 'Interrupted execution was paused before any model or tool call.', state => {
        this.account(ctx, state); state.status = 'paused'; state.pauseRequested = true;
        state.summary = 'Execution was interrupted. Review the retained work before resuming.';
      }, undefined, this.closing);
      if (!this.supported(claimed)) return await this.unsupported(ctx);
      if (this.incompatible(claimed)) return await this.quarantine(ctx);
      let run = await this.mutate(ctx, 'run.started', 'Agent execution started.', state => {
        if (this.closing || !['queued', 'running'].includes(state.status) || state.pauseRequested || state.cancelRequested) throw conflict();
        state.status = 'running';
      });
      if (run.steps.some(requiresReconciliation)) {
        return await this.mutate(ctx, 'run.reconciliation-required', 'Retained actions require manual reconciliation.', state => { this.executing(state); state.status = 'paused'; state.pauseRequested = true; });
      }
      let consecutivePlans = 0;
      for (let decisions = 0; decisions < 40; decisions++) {
        this.assertLease(ctx); run = await this.store.getRun(runId);
        if (this.closing || run.status !== 'running' || run.pauseRequested || run.cancelRequested) return run;
        if (this.remaining(run, ctx) <= 0) throw new AgentError('The run reached its active time limit.', 409, 'AGENT_LIMIT');
        const prepared = run.steps.find(step => step.status === 'prepared');
        if (prepared) { await this.executeStep(ctx, run, prepared); consecutivePlans = 0; continue; }
        const available = [...this.tools.values()].filter(tool => run.allowedTools.includes(tool.name)).map(({ name, description, inputSchema, effect }) => ({ name, description, inputSchema: clone(inputSchema), effect }));
        const decision = validateAgentDecision(await this.operation(ctx, Math.min(this.remaining(run, ctx), this.options.decisionTimeoutMs ?? 90_000), signal => this.decide(clone(run), available, signal)));
        run = await this.store.getRun(runId);
        if (this.closing || run.status !== 'running' || run.pauseRequested || run.cancelRequested) return run;
        if (this.remaining(run, ctx) <= 0) throw new AgentError('The run reached its active time limit.', 409, 'AGENT_LIMIT');
        if (decision.kind === 'plan') {
          if (++consecutivePlans > 2) throw new AgentError('The agent did not progress beyond planning.', 409, 'AGENT_LIMIT');
          await this.mutate(ctx, 'run.planned', 'A bounded plan was recorded.', state => { this.executing(state); this.account(ctx, state); state.plan = decision.plan; state.summary = decision.summary; });
        } else if (decision.kind === 'ask') {
          return await this.mutate(ctx, 'run.input-required', 'The agent requested operator input.', state => { this.executing(state); this.account(ctx, state); state.status = 'waiting-input'; state.summary = decision.summary; state.question = decision.question; });
        } else if (decision.kind === 'finish') {
          if (!run.steps.some(step => step.status === 'succeeded') || run.steps.some(blocksCompletion)) throw new AgentError('Completion requires successful tool evidence with no unresolved action.', 409, 'AGENT_COMPLETION_INVALID');
          assertAgentCompletionOutputs(run);
          return await this.mutate(ctx, 'run.completed', 'Agent work completed with retained tool receipts.', state => {
            this.executing(state);
            if (!state.steps.some(step => step.status === 'succeeded') || state.steps.some(blocksCompletion)) throw new AgentError('Completion requires successful tool evidence with no unresolved action.', 409, 'AGENT_COMPLETION_INVALID');
            assertAgentCompletionOutputs(state);
            this.account(ctx, state); state.status = 'completed'; state.summary = decision.summary; delete state.question;
          });
        } else {
          consecutivePlans = 0;
          if (run.steps.length >= Math.min(MAX_STEPS, run.limits.maxSteps)) throw new AgentError('The run reached its step limit.', 409, 'AGENT_LIMIT');
          const tool = this.tools.get(decision.tool); if (!tool || !run.allowedTools.includes(tool.name)) throw denied();
          const step: AgentStep = { id: this.id(), tool: tool.name, arguments: jsonInput(tool.validate(decision.arguments)), effect: tool.effect, ...(this.bindings.has(tool.name) ? { binding: clone(this.bindings.get(tool.name)!) } : {}), status: 'prepared', summary: decision.summary };
          await this.operation(ctx, Math.min(this.remaining(run, ctx), 30_000), async () => this.authorize(run, step, 'prepare'));
          const digest = canonicalActionDigest(run, step);
          if (step.effect !== 'read' && run.steps.some(prior => prior.effect !== 'read' && prior.status !== 'superseded' && canonicalActionDigest(run, { ...prior, binding: undefined }) === canonicalActionDigest(run, { ...step, binding: undefined }))) throw new AgentError('This write action is already retained. It will not be repeated automatically.', 409, 'AGENT_REPLAY_BLOCKED');
          const approval: AgentApproval | undefined = step.effect === 'external-write' ? { id: this.id(), stepId: step.id, digest, expiresAt: new Date(this.now() + APPROVAL_MS).toISOString(), status: 'pending', summary: step.summary } : undefined;
          if (approval) step.result = { approval: clone(approval) };
          if (Buffer.byteLength(JSON.stringify({ ...run, steps: [...run.steps, step] }), 'utf8') > 800_000) throw new AgentError('The run reached its retained data limit.', 409, 'AGENT_LIMIT');
          run = await this.mutate(ctx, 'step.prepared', approval ? 'An external action awaits exact operator approval.' : 'A tool action was durably prepared.', state => {
            if (this.closing || state.status !== 'running' || state.pauseRequested || state.cancelRequested) throw conflict();
            this.account(ctx, state); state.steps.push(step); state.summary = decision.summary;
            if (approval) { state.approval = approval; state.status = 'waiting-approval'; }
          });
          if (approval) return run;
        }
      }
      throw new AgentError('The run reached its decision limit.', 409, 'AGENT_LIMIT');
    } catch (error) {
      if (ctx.lost || this.closing) return this.store.getRun(runId);
      const current = await this.store.getRun(runId);
      if (current.status !== 'running' || current.pauseRequested || current.cancelRequested) return current;
      const declaredCode = (error as { code?: unknown })?.code;
      const code = typeof declaredCode === 'string' && PUBLIC_ERROR_CODES.has(declaredCode) ? declaredCode : (error as { name?: string })?.name === 'TimeoutError' ? 'AGENT_TIMEOUT' : 'AGENT_EXECUTION_FAILED';
      if (['MODEL_UNAVAILABLE', 'MODEL_RATE_LIMIT', 'MODEL_TIMEOUT', 'MODEL_EMPTY_OUTPUT', 'MODEL_PROVIDER_ERROR'].includes(code) && !current.steps.some(requiresReconciliation)) {
        return await this.mutate(ctx, 'run.model-paused', `Agent execution paused (${code}).`, state => {
          if (state.status !== 'running' || state.pauseRequested || state.cancelRequested) return;
          this.account(ctx, state); state.status = 'paused'; state.pauseRequested = true;
          state.summary = `The AI request could not finish (${code}). Saved work and receipts are retained. Resume when the AI connection is available.`;
        });
      }
      return await this.mutate(ctx, 'run.failed', `Agent execution stopped (${code}).`, state => { if (state.status !== 'running' || state.pauseRequested || state.cancelRequested) return; this.account(ctx, state); state.status = 'failed'; state.summary = `Agent execution stopped (${code}). Provider details and credentials were not retained.`; });
    } finally {
      this.active.delete(runId); if (!this.stopping.has(ctx)) await this.release(ctx);
    }
  }
  private async executeStep(ctx: Owned, run: AgentRun, step: AgentStep): Promise<void> {
    const tool = await this.operation(ctx, Math.min(this.remaining(run, ctx), 30_000), async () => this.authorize(run, step, 'execute'));
    const digest = canonicalActionDigest(run, step);
    if (this.remaining(run, ctx) <= 0 || Buffer.byteLength(JSON.stringify(run), 'utf8') > 850_000) throw new AgentError('The run reached its execution limit.', 409, 'AGENT_LIMIT');
    let canAdapt = false;
    // Set the abort target before claiming execution, so a concurrent control cannot miss an in-flight write.
    await this.operation(ctx, this.remaining(run, ctx), async signal => {
      const executing = await this.mutate(ctx, 'step.started', 'The prepared tool action started.', state => {
        if (this.closing || state.status !== 'running' || state.pauseRequested || state.cancelRequested) throw conflict();
        const retained = state.steps.find(item => item.id === step.id);
        if (!retained || retained.status !== 'prepared' || canonicalActionDigest(state, retained) !== digest) throw conflict();
        if (step.effect === 'external-write') {
          const approval = state.approval;
          if (!approval || approval.stepId !== step.id || approval.digest !== digest || approval.status !== 'approved' || Date.parse(approval.expiresAt) <= this.now()) throw new AgentError('The exact approval is missing, changed, consumed, or expired.', 409, 'AGENT_APPROVAL_INVALID');
          approval.status = 'consumed'; retained.result = { approval: clone(approval) };
        }
        this.account(ctx, state); retained.status = 'running'; retained.startedAt = new Date(this.now()).toISOString();
      });
      if (signal.aborted) throw new Error('Interrupted');
      try {
        let raw: AgentToolResult;
        try { raw = await tool.execute({ run: clone(executing), signal, actionId: step.id }, clone(step.arguments)); }
        catch (error) { canAdapt = step.effect === 'read' && adaptiveReadError(error); throw error; }
        const result = sanitizeResult(raw);
        if (signal.aborted) throw new Error('Interrupted');
        await this.mutate(ctx, 'step.succeeded', 'A bounded tool receipt was retained.', state => {
          const retained = state.steps.find(item => item.id === step.id);
          if (this.closing || !retained || retained.status !== 'running' || state.status !== 'running' || state.pauseRequested || state.cancelRequested) return;
          this.account(ctx, state); retained.status = 'succeeded'; retained.summary = result.summary; retained.finishedAt = new Date(this.now()).toISOString();
          retained.result = { ...(step.effect === 'external-write' ? { approval: clone(state.approval) } : {}), ...(result.data !== undefined ? { data: result.data } : {}), ...(result.dataTruncated ? { dataTruncated: true } : {}), ...(result.artifacts?.length ? { artifacts: clone(result.artifacts) } : {}) };
          for (const artifact of result.artifacts ?? []) if (!state.artifacts.some(item => item.id === artifact.id)) state.artifacts.push(artifact);
        });
      } catch (error) { throw error; }
    }).catch(async error => {
      if (ctx.lost || this.closing) throw error;
      const stopped = await this.mutate(ctx, 'step.interrupted', 'The tool did not return a confirmed successful receipt.', state => {
        const retained = state.steps.find(item => item.id === step.id);
        if (!retained || retained.status !== 'running') return;
        this.account(ctx, state); retained.status = step.effect === 'read' ? 'failed' : 'uncertain'; retained.finishedAt = new Date(this.now()).toISOString();
        retained.summary = step.effect === 'read' ? 'The read failed or was interrupted. No provider details were retained.' : 'The write outcome is uncertain. Reconcile it before continuing; it will not be replayed.';
        if (step.effect === 'read') retained.result = { error: readFailureReceipt(error) };
        if (step.effect !== 'read' && !TERMINAL.has(state.status)) { state.status = 'paused'; state.pauseRequested = true; state.summary = retained.summary; }
      });
      if (canAdapt && !ctx.lost && stopped.status === 'running' && !stopped.pauseRequested && !stopped.cancelRequested && stopped.steps.find(item => item.id === step.id)?.status === 'failed') return;
      throw error;
    });
  }
  private async control(id: string, work: (ctx: Owned, revision?: number) => Promise<AgentRun>, expectedRevision?: number, allowClosing = false): Promise<AgentRun> {
    if (this.closing && !allowClosing) throw conflict();
    if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) throw conflict();
    const active = this.active.get(id);
    if (active) return work(active, expectedRevision);
    const current = await this.store.getRun(id);
    if (expectedRevision !== undefined && current.revision !== expectedRevision) throw conflict();
    if (TERMINAL.has(current.status)) throw conflict('This run has already ended. Start a new run for further work.');
    const claimed = await this.store.claimRun(id, this.id(), this.ttl);
    if (!claimed) throw conflict('Another worker owns the execution lease, or an interrupted run requires refresh.');
    const ctx = this.owned(claimed);
    try {
      if (this.closing && !allowClosing) throw conflict();
      if (expectedRevision !== undefined && claimed.revision !== expectedRevision + 1) throw conflict();
      await work(ctx, expectedRevision === undefined ? undefined : claimed.revision);
    } finally { await this.release(ctx); }
    return this.store.getRun(id);
  }
  async pause(id: string, expectedRevision?: number): Promise<AgentRun> {
    return this.control(id, async (ctx, revision) => {
      const run = await this.mutate(ctx, 'run.paused', 'The operator paused this run.', state => {
        if (TERMINAL.has(state.status)) throw conflict();
        this.account(ctx, state); state.pauseRequested = true; state.status = 'paused';
        for (const step of state.steps.filter(item => item.status === 'running')) { step.status = step.effect === 'read' ? 'superseded' : 'uncertain'; step.summary = step.effect === 'read' ? 'The operator interrupted this read.' : 'The operator interrupted this write. Its outcome requires reconciliation.'; }
      }, revision);
      ctx.operation?.abort(); return run;
    }, expectedRevision);
  }
  async cancel(id: string, expectedRevision?: number): Promise<AgentRun> {
    return this.control(id, async (ctx, revision) => {
      const run = await this.mutate(ctx, 'run.cancelled', 'The operator cancelled this run. Existing effects were not undone.', state => {
        if (TERMINAL.has(state.status)) throw conflict();
        this.account(ctx, state); state.cancelRequested = true; state.status = 'cancelled';
        for (const step of state.steps) {
          if (step.status === 'running') { step.status = step.effect === 'read' ? 'superseded' : 'uncertain'; step.summary = step.effect === 'read' ? 'The operator cancelled this read.' : 'This write may have taken effect before cancellation; reconcile its outcome.'; }
          else if (step.status === 'prepared') step.status = 'superseded';
        }
        if (state.approval && ['pending', 'approved'].includes(state.approval.status)) state.approval.status = 'rejected';
      }, revision);
      ctx.operation?.abort(); return run;
    }, expectedRevision);
  }
  async resume(id: string, expectedRevision?: number): Promise<AgentRun> {
    return this.control(id, (ctx, revision) => this.mutate(ctx, 'run.resumed', 'The operator resumed this run.', state => {
      if (!this.supported(state) || this.incompatible(state) || !['paused', 'waiting-input'].includes(state.status) || state.cancelRequested || state.steps.some(requiresReconciliation)) throw conflict('This run cannot resume until unresolved actions or unsupported implementations are reviewed. Redirect superseded work or start a new run.');
      state.pauseRequested = false; delete state.question;
      state.status = state.approval?.status === 'pending' && state.steps.some(step => step.id === state.approval?.stepId && step.status === 'prepared') ? 'waiting-approval' : 'queued';
    }, revision), expectedRevision);
  }
  async redirect(id: string, instruction: string, expectedRevision?: number): Promise<AgentRun> {
    const text = redact(boundedText(instruction, 4000));
    return this.control(id, async (ctx, revision) => {
      const run = await this.mutate(ctx, 'run.redirected', 'The operator supplied a new bounded directive.', state => {
        if (TERMINAL.has(state.status) || !this.supported(state)) throw conflict();
        if ((state.directives?.length ?? 0) >= 20) throw conflict('This run reached its operator directive limit. Start a new run.');
        this.account(ctx, state); (state.directives ??= []).push({ id: this.id(), instruction: text, createdAt: new Date(this.now()).toISOString() });
        for (const step of state.steps) {
          if (step.status === 'prepared' || (step.status === 'running' && step.effect === 'read')) step.status = 'superseded';
          else if (step.status === 'running') { step.status = 'uncertain'; step.summary = 'A write was interrupted by redirection. Reconcile its outcome before continuing.'; }
        }
        if (state.approval && ['pending', 'approved'].includes(state.approval.status)) state.approval.status = 'rejected';
        state.pauseRequested = state.steps.some(requiresReconciliation); state.status = state.pauseRequested ? 'paused' : 'queued'; delete state.question;
      }, revision);
      ctx.operation?.abort(); return run;
    }, expectedRevision);
  }
  async approve(id: string, approvalId: string, digest: string, expectedRevision: number): Promise<AgentRun> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !/^[a-f\d]{64}$/.test(digest)) throw conflict();
    return this.control(id, async (ctx, revision) => {
      const run = await this.store.getRun(id), step = run.steps.find(item => item.id === run.approval?.stepId);
      if (!step || !run.approval || run.approval.id !== approvalId || run.approval.digest !== digest || canonicalActionDigest(run, step) !== digest || run.approval.status !== 'pending' || step.status !== 'prepared' || Date.parse(run.approval.expiresAt) <= this.now() || run.cancelRequested || !['waiting-approval', 'paused'].includes(run.status)) throw new AgentError('The exact approval is missing, changed, consumed, or expired.', 409, 'AGENT_APPROVAL_INVALID');
      if (!this.compatible(step)) return this.quarantine(ctx, revision);
      await this.operation(ctx, 30_000, async () => this.authorize(run, step, 'approve'));
      return this.mutate(ctx, 'approval.approved', 'The operator approved this exact action and scope.', state => {
        if (state.approval?.id !== approvalId || state.approval.status !== 'pending' || state.steps.find(item => item.id === step.id)?.status !== 'prepared' || Date.parse(state.approval.expiresAt) <= this.now()) throw conflict();
        state.approval.status = 'approved'; state.pauseRequested = false; state.status = 'queued';
      }, revision);
    }, expectedRevision);
  }
  async reject(id: string, approvalId: string, digest: string, expectedRevision: number): Promise<AgentRun> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw conflict();
    return this.control(id, (ctx, revision) => this.mutate(ctx, 'approval.rejected', 'The operator rejected this exact action.', state => {
      if (!state.approval || state.approval.id !== approvalId || state.approval.digest !== digest || state.approval.status !== 'pending') throw conflict();
      const step = state.steps.find(item => item.id === state.approval!.stepId);
      if (!step || step.status !== 'prepared') throw conflict();
      state.approval.status = 'rejected'; step.status = 'superseded'; state.status = 'waiting-input'; state.question = 'The proposed action was rejected. Supply a new direction before continuing.';
    }, revision), expectedRevision);
  }
  /** Stop authority immediately; persistence and release share a bounded shutdown budget. */
  shutdown(timeoutMs = 2000): Promise<void> {
    if (this.shutdownTask) return this.shutdownTask;
    this.closing = true;
    const contexts = [...this.leases], queued = [...this.starts.keys()].filter(id => !contexts.some(ctx => ctx.id === id));
    for (const ctx of contexts) { this.stopping.add(ctx); ctx.operation?.abort(); }
    const pause = (ctx: Owned) => this.mutate(ctx, 'run.shutdown-paused', 'Desktop shutdown paused this task.', state => {
      if (TERMINAL.has(state.status)) return;
      this.account(ctx, state); state.status = 'paused'; state.pauseRequested = true;
      state.summary = 'Desktop execution stopped. Review the retained work before resuming.';
      for (const step of state.steps.filter(item => item.status === 'running')) {
        step.status = step.effect === 'read' ? 'superseded' : 'uncertain';
        step.summary = step.effect === 'read' ? 'Desktop shutdown interrupted this read.' : 'Desktop shutdown interrupted this write. Reconcile its outcome before continuing.';
      }
    }, undefined, true);
    this.shutdownTask = withReadDeadline(async () => {
      await Promise.allSettled(contexts.map(async ctx => {
        try { await pause(ctx); } finally { await this.release(ctx); this.lose(ctx); }
      }));
      for (const id of queued) await this.control(id, pause, undefined, true).catch(() => {});
    }, Math.max(1, timeoutMs), 'Agent shutdown exceeded its time limit.').catch(() => {}).finally(() => {
      this.shutdownSettled = true;
      for (const ctx of new Set([...contexts, ...this.leases])) { this.lose(ctx); if (ctx.timer) clearInterval(ctx.timer); if (ctx.expiry) clearTimeout(ctx.expiry); this.leases.delete(ctx); }
    });
    return this.shutdownTask;
  }
  /** Recovery only reconciles interruption state. It never executes a retained action. */
  async recover(runningOnly = false): Promise<AgentRun[]> {
    if (this.closing) return [];
    const runs = await this.store.listRuns(undefined, runningOnly ? ['running'] : ['queued', 'running', 'waiting-approval', 'paused', 'waiting-input']), recovered: AgentRun[] = [];
    for (const run of runs) {
      if (this.closing) break;
      if (TERMINAL.has(run.status) || this.active.has(run.id) || (run.leaseUntil && Date.parse(run.leaseUntil) > this.now())) continue;
      if (!['queued', 'running'].includes(run.status) && this.supported(run) && !this.incompatible(run)) continue;
      const claimed = await this.store.claimRun(run.id, this.id(), this.ttl);
      if (!claimed) { recovered.push(await this.store.getRun(run.id)); continue; }
      const ctx = this.owned(claimed);
      try {
        if (!this.supported(claimed)) await this.unsupported(ctx);
        else if (this.incompatible(claimed)) await this.quarantine(ctx);
        else if (claimed.status === 'running' || claimed.steps.some(step => step.status === 'running' || (step.status === 'prepared' && step.effect !== 'read' && !['pending', 'approved'].includes(claimed.approval?.status ?? '')))) {
          await this.mutate(ctx, 'run.recovered', 'An interrupted run was paused without replaying retained actions.', state => {
            state.status = 'paused'; state.pauseRequested = true;
            for (const step of state.steps) if (step.status === 'running' || (step.status === 'prepared' && step.effect !== 'read' && !['pending', 'approved'].includes(state.approval?.status ?? ''))) step.status = 'uncertain';
            state.summary = 'Interrupted actions require reconciliation. No retained write was replayed.';
          });
        }
      } finally { await this.release(ctx); }
      recovered.push(await this.store.getRun(run.id));
    }
    return recovered;
  }
}
