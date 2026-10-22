import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { AGENT_WORKFLOW_VERSION, AgentError, type AgentEvent, type AgentMutation, type AgentProject, type AgentRun, type AgentRunInput, type AgentStatus, type AgentStore } from '../shared/agent-contracts.ts';
import { migrateAgentSchema } from './agent-migrations.ts';

const MAX_STEPS = 20, MAX_ACTIVE_MS = 15 * 60_000, MAX_JSON_BYTES = 1_000_000;
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const STATUSES = new Set(['queued', 'running', 'waiting-approval', 'waiting-input', 'paused', ...TERMINAL]);
const copy = <T>(value: T): T => structuredClone(value);
const invalid = (message: string): never => { throw new AgentError(message, 400, 'AGENT_VALIDATION'); };
const unavailable = () => new AgentError('Agent database is unavailable. No local fallback was used; reconnect before continuing.', 503, 'AGENT_STORE_UNAVAILABLE');
const leaseLost = () => new AgentError('The agent execution lease expired or changed. Refresh the run before continuing.', 409, 'AGENT_LEASE_LOST');
const conflict = () => new AgentError('This run changed. Refresh its current revision before continuing.', 409, 'AGENT_CONFLICT');
const notFound = () => new AgentError('Agent run was not found.', 404, 'AGENT_NOT_FOUND');

