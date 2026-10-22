import { randomUUID } from 'node:crypto';
import { AgentError, type AgentEvent, type AgentMutation, type AgentProject, type AgentRun, type AgentRunInput, type AgentStatus, type AgentStore } from '../shared/agent-contracts.ts';

const copy = <T>(value: T): T => structuredClone(value);
const terminal = new Set(['completed', 'failed', 'cancelled']);
const leaseLost = () => new AgentError('Lease lost.', 409, 'AGENT_LEASE_LOST');
/** Test-only store: no disk, network, credentials, or fallback for the production database. */
export class MemoryAgentStore implements AgentStore {
  readonly records = new Map<string, AgentRun>();
  readonly ledger: AgentEvent[] = [];
  readonly projects: AgentProject[] = [];
  constructor(public now: () => number = Date.now) {}
  async initialize() {} async close() {}
  async listProjects() { return copy(this.projects); }
  async createProject(name: string) { const project = { id: randomUUID(), name, createdAt: new Date(this.now()).toISOString() }; this.projects.push(project); return copy(project); }
  async createRun(input: AgentRunInput) {
    const timestamp = new Date(this.now()).toISOString();
    const run: AgentRun = { ...copy(input), id: randomUUID(), policyVersion: 1, workflowVersion: 1, status: 'queued', revision: 1,
      plan: [], steps: [], artifacts: [], summary: '', createdAt: timestamp, updatedAt: timestamp,
      limits: { maxSteps: 20, maxActiveMs: 900_000 }, activeMs: 0, cancelRequested: false, pauseRequested: false, fence: 0 };
    this.records.set(run.id, run); return copy(run);
  }
  async getRun(id: string) { const run = this.records.get(id); if (!run) throw new AgentError('Not found.', 404, 'AGENT_NOT_FOUND'); return copy(run); }
  async listRuns(projectId?: string, statuses?: AgentStatus[]) { return [...this.records.values()].filter(run => (!projectId || run.projectId === projectId) && (!statuses || statuses.includes(run.status))).map(copy); }
  async events(id: string, afterRevision = 0) { return copy(this.ledger.filter(event => event.runId === id && event.revision > afterRevision)); }
  private save(run: AgentRun, type: string, message = type) {
    run.revision++; run.updatedAt = new Date(this.now()).toISOString(); this.records.set(run.id, run);
    this.ledger.push({ id: randomUUID(), runId: run.id, revision: run.revision, type, message, createdAt: run.updatedAt });
    return copy(run);
  }
  async mutateRun(id: string, options: AgentMutation, mutate: (run: AgentRun) => void) {
    const run = await this.getRun(id);
    if (options.expectedRevision !== undefined && run.revision !== options.expectedRevision) throw new AgentError('Conflict.', 409, 'AGENT_CONFLICT');
    if (!options.lease || run.leaseOwner !== options.lease.owner || run.fence !== options.lease.fence || Date.parse(run.leaseUntil ?? '') <= this.now()) throw leaseLost();
    const identity = JSON.stringify({ id: run.id, projectId: run.projectId, selection: run.selection, instruction: run.instruction, allowedTools: run.allowedTools, policyVersion: run.policyVersion });
    mutate(run);
    if (identity !== JSON.stringify({ id: run.id, projectId: run.projectId, selection: run.selection, instruction: run.instruction, allowedTools: run.allowedTools, policyVersion: run.policyVersion })) throw new Error('Immutable identity changed.');
    return this.save(run, options.event?.type ?? 'run.updated', options.event?.message);
  }
  async claimRun(id: string, owner: string, ttlMs: number) {
    const run = await this.getRun(id);
    if (terminal.has(run.status) || [...this.records.values()].some(item => item.leaseOwner && Date.parse(item.leaseUntil ?? '') > this.now())) return null;
    const interrupted = run.steps.filter(step => step.status === 'running' || (run.leaseOwner && step.status === 'prepared' && step.effect !== 'read'));
    if (interrupted.length) {
      interrupted.forEach(step => { step.status = 'uncertain'; }); run.status = 'paused'; run.pauseRequested = true;
      run.fence++; delete run.leaseOwner; delete run.leaseUntil; this.save(run, 'run.recovery-required'); return null;
    }
    run.fence++; run.leaseOwner = owner; run.leaseUntil = new Date(this.now() + ttlMs).toISOString(); return this.save(run, 'run.claimed');
  }
  async heartbeat(id: string, owner: string, fence: number, ttlMs: number) {
    const run = this.records.get(id);
    if (!run || run.leaseOwner !== owner || run.fence !== fence || Date.parse(run.leaseUntil ?? '') <= this.now()) return false;
    run.leaseUntil = new Date(this.now() + ttlMs).toISOString(); return true;
  }
  async releaseRun(id: string, owner: string, fence: number) {
    const run = await this.getRun(id);
    if (run.leaseOwner !== owner || run.fence !== fence || Date.parse(run.leaseUntil ?? '') <= this.now()) return;
    delete run.leaseOwner; delete run.leaseUntil; this.save(run, 'run.released');
  }
  loseLease(id: string) { const run = this.records.get(id)!; run.fence++; delete run.leaseOwner; delete run.leaseUntil; }
}
