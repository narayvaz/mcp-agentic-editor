import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AgentError, type AgentArtifact, type AgentCompletionContract, type AgentDecision, type AgentMutation, type AgentRun, type AgentTool } from '../shared/agent-contracts.ts';
import { assertAgentCompletionOutputs, supportedCompletionContract, validateAgentCompletionContract, validateRetainedCompletionContract } from '../server/agent-completion.ts';
import { createPostgresAgentStore, validateAgentRunInput, validateAgentRunRecord } from '../server/agent-store.ts';
import { AgentRuntime, canonicalActionDigest } from '../server/agent-runtime.ts';
import { createAgentDecider } from '../server/agent-model.ts';
import { MemoryAgentStore } from './agent-memory-store.ts';

const contract = (minCount = 1): AgentCompletionContract => ({ version: 1, requiredArtifacts: [{ kind: 'report', minCount, language: 'hy' }] });
const report = (id = 'qa-report', language = 'hy'): AgentArtifact => ({ id, kind: 'report', title: 'QA retained report', resourceId: id, revision: 1, language });
const finish: AgentDecision = { kind: 'finish', summary: 'The retained work is ready for review.' };
const action: AgentDecision = { kind: 'tool', summary: 'Read the synthetic QA resource.', tool: 'qa.read', arguments: {} };
const code = (expected: string) => (issue: unknown) => issue instanceof AgentError && issue.code === expected;
const tool = (artifacts?: AgentArtifact[]): AgentTool => ({ name: 'qa.read', effect: 'read', description: 'Synthetic QA fixture only.', inputSchema: { type: 'object' },
  validate: () => ({}), execute: async () => ({ summary: 'Synthetic read confirmed.', ...(artifacts ? { artifacts } : {}) }) });
const sequence = (...decisions: AgentDecision[]) => { let index = 0; return async () => decisions[index++] ?? finish; };
async function fixture(completionContract?: AgentCompletionContract, store = new MemoryAgentStore()) {
  const project = await store.createProject('Completion contract QA');
  const run = await store.createRun({ projectId: project.id, threadId: 'qa-completion', instruction: 'Inspect synthetic QA only.', allowedTools: ['qa.read'], ...(completionContract ? { completionContract } : {}) });
  return { store, run };
}

test('completion contracts validate bounded, unique, non-overlapping artifact requirements', () => {
  assert.deepEqual(validateAgentCompletionContract(contract()), contract());
  assert.deepEqual(validateAgentCompletionContract({ version: 1, requiredArtifacts: [{ kind: 'draft', minCount: 2, language: 'hy-AM' }] }), { version: 1, requiredArtifacts: [{ kind: 'draft', minCount: 2, language: 'hy-am' }] });
  for (const value of [null, [], {}, { version: 2, requiredArtifacts: [] }, { ...contract(), approved: true },
    { version: 1, requiredArtifacts: [] }, { version: 1, requiredArtifacts: Array(17).fill({ kind: 'report', minCount: 1 }) },
    { version: 1, requiredArtifacts: [{ kind: 'unknown', minCount: 1 }] },
    ...[0, -1, 1.5, Infinity, 101, '1'].map(minCount => ({ version: 1, requiredArtifacts: [{ kind: 'report', minCount }] })),
    ...['', ' Armenian ', 'hy\0', 'x', 'h'.repeat(31)].map(language => ({ version: 1, requiredArtifacts: [{ kind: 'report', minCount: 1, language }] })),
    { version: 1, requiredArtifacts: [{ kind: 'report', minCount: 1, schema: 'invented' }] },
    { version: 1, requiredArtifacts: [{ kind: 'report', minCount: 1 }, { kind: 'report', minCount: 2 }] },
    { version: 1, requiredArtifacts: [{ kind: 'report', minCount: 1, language: 'HY' }, { kind: 'report', minCount: 1, language: 'hy' }] },
    { version: 1, requiredArtifacts: [{ kind: 'report', minCount: 1 }, { kind: 'report', minCount: 1, language: 'hy' }] },
    { version: 1, requiredArtifacts: [{ kind: 'report', minCount: 100 }, { kind: 'draft', minCount: 1 }] },
  ]) assert.throws(() => validateAgentCompletionContract(value), code('AGENT_VALIDATION'));
  assert.equal(supportedCompletionContract(undefined), true);
  assert.equal(supportedCompletionContract({ version: 2, futureRequirements: [] }), false);
  assert.doesNotThrow(() => validateRetainedCompletionContract({ version: 2, futureRequirements: [] }));
});