function uuid(value: unknown, field = 'id'): string {
  if (typeof value !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)) invalid(`${field} must be a UUID.`);
  return (value as string).toLowerCase();
}
function text(value: unknown, max: number, field: string, required = true): string {
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || (required && !value.trim())) invalid(`${field} must be ${required ? 'non-empty ' : ''}text of at most ${max} characters.`);
  return (value as string).trim();
}
function integer(value: unknown, min: number, max: number, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) invalid(`${field} is outside its supported bounds.`);
  return value as number;
}
function record(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(`${field} must be an object.`);
}
function serialized(value: unknown): string {
  let output: string;
  try {
    const active = new Set<object>();
    const check = (item: unknown, depth: number) => {
      if (depth > 30) invalid('Agent data is too deeply nested.');
      if (typeof item === 'string' && item.includes('\0')) invalid('Agent data cannot contain null characters.');
      if (item === undefined || item === null || typeof item === 'string' || typeof item === 'boolean') return;
      if (typeof item === 'number' && Number.isFinite(item)) return;
      if (typeof item !== 'object' || active.has(item as object)) invalid('Agent data must contain finite, acyclic JSON values.');
      if (!Array.isArray(item)) record(item, 'Agent data');
      active.add(item as object);
      for (const child of Object.values(item as object)) check(child, depth + 1);
      active.delete(item as object);
    };
    check(value, 0); output = JSON.stringify(value);
  } catch (issue) { if (issue instanceof AgentError) throw issue; return invalid('Agent data must be serializable JSON.'); }
  if (!output! || Buffer.byteLength(output, 'utf8') > MAX_JSON_BYTES) invalid('Agent data exceeds the storage limit.');
  return output;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Validation runs before database access, including when the database is offline. */
export function validateAgentRunInput(value: unknown): AgentRunInput {
  record(value, 'Run input');
  if (Object.keys(value).some(key => !['requestId', 'projectId', 'threadId', 'instruction', 'selection', 'allowedTools'].includes(key))) invalid('Run input contains unsupported fields.');
  const requestId = value.requestId === undefined ? undefined : uuid(value.requestId, 'requestId');
  const projectId = uuid(value.projectId, 'projectId');
  const threadId = text(value.threadId, 200, 'threadId');
  const instruction = text(value.instruction, 20_000, 'instruction');
  if (!Array.isArray(value.allowedTools) || value.allowedTools.length < 1 || value.allowedTools.length > 32) invalid('allowedTools must contain between 1 and 32 tool names.');
  const allowedTools = (value.allowedTools as unknown[]).map(item => text(item, 120, 'Tool name'));
  if (allowedTools.some(name => !/^[a-z][a-z\d_.:-]*$/i.test(name)) || new Set(allowedTools).size !== allowedTools.length) invalid('Tool names must be valid and unique.');
  let selection: AgentRunInput['selection'];
  if (value.selection !== undefined) {
    record(value.selection, 'selection');
    const item = value.selection;
    if (Object.keys(item).some(key => !['kind', 'id', 'title', 'siteId', 'revision', 'language'].includes(key))) invalid('Selection contains unsupported fields.');
    if (!['wordpress', 'evidence'].includes(item.kind as string)) invalid('Selection kind is not supported.');
    selection = { kind: item.kind as 'wordpress' | 'evidence', id: text(item.id, 200, 'selection.id'), title: text(item.title, 1000, 'selection.title') };
    if (item.siteId !== undefined) selection.siteId = text(item.siteId, 200, 'selection.siteId');
    if (item.language !== undefined) selection.language = text(item.language, 30, 'selection.language');
    if (item.revision !== undefined) selection.revision = typeof item.revision === 'number' ? integer(item.revision, 0, Number.MAX_SAFE_INTEGER, 'selection.revision') : text(item.revision, 200, 'selection.revision');
  }
  const result = { projectId, threadId, instruction, allowedTools, ...(selection ? { selection } : {}), ...(requestId ? { requestId } : {}) };
  serialized(result); return result;
}

export function validateAgentRunRecord(run: AgentRun): void {
  record(run, 'Run'); record(run.limits, 'Run limits');
  uuid(run.id); uuid(run.projectId, 'projectId');
  if (!STATUSES.has(run.status)) invalid('Run status is not supported.');
  integer(run.revision, 1, 2_147_483_647, 'revision'); integer(run.fence, 0, Number.MAX_SAFE_INTEGER, 'fence');
  integer(run.limits?.maxSteps, 1, MAX_STEPS, 'maxSteps'); integer(run.limits?.maxActiveMs, 1, MAX_ACTIVE_MS, 'maxActiveMs');
  integer(run.activeMs, 0, Number.MAX_SAFE_INTEGER, 'activeMs');
  if (typeof run.cancelRequested !== 'boolean' || typeof run.pauseRequested !== 'boolean') invalid('Run controls must be booleans.');
  text(run.summary, 30_000, 'summary', false);
  if (run.question !== undefined) text(run.question, 10_000, 'question');
  if (!Array.isArray(run.plan) || run.plan.length > MAX_STEPS) invalid('Plan exceeds the supported step limit.');
  run.plan.forEach(item => text(item, 2000, 'Plan step'));
  if (!Array.isArray(run.steps) || run.steps.length > run.limits.maxSteps) invalid('Run exceeds its step limit.');
  const stepIds = new Set<string>();
  for (const step of run.steps) {
    record(step, 'Step');
    const id = text(step.id, 200, 'Step id');
    if (stepIds.has(id)) invalid('Step IDs must be unique.'); stepIds.add(id);
    if (!run.allowedTools.includes(step.tool)) invalid('Step tool is outside this run’s allowed tools.');
    if (!['read', 'local-write', 'external-write'].includes(step.effect) || !['prepared', 'running', 'succeeded', 'failed', 'uncertain', 'superseded'].includes(step.status)) invalid('Step state is not supported.');
    text(step.summary, 20_000, 'Step summary', false); record(step.arguments, 'Step arguments');
  }
  if (!Array.isArray(run.artifacts) || run.artifacts.length > 100) invalid('Run artifacts exceed the supported limit.');
  for (const artifact of run.artifacts) {
    record(artifact, 'Artifact');
    text(artifact.id, 200, 'Artifact id'); text(artifact.title, 1000, 'Artifact title'); text(artifact.resourceId, 2000, 'Artifact resource');
    if (!['evidence', 'draft', 'report', 'wordpress'].includes(artifact.kind)) invalid('Artifact kind is not supported.');
  }
  if (run.approval) {
    record(run.approval, 'Approval');
    text(run.approval.id, 200, 'Approval id');
    if (!stepIds.has(run.approval.stepId) || !/^[a-f\d]{64}$/i.test(run.approval.digest) || !Number.isFinite(Date.parse(run.approval.expiresAt))) invalid('Approval must identify a retained step, digest and expiry.');
    if (!['pending', 'approved', 'rejected', 'consumed'].includes(run.approval.status)) invalid('Approval status is not supported.');
    text(run.approval.summary, 20_000, 'Approval summary', false);
  }
  if (run.directives !== undefined) {
    if (!Array.isArray(run.directives) || run.directives.length > 20) invalid('Run directives exceed the supported limit.');
    const directiveIds = new Set<string>();
    for (const directive of run.directives) {
      record(directive, 'Directive'); text(directive.id, 200, 'Directive id'); text(directive.instruction, 20_000, 'Directive instruction');
      if (!Number.isFinite(Date.parse(directive.createdAt)) || directiveIds.has(directive.id)) invalid('Directives require unique identifiers and valid timestamps.');
      directiveIds.add(directive.id);
    }
  }
  serialized(run);
}

type RunRow = { data: AgentRun; lease_owner: string | null; lease_until: Date | null; fence: string; revision: number; now: Date };
function hydrate(row: RunRow): AgentRun {
  const result = copy(row.data);
  result.fence = Number(row.fence); result.revision = row.revision;
  if (row.lease_owner && row.lease_until) { result.leaseOwner = row.lease_owner; result.leaseUntil = row.lease_until.toISOString(); }
  else { delete result.leaseOwner; delete result.leaseUntil; }
  return result;
}
function checkLease(row: RunRow, owner: string, fence: number): void {
  if (row.lease_owner !== owner || Number(row.fence) !== fence || !row.lease_until || row.lease_until <= row.now) throw leaseLost();
}
function leaseInput(owner: unknown, fence?: unknown, ttlMs?: unknown) {
  text(owner, 200, 'Lease owner');
  if (fence !== undefined) integer(fence, 1, Number.MAX_SAFE_INTEGER, 'Lease fence');
  if (ttlMs !== undefined) integer(ttlMs, 100, 120_000, 'Lease duration');
}

class PostgresAgentStore implements AgentStore {
  private pool: Pool;
  private initialization?: Promise<void>;
  private closed = false;
  constructor(url: string) {
    try {
      const parsed = new URL(url);
      const socketHost = parsed.searchParams.get('host');
      if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || (!parsed.hostname && !socketHost?.startsWith('/'))) throw unavailable();
      this.pool = new Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 3000, idleTimeoutMillis: 30_000, statement_timeout: 10_000, query_timeout: 12_000, allowExitOnIdle: true });
      this.pool.on('error', () => { /* No connection strings or raw provider errors enter logs. */ });
    } catch { throw unavailable(); }
  }
  async initialize(): Promise<void> {
    if (this.closed) throw unavailable();
    if (!this.initialization) this.initialization = migrateAgentSchema(this.pool).catch(() => { this.initialization = undefined; throw unavailable(); });
    await this.initialization;
  }
  async close(): Promise<void> { this.closed = true; try { await this.pool.end(); } catch { throw unavailable(); } }
  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    await this.initialize();
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect(); await client.query('BEGIN');
      const result = await work(client); await client.query('COMMIT'); return copy(result);
    } catch (issue) {
      if (client) try { await client.query('ROLLBACK'); } catch { /* Safe error below. */ }
      if (issue instanceof AgentError) throw issue;
      throw unavailable();
    } finally { client?.release(); }
  }
  private async locked(client: PoolClient, id: string): Promise<RunRow> {
    // Read the database clock AFTER obtaining the row lock, so time spent waiting cannot validate an expired lease.
    const result = await client.query<RunRow>('SELECT data, lease_owner, lease_until, fence, revision FROM azat_agent.runs WHERE id = $1 FOR UPDATE', [id]);
    if (!result.rows[0]) throw notFound();
    const clock = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');
    return { ...result.rows[0], now: clock.rows[0].now };
  }
  private async save(client: PoolClient, run: AgentRun, event: { type: string; message: string }, now: Date, lease?: { owner: string; fence: number }): Promise<void> {
    validateAgentRunRecord(run); text(event.type, 120, 'Event type'); text(event.message, 20_000, 'Event message', false);
    const updated = await client.query(`UPDATE azat_agent.runs SET revision=$2, status=$3, data=$4::jsonb,
      lease_owner=$5, lease_until=$6, fence=$7, updated_at=$8 WHERE id=$1
      AND ($9::text IS NULL OR (lease_owner=$9 AND fence=$10 AND lease_until>clock_timestamp()))`,
    [run.id, run.revision, run.status, serialized(run), run.leaseOwner ?? null, run.leaseUntil ?? null, run.fence, now, lease?.owner ?? null, lease?.fence ?? null]);
    if (!updated.rowCount) throw leaseLost();
    await client.query('INSERT INTO azat_agent.events(id,run_id,revision,type,message,created_at) VALUES($1,$2,$3,$4,$5,$6)', [randomUUID(), run.id, run.revision, event.type, event.message, now]);
  }
  async listProjects(): Promise<AgentProject[]> {
    return this.transaction(async client => {
      const result = await client.query('SELECT id,name,created_at FROM azat_agent.projects ORDER BY created_at,id');
      return result.rows.map(row => ({ id: row.id, name: row.name, createdAt: row.created_at.toISOString() }));
    });
  }
  async createProject(name: string): Promise<AgentProject> {
    const normalized = text(name, 200, 'Project name');
    return this.transaction(async client => {
      const result = await client.query('INSERT INTO azat_agent.projects(id,name) VALUES($1,$2) RETURNING id,name,created_at', [randomUUID(), normalized]);
      const row = result.rows[0]; return { id: row.id, name: row.name, createdAt: row.created_at.toISOString() };
    });
  }
  async createRun(input: AgentRunInput): Promise<AgentRun> {
    const normalized = validateAgentRunInput(input);
    const { requestId, ...immutableInput } = normalized;
    return this.transaction(async client => {
      const project = await client.query('SELECT id FROM azat_agent.projects WHERE id=$1 FOR KEY SHARE', [normalized.projectId]);
      if (!project.rowCount) throw new AgentError('Choose an existing agent project.', 404, 'AGENT_NOT_FOUND');
      const clock = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now'); const now = clock.rows[0].now;
      const run: AgentRun = { ...immutableInput, id: requestId ?? randomUUID(), policyVersion: 1, workflowVersion: AGENT_WORKFLOW_VERSION, status: 'queued', revision: 1,
        plan: [], steps: [], artifacts: [], summary: '', createdAt: now.toISOString(), updatedAt: now.toISOString(),
        limits: { maxSteps: MAX_STEPS, maxActiveMs: MAX_ACTIVE_MS }, activeMs: 0, cancelRequested: false, pauseRequested: false, fence: 0 };
      validateAgentRunRecord(run);
      const inserted = await client.query('INSERT INTO azat_agent.runs(id,project_id,revision,status,data,created_at,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$6) ON CONFLICT (id) DO NOTHING RETURNING id', [run.id, run.projectId, run.revision, run.status, serialized(run), now]);
      if (!inserted.rowCount) {
        const existing = hydrate(await this.locked(client, run.id));
        const retainedInput = { projectId: existing.projectId, threadId: existing.threadId, instruction: existing.instruction, selection: existing.selection, allowedTools: existing.allowedTools };
        if (canonical(retainedInput) !== canonical(immutableInput)) throw conflict();
        return existing;
      }
      await client.query('INSERT INTO azat_agent.events(id,run_id,revision,type,message,created_at) VALUES($1,$2,1,$3,$4,$5)', [randomUUID(), run.id, 'run.created', 'Agent run queued.', now]);
      return run;
    });
  }
  async getRun(id: string): Promise<AgentRun> {
    const key = uuid(id);
    return this.transaction(async client => {
      const result = await client.query<RunRow>('SELECT data,lease_owner,lease_until,fence,revision FROM azat_agent.runs WHERE id=$1', [key]);
      if (!result.rows[0]) throw notFound(); return hydrate(result.rows[0]);
    });
  }
  async listRuns(projectId?: string, statuses?: AgentStatus[]): Promise<AgentRun[]> {
    const project = projectId === undefined ? undefined : uuid(projectId, 'projectId');
    if (statuses !== undefined && (!Array.isArray(statuses) || !statuses.length || statuses.length > STATUSES.size || statuses.some(status => !STATUSES.has(status)))) invalid('Run status filter must contain supported statuses.');
    const filteredStatuses = statuses === undefined ? undefined : [...new Set(statuses)];
    return this.transaction(async client => {
      const values: unknown[] = [], conditions: string[] = [];
      if (project) { values.push(project); conditions.push(`project_id=$${values.length}`); }
      if (filteredStatuses) { values.push(filteredStatuses); conditions.push(`status=ANY($${values.length}::text[])`); }
      const result = await client.query<RunRow>(`SELECT data,lease_owner,lease_until,fence,revision FROM azat_agent.runs
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY ${filteredStatuses ? 'created_at ASC' : 'updated_at DESC'},id LIMIT 200`, values);
      return result.rows.map(hydrate);
    });
  }
  async events(id: string, afterRevision = 0): Promise<AgentEvent[]> {
    const key = uuid(id); integer(afterRevision, 0, 2_147_483_647, 'afterRevision');
    return this.transaction(async client => {
      if (!(await client.query('SELECT id FROM azat_agent.runs WHERE id=$1', [key])).rowCount) throw notFound();
      const result = await client.query('SELECT id,run_id,revision,type,message,created_at FROM azat_agent.events WHERE run_id=$1 AND revision>$2 ORDER BY revision', [key, afterRevision]);
      return result.rows.map(row => ({ id: row.id, runId: row.run_id, revision: row.revision, type: row.type, message: row.message, createdAt: row.created_at.toISOString() }));
    });
  }
  async mutateRun(id: string, options: AgentMutation, mutate: (run: AgentRun) => void): Promise<AgentRun> {
    const key = uuid(id); record(options, 'Mutation options');
    if (options.expectedRevision !== undefined) integer(options.expectedRevision, 1, 2_147_483_647, 'expectedRevision');
    if (options.lease) leaseInput(options.lease.owner, options.lease.fence);
    return this.transaction(async client => {
      const row = await this.locked(client, key), previous = hydrate(row);
      if (options.expectedRevision !== undefined && options.expectedRevision !== previous.revision) throw conflict();
      if (options.lease) checkLease(row, options.lease.owner, options.lease.fence);
      else if (row.lease_owner) throw leaseLost();
      else if (options.expectedRevision === undefined) throw conflict();
      const next = copy(previous); const result: unknown = mutate(next);
      if (result && typeof (result as Promise<unknown>).then === 'function') invalid('Run mutation must be synchronous.');
      for (const field of ['id','projectId','threadId','instruction','selection','allowedTools','policyVersion','workflowVersion','createdAt','limits','revision','fence','leaseOwner','leaseUntil'] as const) {
        if (serialized({ value: next[field] }) !== serialized({ value: previous[field] })) invalid(`Run ${field} cannot be changed by a mutation.`);
      }
      if (next.activeMs < previous.activeMs) invalid('Run active time cannot decrease.');
      if (next.steps.length < previous.steps.length) invalid('Retained action history cannot be removed.');
      for (const [index, step] of previous.steps.entries()) {
        const replacement = next.steps[index];
        if (!replacement || serialized({ id: step.id, tool: step.tool, arguments: step.arguments, effect: step.effect }) !== serialized({ id: replacement.id, tool: replacement.tool, arguments: replacement.arguments, effect: replacement.effect })) invalid('Retained action identity and arguments cannot be changed.');
        if (['succeeded', 'failed', 'uncertain', 'superseded'].includes(step.status) && ['prepared', 'running'].includes(replacement.status)) invalid('A retained action cannot be replayed.');
      }
      if ((previous.directives ?? []).some((directive, index) => serialized(directive) !== serialized(next.directives?.[index]))) invalid('Retained directives cannot be changed or removed.');
      next.revision++; next.updatedAt = row.now.toISOString();
      await this.save(client, next, options.event ?? { type: 'run.updated', message: 'Agent run updated.' }, row.now, options.lease);
      return next;
    });
  }
  async claimRun(id: string, owner: string, ttlMs: number): Promise<AgentRun | null> {
    const key = uuid(id); leaseInput(owner, undefined, ttlMs);
    return this.transaction(async client => {
      // Every claimant takes the same transaction lock: globally only one live lease is permitted.
      await client.query('SELECT pg_advisory_xact_lock(1096434004, 2)');
      const row = await this.locked(client, key), run = hydrate(row);
      if (TERMINAL.has(run.status)) return null;
      const active = await client.query('SELECT id FROM azat_agent.runs WHERE lease_owner IS NOT NULL AND lease_until > clock_timestamp() LIMIT 1');
      if (active.rowCount) return null;
      const interrupted = run.steps.filter(step => step.status === 'running' || (row.lease_owner && step.status === 'prepared' && step.effect !== 'read'));
      if (interrupted.length) {
        for (const step of interrupted) { step.status = 'uncertain'; step.summary = 'Execution was interrupted. Reconcile the retained action before taking further steps.'; }
        run.status = 'paused'; run.pauseRequested = true;
        run.summary = 'An interrupted action has an uncertain outcome and requires review.';
        run.fence++; delete run.leaseOwner; delete run.leaseUntil;
        run.revision++; run.updatedAt = row.now.toISOString();
        await this.save(client, run, { type: 'run.recovery-required', message: run.summary }, row.now);
        return null;
      }
      run.fence++; run.leaseOwner = owner; run.leaseUntil = new Date(row.now.getTime() + ttlMs).toISOString();
      run.revision++; run.updatedAt = row.now.toISOString();
      await this.save(client, run, { type: 'run.claimed', message: 'Execution lease acquired.' }, row.now);
      return run;
    });
  }
  async heartbeat(id: string, owner: string, fence: number, ttlMs: number): Promise<boolean> {
    const key = uuid(id); leaseInput(owner, fence, ttlMs);
    return this.transaction(async client => {
      const row = await this.locked(client, key);
      if (row.lease_owner !== owner || Number(row.fence) !== fence || !row.lease_until || row.lease_until <= row.now) return false;
      const run = hydrate(row); run.leaseUntil = new Date(row.now.getTime() + ttlMs).toISOString();
      // A heartbeat changes lease metadata only. Approval and optimistic concurrency revisions stay stable.
      await client.query('UPDATE azat_agent.runs SET lease_until=$2,data=$3::jsonb WHERE id=$1', [key, run.leaseUntil, serialized(run)]);
      return true;
    });
  }
  async releaseRun(id: string, owner: string, fence: number): Promise<void> {
    const key = uuid(id); leaseInput(owner, fence);
    return this.transaction(async client => {
      const row = await this.locked(client, key);
      if (row.lease_owner !== owner || Number(row.fence) !== fence || !row.lease_until || row.lease_until <= row.now) return;
      const run = hydrate(row); delete run.leaseOwner; delete run.leaseUntil;
      run.revision++; run.updatedAt = row.now.toISOString();
      await this.save(client, run, { type: 'run.released', message: 'Execution lease released.' }, row.now);
    });
  }
}

export function createPostgresAgentStore(url: string): AgentStore { return new PostgresAgentStore(url); }
