import type { AgentArtifact, AgentEvent, AgentProject, AgentRun, AgentRunInput, AgentSelection, AgentStep } from '../../shared/agent-contracts';
import { withReadDeadline } from '../../shared/deadline';
import { jsonBody, request, type StorySelection } from './studio';

export type AgentToolDescription = { name: string; description: string; effect: AgentStep['effect'] };
export type AgentRuntimeStatus = {
  available: boolean; reason?: string; tools: AgentToolDescription[];
  databaseAvailable?: boolean;
  executionLocation?: string; backgroundAvailable?: boolean;
};
export type AgentRunDetail = { run: AgentRun; events: AgentEvent[] };
export type AgentAction = 'pause' | 'cancel' | 'resume' | 'redirect' | 'approve' | 'reject';
export type AgentStartDraft = {
  instruction: string; threadId: string; selection?: AgentSelection; tools?: string[];
  requestId?: string; requestFingerprint?: string; startUnconfirmed?: boolean;
};

/** A retry retains authority only for the same immutable, normalized task input. */
export function prepareAgentStart(projectId: string, draft: AgentStartDraft, allowedTools: string[], newId: () => string = () => crypto.randomUUID()) {
  const payload = {
    projectId, threadId: draft.threadId || newId(), instruction: draft.instruction.trim(),
    selection: freezeAgentSelection(draft.selection), allowedTools: [...new Set(allowedTools)].sort(),
  };
  const requestFingerprint = JSON.stringify(payload);
  const reused = Boolean(draft.requestId && draft.requestFingerprint === requestFingerprint);
  const input: AgentRunInput & { requestId: string } = { ...payload, requestId: reused ? draft.requestId! : newId() };
  return { input, requestFingerprint, reused };
}

const base = '/api/agent-runtime';
function read<T>(path: string, signal?: AbortSignal) {
  return withReadDeadline(innerSignal => request<T>(base + path, { signal: innerSignal }), 15_000,
    'The task status request timed out. Refresh to try again.', { signal });
}
export const agentApi = {
  status: (signal?: AbortSignal) => read<AgentRuntimeStatus>('/status', signal),
  projects: (signal?: AbortSignal) => read<{ projects: AgentProject[] }>('/projects', signal),
  createProject: (name: string) => request<{ project: AgentProject }>(base + '/projects', jsonBody('POST', { name })),
  runs: (projectId: string, signal?: AbortSignal) => read<{ runs: AgentRun[] }>('/runs?projectId=' + encodeURIComponent(projectId), signal),
  run: async (id: string, signal?: AbortSignal): Promise<AgentRunDetail> => {
    const data = await read<{ run: AgentRun; events?: AgentEvent[] }>('/runs/' + encodeURIComponent(id), signal);
    return { run: data.run, events: data.events || [] };
  },
  start: (input: AgentRunInput) => request<{ run: AgentRun }>(base + '/runs', jsonBody('POST', input)),
  action: (run: AgentRun, action: AgentAction, extra: { instruction?: string; approvalId?: string; digest?: string } = {}) =>
    request<{ run: AgentRun; events?: AgentEvent[] }>(base + '/runs/' + encodeURIComponent(run.id) + '/' + action,
      jsonBody('POST', { ...extra, expectedRevision: run.revision })),
};

/** Only the reviewed record identity/revision crosses into a task, not mutable UI context. */
export function freezeAgentSelection(selection: StorySelection | null | undefined): AgentSelection | undefined {
  if (!selection) return undefined;
  return { kind: selection.kind, id: selection.id, title: selection.title,
    ...(selection.siteId ? { siteId: selection.siteId } : {}),
    ...(selection.language ? { language: selection.language } : {}),
    ...(selection.revision !== undefined ? { revision: selection.revision } : {}) };
}
export function defaultAgentTools(tools: AgentToolDescription[]): string[] {
  return [...new Set(tools.filter(tool => tool.effect === 'read' || tool.effect === 'local-write').map(tool => tool.name))];
}
export function agentIsTerminal(status: AgentRun['status']) {
  return status === 'completed' || status === 'cancelled' || status === 'failed';
}
export function agentCanPause(run: AgentRun) {
  return (run.status === 'queued' || run.status === 'running') && !run.pauseRequested && !run.cancelRequested;
}
export function agentResumeIssue(run: AgentRun): string | undefined {
  if (run.status !== 'paused') return run.status === 'waiting-input' ? 'Answer the task using Send guidance below.' : 'Only a paused task can be resumed here.';
  if (run.cancelRequested) return 'This task has a stop request pending.';
  if (run.steps.some(step => step.status === 'uncertain' || step.status === 'running' || (step.status === 'failed' && step.effect !== 'read'))) return 'Inspect the failed or uncertain action receipt before starting a separate recovery task.';
  if (run.approval?.status === 'pending') return 'A pending action approval must be resolved first.';
  return undefined;
}
export function agentCanResume(run: AgentRun) { return !agentResumeIssue(run); }
export function agentApprovalKey(run: AgentRun) {
  return run.approval ? [run.id, run.revision, run.approval.id, run.approval.digest].join(':') : '';
}
/** UI guard only; the backend independently verifies the digest, grant, revision and expiry. */
export function agentApprovalIssue(run: AgentRun, now = Date.now()): string | undefined {
  if (!['waiting-approval', 'paused'].includes(run.status) || !run.approval || run.approval.status !== 'pending') return 'This task has no pending approval.';
  const expiry = Date.parse(run.approval.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now) return 'This approval has expired or its expiry is invalid. Reject it or send new guidance for a fresh proposal.';
  const step = run.steps.find(candidate => candidate.id === run.approval!.stepId);
  if (!step || step.status !== 'prepared') return 'The prepared action is no longer available. Refresh the task.';
  if (!run.allowedTools.includes(step.tool)) return 'This tool was not authorized for this task.';
  if (!/^[a-f\d]{64}$/i.test(run.approval.digest)) return 'The action digest is invalid. Refresh the task.';
  return undefined;
}
export function agentArtifactSelection(artifact: AgentArtifact): StorySelection | null {
  if (!artifact.resourceId) return null;
  if (artifact.kind === 'wordpress' && !artifact.siteId) return null;
  return { kind: artifact.kind === 'wordpress' ? 'wordpress' : 'evidence', id: artifact.resourceId,
    title: artifact.title, revision: artifact.revision, siteId: artifact.siteId, language: artifact.language };
}
/** A late poll must never replace a newer action receipt or another selected task. */
export function acceptAgentDetail(current: AgentRunDetail | null, incoming: AgentRunDetail, projectId: string, runId: string): AgentRunDetail | null {
  if (incoming.run.projectId !== projectId || incoming.run.id !== runId) return current;
  if (current?.run.id === runId && current.run.revision > incoming.run.revision) return current;
  return incoming;
}