test('invalid and unsupported new contracts fail before accessing an unavailable database', async () => {
  const base = { projectId: randomUUID(), threadId: 'qa', instruction: 'QA only.', allowedTools: ['qa.read'] };
  assert.deepEqual(validateAgentRunInput({ ...base, completionContract: contract() }).completionContract, contract());
  const store = createPostgresAgentStore('postgresql://qa:synthetic@127.0.0.1:1/qa_completion');
  try {
    for (const completionContract of [{ version: 2, requiredArtifacts: [] }, { version: 1, requiredArtifacts: [] }, { ...contract(), authority: true }]) {
      await assert.rejects(store.createRun({ ...base, completionContract } as any), code('AGENT_VALIDATION'));
    }
  } finally { await store.close(); }
});

test('historical contractless runs still finish after a confirmed read', async () => {
  const { store, run } = await fixture();
  const result = await new AgentRuntime(store, [tool()], sequence(action, finish)).start(run.id);
  assert.equal(result.status, 'completed'); assert.equal(result.completionContract, undefined); assert.equal(result.workflowVersion, 1);
});

test('contracted reads cannot finish without the promised retained output', async () => {
  const { store, run } = await fixture(contract());
  const result = await new AgentRuntime(store, [tool()], sequence(action, finish)).start(run.id);
  assert.equal(result.status, 'failed'); assert.match(result.summary, /AGENT_COMPLETION_INVALID/);
  assert.equal(result.steps[0].status, 'succeeded'); assert.equal(result.artifacts.length, 0);
  assert.ok(!(await store.events(run.id)).some(event => event.type === 'run.completed'));
});

test('matching artifact receipts are retained on their producer and satisfy the contract', async () => {
  const { store, run } = await fixture(contract()); const output = report();
  const result = await new AgentRuntime(store, [tool([output])], sequence(action, finish)).start(run.id);
  assert.equal(result.status, 'completed'); assert.deepEqual((result.steps[0].result as any).artifacts, [output]);
  assert.deepEqual(result.artifacts, [output]); assert.deepEqual(result.completionContract, contract());
});

test('wrong kind, wrong language, failed receipts, uncertain receipts and unproven aggregate artifacts cannot satisfy delivery', async () => {
  const output = report();
  const success = (artifacts: AgentArtifact[], status: 'succeeded' | 'failed' | 'uncertain' = 'succeeded') => ({ id: 'qa-step', tool: 'qa.read', arguments: {}, effect: 'read' as const, status, summary: 'Synthetic receipt.', result: { artifacts } });
  for (const partial of [
    { artifacts: [{ ...output, kind: 'draft' as const }], steps: [success([{ ...output, kind: 'draft' as const }])] },
    { artifacts: [report('qa-report', 'en')], steps: [success([report('qa-report', 'en')])] },
    { artifacts: [output], steps: [success([output], 'failed')] },
    { artifacts: [output], steps: [success([output], 'uncertain')] },
    { artifacts: [output], steps: [success([])] },
    { artifacts: [output], steps: [success([{ ...output, resourceId: 'a-different-resource' }])] },
  ]) assert.throws(() => assertAgentCompletionOutputs({ completionContract: contract(), ...partial }), code('AGENT_COMPLETION_INVALID'));
});

test('duplicate IDs and aliased revisions of one resource cannot inflate output counts', () => {
  const output = report(), alias = { ...report('alias'), resourceId: output.resourceId, revision: 2 };
  for (const artifacts of [[output, output], [output, alias]]) {
    const run = { completionContract: contract(2), artifacts, steps: [{ id: 'qa-step', tool: 'qa.read', arguments: {}, effect: 'read' as const, status: 'succeeded' as const, summary: '', result: { artifacts } }] };
    assert.throws(() => assertAgentCompletionOutputs(run), code('AGENT_COMPLETION_INVALID'));
  }
  const artifacts = [output, report('second')];
  assert.doesNotThrow(() => assertAgentCompletionOutputs({ completionContract: contract(2), artifacts, steps: [{ id: 'qa-step', tool: 'qa.read', arguments: {}, effect: 'read', status: 'succeeded', summary: '', result: { artifacts } }] }));
});

test('multiple language requirements each need the corresponding retained outputs', () => {
  const completionContract: AgentCompletionContract = { version: 1, requiredArtifacts: [{ kind: 'report', language: 'hy', minCount: 1 }, { kind: 'report', language: 'en', minCount: 1 }] };
  const outputs = (artifacts: AgentArtifact[]) => ({ completionContract, artifacts, steps: [{ id: 'qa-step', tool: 'qa.read', arguments: {}, effect: 'read' as const, status: 'succeeded' as const, summary: '', result: { artifacts } }] });
  assert.throws(() => assertAgentCompletionOutputs(outputs([report()])), code('AGENT_COMPLETION_INVALID'));
  assert.doesNotThrow(() => assertAgentCompletionOutputs(outputs([report(), report('english', 'en')])));
});

