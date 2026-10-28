import { AgentError, type AgentArtifact, type AgentCompletionContract, type AgentRun } from '../shared/agent-contracts.ts';

const KINDS = new Set(['evidence', 'draft', 'report', 'wordpress']);
const invalid = (): never => { throw new AgentError('The completion contract is invalid or exceeds its supported bounds.', 400, 'AGENT_VALIDATION'); };
const incomplete = (): never => { throw new AgentError('Completion requires the promised retained outputs from successful tool receipts.', 409, 'AGENT_COMPLETION_INVALID'); };
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const boundedText = (value: unknown, max: number) => typeof value === 'string' && !!value.trim() && value.length <= max && !value.includes('\0');

/** New inputs accept only the implemented contract version; no model output can change it. */
export function validateAgentCompletionContract(value: unknown): AgentCompletionContract {
  if (!plain(value) || Object.keys(value).some(key => !['version', 'requiredArtifacts'].includes(key)) || value.version !== 1) return invalid();
  if (!Array.isArray(value.requiredArtifacts) || value.requiredArtifacts.length < 1 || value.requiredArtifacts.length > 16) return invalid();
  const selectors = new Set<string>();
  let total = 0;
  const requiredArtifacts = value.requiredArtifacts.map(item => {
    if (!plain(item) || Object.keys(item).some(key => !['kind', 'minCount', 'language'].includes(key)) || !KINDS.has(item.kind as string)) return invalid();
    if (!Number.isSafeInteger(item.minCount) || Number(item.minCount) < 1 || Number(item.minCount) > 100 || (total += Number(item.minCount)) > 100) return invalid();
    let language: string | undefined;
    if (item.language !== undefined) {
      if (!boundedText(item.language, 30) || !/^[a-z]{2,3}(?:-[a-z\d]{2,8})*$/i.test(item.language as string)) return invalid();
      language = (item.language as string).toLowerCase();
    }
    const selector = `${item.kind}:${language ?? '*'}`;
    if (selectors.has(selector)) return invalid();
    selectors.add(selector);
    return { kind: item.kind as AgentArtifact['kind'], minCount: item.minCount as number, ...(language ? { language } : {}) };
  });
  // A language-free requirement means a total, not another output slot. Reject
  // overlapping selectors so one output cannot masquerade as two obligations.
  for (const item of requiredArtifacts) if (item.language && selectors.has(`${item.kind}:*`)) return invalid();
  return { version: 1, requiredArtifacts };
}

/** Preserve future retained envelopes so the runtime can pause them without executing or migrating them. */
export function validateRetainedCompletionContract(value: unknown): void {
  if (!plain(value) || !Number.isSafeInteger(value.version) || Number(value.version) < 1) return invalid();
  if (value.version === 1) validateAgentCompletionContract(value);
}

export function supportedCompletionContract(value: unknown): boolean {
  if (value === undefined) return true;
  try { validateAgentCompletionContract(value); return true; } catch { return false; }
}

function artifact(value: unknown): value is AgentArtifact {
  if (!plain(value) || !KINDS.has(value.kind as string) || !boundedText(value.id, 200) || !boundedText(value.title, 1000) || !boundedText(value.resourceId, 2000)) return false;
  if (value.siteId !== undefined && !boundedText(value.siteId, 200)) return false;
  if (value.language !== undefined && !boundedText(value.language, 30)) return false;
  return value.revision === undefined || boundedText(value.revision, 200) || (Number.isSafeInteger(value.revision) && Number(value.revision) >= 0);
}
function identity(value: AgentArtifact): string {
  return JSON.stringify([value.id, value.kind, value.title, value.resourceId, value.revision ?? null, value.siteId ?? null, value.language ?? null]);
}

/** Delivery foundation only: no claim that content is valid, verified, publishable or still exists remotely. */
export function assertAgentCompletionOutputs(run: Pick<AgentRun, 'completionContract' | 'steps' | 'artifacts'>): void {
  if (run.completionContract === undefined) return;
  let contract: AgentCompletionContract;
  try { contract = validateAgentCompletionContract(run.completionContract); } catch { return incomplete(); }
  const receipts = new Set(run.steps.filter(step => step.status === 'succeeded').flatMap(step => {
    if (!plain(step.result) || !Array.isArray(step.result.artifacts) || step.result.artifacts.length > 10) return [];
    return step.result.artifacts.filter(artifact).map(identity);
  }));
  const ids = new Set<string>(), resources = new Set<string>();
  const confirmed = run.artifacts.filter(item => {
    if (!artifact(item) || !receipts.has(identity(item)) || ids.has(item.id)) return false;
    // Multiple IDs or revisions of the same output cannot inflate a delivery count.
    const resource = JSON.stringify([item.kind, item.resourceId, item.siteId ?? null, item.language?.toLowerCase() ?? null]);
    if (resources.has(resource)) return false;
    ids.add(item.id); resources.add(resource); return true;
  });
  for (const requirement of contract.requiredArtifacts) {
    const count = confirmed.filter(item => item.kind === requirement.kind && (!requirement.language || item.language?.toLowerCase() === requirement.language)).length;
    if (count < requirement.minCount) return incomplete();
  }
}
