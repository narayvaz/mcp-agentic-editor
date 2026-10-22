import { AgentError, type AgentRun } from '../shared/agent-contracts';

export function voiceTaskReceipt(run: AgentRun) {
  return { id: run.id, revision: run.revision, status: run.status,
    instruction: run.instruction.slice(0, 1200), summary: run.summary.slice(0, 2000),
    artifacts: run.artifacts.slice(-10).map(item => ({ kind: item.kind, title: item.title.slice(0, 200), language: item.language })),
    approvalRequired: run.status === 'waiting-approval',
    note: 'Only retained task state is reported. Ended speech does not undo an action already sent.' };
}

export function createVoiceTaskBridge(options: {
  capabilities: readonly string[];
  read: (id: string) => Promise<AgentRun>;
  control: (id: string, action: 'pause' | 'cancel', revision: number, signal: AbortSignal) => Promise<AgentRun>;
}) {
  return async (action: 'status' | 'pause' | 'cancel', taskId: string, signal: AbortSignal) => {
    signal.throwIfAborted();
    const caps = new Set(options.capabilities);
    if (!caps.has('read') || !caps.has('model:request') || (action !== 'status' && !caps.has('agent:run'))) {
      throw new AgentError('This voice session cannot control tasks.', 403, 'AGENT_TOOL_DENIED');
    }
    if (!['status', 'pause', 'cancel'].includes(action)) throw new AgentError('This voice task action is unavailable.', 403, 'AGENT_TOOL_DENIED');
    const current = await options.read(taskId);
    signal.throwIfAborted();
    if (action === 'status') return voiceTaskReceipt(current);
    const result = await options.control(taskId, action, current.revision, signal);
    return voiceTaskReceipt(result);
  };
}