test('unsupported retained contracts pause before the model or tool and remain retained for review', async () => {
  const { store, run } = await fixture(); let modelCalls = 0, toolCalls = 0;
  (store.records.get(run.id) as any).completionContract = { version: 2, futureRequirements: [{ kind: 'future' }] };
  validateAgentRunRecord(await store.getRun(run.id));
  const runtime = new AgentRuntime(store, [{ ...tool(), execute: async () => { toolCalls++; return { summary: 'Must not execute.' }; } }], async () => { modelCalls++; return action; });
  const result = await runtime.start(run.id);
  assert.equal(result.status, 'paused'); assert.equal(result.pauseRequested, true); assert.match(result.summary, /completion contract is unsupported/);
  assert.equal(modelCalls, 0); assert.equal(toolCalls, 0); assert.equal((result.completionContract as any).version, 2);
});

test('a contract cannot be weakened, removed or added through run mutation', async () => {
  for (const replacement of [undefined, contract(1), { version: 1, requiredArtifacts: [{ kind: 'draft', minCount: 1 }] }]) {
    const { store, run } = await fixture(contract(2)); const claimed = (await store.claimRun(run.id, 'qa-owner', 10_000))!;
    await assert.rejects(store.mutateRun(run.id, { lease: { owner: 'qa-owner', fence: claimed.fence } }, state => { state.completionContract = replacement as any; }), /Immutable identity changed/);
    assert.deepEqual((await store.getRun(run.id)).completionContract, contract(2));
  }
  const { store, run } = await fixture(); const claimed = (await store.claimRun(run.id, 'qa-owner', 10_000))!;
  await assert.rejects(store.mutateRun(run.id, { lease: { owner: 'qa-owner', fence: claimed.fence } }, state => { state.completionContract = contract(); }), /Immutable identity changed/);
});

test('completion rechecks receipt provenance inside its final mutation', async () => {
  class CompletionRaceStore extends MemoryAgentStore {
    override async mutateRun(id: string, options: AgentMutation, mutate: (run: AgentRun) => void) {
      if (options.event?.type === 'run.completed') {
        const retained = this.records.get(id)!;
        (retained.steps[0].result as any).artifacts = [];
      }
      return super.mutateRun(id, options, mutate);
    }
  }
  const { store, run } = await fixture(contract(), new CompletionRaceStore());
  const result = await new AgentRuntime(store, [tool([report()])], sequence(action, finish)).start(run.id);
  assert.equal(result.status, 'failed'); assert.match(result.summary, /AGENT_COMPLETION_INVALID/);
  assert.ok(!(await store.events(run.id)).some(event => event.type === 'run.completed'));
});

test('contract survives waiting and a new runtime without repeating an already confirmed tool', async () => {
  const { store, run } = await fixture(contract()); let calls = 0;
  const reader = { ...tool([report()]), execute: async () => { calls++; return { summary: 'Synthetic output retained.', artifacts: [report()] }; } };
  const first = new AgentRuntime(store, [reader], sequence(action, { kind: 'ask', summary: 'Review the retained output.', question: 'May I finish the assignment?' }));
  const waiting = await first.start(run.id); assert.equal(waiting.status, 'waiting-input'); assert.equal(calls, 1);
  const restarted = new AgentRuntime(store, [reader], sequence(finish));
  await restarted.resume(run.id); const result = await restarted.start(run.id);
  assert.equal(result.status, 'completed'); assert.equal(calls, 1); assert.deepEqual(result.completionContract, contract());
});

test('approval digest binds opted-in delivery requirements while preserving the contractless digest', async () => {
  const { run } = await fixture(); const step = { tool: 'qa.read', effect: 'read' as const, arguments: {} };
  const before = canonicalActionDigest(run, step);
  assert.equal(before, canonicalActionDigest({ ...run, completionContract: undefined }, step));
  assert.notEqual(before, canonicalActionDigest({ ...run, completionContract: contract() }, step));
  assert.notEqual(canonicalActionDigest({ ...run, completionContract: contract() }, step), canonicalActionDigest({ ...run, completionContract: contract(2) }, step));
});

test('the decider receives the immutable completion contract without changing old-run context', async () => {
  const prompts: string[] = [];
  const decide = createAgentDecider(async prompt => { prompts.push(prompt); return JSON.stringify({ kind: 'ask', summary: 'Missing output capability.', question: 'Which supported output do you need?' }); });
  const { run } = await fixture(contract()); await decide(run, [], new AbortController().signal);
  assert.deepEqual(JSON.parse(prompts[0].split('\n').at(-1)!).completionContract, contract());
  assert.match(prompts[0], /completionContract is immutable/);
  const legacy = { ...run }; delete legacy.completionContract; await decide(legacy, [], new AbortController().signal);
  assert.equal('completionContract' in JSON.parse(prompts[1].split('\n').at(-1)!), false);
});
