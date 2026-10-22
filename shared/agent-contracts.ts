/** Durable agent records. Retrieved content and model decisions never confer authority. */
export const AGENT_WORKFLOW_VERSION = 1;
export type AgentStatus = 'queued' | 'running' | 'waiting-approval' | 'waiting-input' | 'paused' | 'failed' | 'cancelled' | 'completed';
export type AgentSelection = { kind: 'wordpress' | 'evidence'; id: string; siteId?: string; title: string; revision?: string | number; language?: string };
export type AgentProject = { id: string; name: string; createdAt: string };
export type AgentArtifact = { id: string; kind: 'evidence' | 'draft' | 'report' | 'wordpress'; title: string; resourceId: string; revision?: string | number; siteId?: string; language?: string };
export type AgentStep = { id: string; tool: string; arguments: Record<string, unknown>; effect: 'read' | 'local-write' | 'external-write'; status: 'prepared' | 'running' | 'succeeded' | 'failed' | 'uncertain' | 'superseded'; summary: string; result?: unknown; startedAt?: string; finishedAt?: string };
export type AgentApproval = { id: string; stepId: string; digest: string; expiresAt: string; status: 'pending' | 'approved' | 'rejected' | 'consumed'; summary: string };
export type AgentEvent = { id: string; runId: string; revision: number; type: string; message: string; createdAt: string };
export type AgentRun = {
  id: string; projectId: string; threadId: string; instruction: string; selection?: AgentSelection;
  allowedTools: string[]; policyVersion: number; workflowVersion: number; status: AgentStatus; revision: number;
  plan: string[]; steps: AgentStep[]; artifacts: AgentArtifact[]; approval?: AgentApproval;
  summary: string; question?: string; createdAt: string; updatedAt: string;
  directives?: { id: string; instruction: string; createdAt: string }[];
  limits: { maxSteps: number; maxActiveMs: number }; activeMs: number;
  cancelRequested: boolean; pauseRequested: boolean;
  leaseOwner?: string; leaseUntil?: string; fence: number;
};
export type AgentRunInput = { requestId?: string; projectId: string; threadId: string; instruction: string; selection?: AgentSelection; allowedTools: string[] };
export type AgentMutation = { expectedRevision?: number; lease?: { owner: string; fence: number }; event?: { type: string; message: string } };
export interface AgentStore {
  initialize(): Promise<void>;
  close(): Promise<void>;
  listProjects(): Promise<AgentProject[]>;
  createProject(name: string): Promise<AgentProject>;
  createRun(input: AgentRunInput): Promise<AgentRun>;
  getRun(id: string): Promise<AgentRun>;
  listRuns(projectId?: string, statuses?: AgentStatus[]): Promise<AgentRun[]>;
  events(id: string, afterRevision?: number): Promise<AgentEvent[]>;
  mutateRun(id: string, options: AgentMutation, mutate: (run: AgentRun) => void): Promise<AgentRun>;
  claimRun(id: string, owner: string, ttlMs: number): Promise<AgentRun | null>;
  heartbeat(id: string, owner: string, fence: number, ttlMs: number): Promise<boolean>;
  releaseRun(id: string, owner: string, fence: number): Promise<void>;
}
export class AgentError extends Error { constructor(message: string, public status = 400, public code = 'AGENT_REQUEST') { super(message); } }
export type AgentToolContext = { run: AgentRun; signal: AbortSignal; actionId: string };
export type AgentToolResult = { summary: string; data?: unknown; artifacts?: AgentArtifact[] };
export type AgentTool = {
  name: string; description: string; effect: AgentStep['effect']; inputSchema: Record<string, unknown>;
  validate(input: unknown): Record<string, unknown>;
  execute(context: AgentToolContext, input: Record<string, unknown>): Promise<AgentToolResult>;
};
export type AgentDecision =
  | { kind: 'plan'; summary: string; plan: string[] }
  | { kind: 'tool'; summary: string; tool: string; arguments: Record<string, unknown> }
  | { kind: 'finish'; summary: string }
  | { kind: 'ask'; summary: string; question: string };
export type AgentDecider = (run: AgentRun, tools: Pick<AgentTool, 'name' | 'description' | 'inputSchema' | 'effect'>[], signal: AbortSignal) => Promise<unknown>;
