import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentError, type AgentDecider, type AgentTool } from '../shared/agent-contracts.ts';
import { AgentRuntime, canonicalActionDigest } from '../server/agent-runtime.ts';
import { MemoryAgentStore } from './agent-memory-store.ts';

const identity = 'a'.repeat(64), changedIdentity = 'b'.repeat(64);
const finish = { kind: 'finish', summary: 'Confirmed fixture work.' };
const propose: AgentDecider = async run => run.steps.length ? finish : { kind: 'tool', summary: 'Prepare fixture action.', tool: 'fixture.write', arguments: {} };
function tool(execute: AgentTool['execute'] = async () => ({ summary: 'Fixture effect confirmed.' })): AgentTool {
  return { name: 'fixture.write', description: 'Fake effect only.', effect: 'external-write', inputSchema: { type: 'object', properties: {} }, validate: input => input as Record<string, unknown>, execute };
}
async function fixture() {
  const store = new MemoryAgentStore(), project = await store.createProject('Binding fixtures');
  const run = await store.createRun({ projectId: project.id, threadId: 'fixture', instruction: 'Use a synthetic tool.', allowedTools: ['fixture.write'] });
  return { store, run };
}

test('same verified implementation retains exact approval across runtime restart and executes once', async () => {
  const { store, run } = await fixture(); let effects = 0;
  const descriptor = tool(async () => { effects++; return { summary: 'Fake receipt.' }; });
  const first = new AgentRuntime(store, [descriptor], propose, { executorIdentity: identity });
  const pending = await first.start(run.id), approval = pending.approval!;
  assert.equal(pending.steps[0].binding?.executorIdentity, identity);
  const approved = await first.approve(run.id, approval.id, approval.digest, pending.revision);
  const restarted = new AgentRuntime(store, [descriptor], propose, { executorIdentity: identity });
  await restarted.recover();
  assert.equal((await restarted.start(approved.id)).status, 'completed');
  await restarted.start(approved.id);
  assert.equal(effects, 1);
});

test('changed implementation quarantines an already approved action before model or tool execution', async () => {
  const { store, run } = await fixture(); let effects = 0, modelCalls = 0;
  const descriptor = tool(async () => { effects++; return { summary: 'Fake receipt.' }; });
  const first = new AgentRuntime(store, [descriptor], propose, { executorIdentity: identity });
  const pending = await first.start(run.id), approval = pending.approval!;
  await first.approve(run.id, approval.id, approval.digest, pending.revision);
  const replacement = new AgentRuntime(store, [descriptor], async () => { modelCalls++; return finish; }, { executorIdentity: changedIdentity });
  const stopped = await replacement.start(run.id);
  assert.equal(stopped.status, 'paused'); assert.equal(stopped.approval?.status, 'rejected');
  assert.equal(stopped.steps[0].status, 'prepared'); assert.equal(effects, 0); assert.equal(modelCalls, 0);
  await assert.rejects(replacement.resume(run.id, stopped.revision), /unsupported implementations/);
});

test('startup recovery visibly rejects stale waiting approval without replay', async () => {
  const { store, run } = await fixture();
  const first = new AgentRuntime(store, [tool()], propose, { executorIdentity: identity });
  await first.start(run.id);
  const replacement = new AgentRuntime(store, [tool()], async () => { throw new Error('No model call'); }, { executorIdentity: changedIdentity });
  const recovered = await replacement.recover();
  const current = await store.getRun(run.id);
  assert.equal(recovered[0].id, run.id); assert.equal(current.status, 'paused');
  assert.equal(current.approval?.status, 'rejected'); assert.equal(current.leaseOwner, undefined);
  assert.ok((await store.events(run.id)).some(event => event.type === 'run.implementation-changed'));
});

test('approve itself quarantines an incompatible pending action even before recovery', async () => {
  const { store, run } = await fixture();
  const first = new AgentRuntime(store, [tool()], propose, { executorIdentity: identity });
  const pending = await first.start(run.id), approval = pending.approval!;
  const replacement = new AgentRuntime(store, [tool()], propose, { executorIdentity: changedIdentity });
  const stopped = await replacement.approve(run.id, approval.id, approval.digest, pending.revision);
  assert.equal(stopped.status, 'paused'); assert.equal(stopped.approval?.status, 'rejected');
});

test('schema or effect changes cannot reuse approval under the same executable identity', async () => {
  for (const change of ['schema', 'effect'] as const) {
    const { store, run } = await fixture();
    const first = new AgentRuntime(store, [tool()], propose, { executorIdentity: identity });
    await first.start(run.id);
    const changed = tool();
    if (change === 'schema') changed.inputSchema = { type: 'object', required: ['different'] };
    else changed.effect = 'local-write';
    const replacement = new AgentRuntime(store, [changed], propose, { executorIdentity: identity });
    await replacement.recover();
    assert.equal((await store.getRun(run.id)).status, 'paused');
    assert.equal((await store.getRun(run.id)).approval?.status, 'rejected');
  }
});

test('an unbound prepared action remains readable but cannot gain implementation authority', async () => {
  const { store, run } = await fixture();
  const legacy = new AgentRuntime(store, [tool()], propose);
  const pending = await legacy.start(run.id);
  assert.equal(pending.steps[0].binding, undefined);
  const replacement = new AgentRuntime(store, [tool()], propose, { executorIdentity: identity });
  await replacement.recover();
  const retained = await store.getRun(run.id);
  assert.equal(retained.status, 'paused'); assert.equal(retained.steps[0].binding, undefined);
  assert.equal(retained.approval?.status, 'rejected');
});

test('legacy workflow records pause without model or tool calls and cannot resume in place', async () => {
  for (const status of ['queued', 'waiting-input', 'waiting-approval'] as const) {
    const { store, run } = await fixture(); let modelCalls = 0, effects = 0;
    const legacy = store.records.get(run.id)!;
    legacy.workflowVersion = 1; legacy.status = status;
    if (status === 'waiting-approval') {
      legacy.steps.push({ id: 'old-step', tool: 'fixture.write', effect: 'external-write', arguments: {}, status: 'prepared', summary: 'Legacy pending action.' });
      legacy.approval = { id: 'old-approval', stepId: 'old-step', digest: canonicalActionDigest(legacy, legacy.steps[0]), status: 'pending', expiresAt: new Date(Date.now() + 60_000).toISOString(), summary: 'Legacy review.' };
    }
    const runtime = new AgentRuntime(store, [tool(async () => { effects++; return { summary: 'Must not execute.' }; })], async () => { modelCalls++; return finish; }, { executorIdentity: identity });
    if (status === 'queued') await runtime.start(run.id);
    else await runtime.recover();
    const stopped = await store.getRun(run.id);
    assert.equal(stopped.workflowVersion, 1); assert.equal(stopped.status, 'paused');
    assert.match(stopped.summary, /start a new current-version task/);
    assert.equal(modelCalls, 0); assert.equal(effects, 0);
    if (status === 'waiting-approval') assert.equal(stopped.approval?.status, 'rejected');
    await assert.rejects(runtime.resume(run.id), /unsupported implementations/);
  }
});

test('completed legacy workflow history stays readable without being migrated or executed', async () => {
  const { store, run } = await fixture();
  const legacy = store.records.get(run.id)!;
  legacy.workflowVersion = 1; legacy.status = 'completed'; legacy.summary = 'Historical result.';
  const before = await store.getRun(run.id);
  const runtime = new AgentRuntime(store, [tool()], async () => { throw new Error('No model call'); }, { executorIdentity: identity });
  await runtime.recover();
  assert.deepEqual(await runtime.start(run.id), before);
});

test('protected workflow identity cannot be weakened by a run mutation', async () => {
  const { store, run } = await fixture();
  assert.equal(run.workflowVersion, 2);
  const claimed = (await store.claimRun(run.id, 'fixture-owner', 3000))!;
  await assert.rejects(store.mutateRun(run.id, { lease: { owner: claimed.leaseOwner!, fence: claimed.fence } }, state => { state.workflowVersion = 1; }), /Immutable identity changed/);
  assert.equal((await store.getRun(run.id)).workflowVersion, 2);
  await store.releaseRun(run.id, claimed.leaseOwner!, claimed.fence);
});

test('missing production identity fails closed and binding is covered by the approval digest', async () => {
  const { store, run } = await fixture();
  assert.throws(() => new AgentRuntime(store, [tool()], propose, { requireExecutionBinding: true }), error => error instanceof AgentError && error.code === 'AGENT_EXECUTOR_UNIDENTIFIED');
  const runtime = new AgentRuntime(store, [tool()], propose, { executorIdentity: identity });
  const pending = await runtime.start(run.id), step = pending.steps[0];
  assert.notEqual(canonicalActionDigest(pending, step), canonicalActionDigest(pending, { ...step, binding: undefined }));
  assert.notEqual(canonicalActionDigest(pending, step), canonicalActionDigest(pending, { ...step, binding: { ...step.binding!, executorIdentity: changedIdentity } }));
});

test('registered implementation and metadata are snapshotted against later object mutation', async () => {
  const { store, run } = await fixture(); let originalEffects = 0, mutatedEffects = 0;
  const descriptor = tool(async () => { originalEffects++; return { summary: 'Original fake effect.' }; });
  const runtime = new AgentRuntime(store, [descriptor], propose, { executorIdentity: identity });
  (descriptor.inputSchema.properties as Record<string, unknown>).later = { type: 'string' };
  descriptor.effect = 'read'; descriptor.name = 'renamed'; descriptor.execute = async () => { mutatedEffects++; return { summary: 'Unexpected fake effect.' }; };
  const pending = await runtime.start(run.id), approval = pending.approval!;
  assert.equal(pending.status, 'waiting-approval');
  await runtime.approve(run.id, approval.id, approval.digest, pending.revision);
  assert.equal((await runtime.start(run.id)).status, 'completed');
  assert.equal(originalEffects, 1); assert.equal(mutatedEffects, 0);
});

test('retained binding cannot be mutated or removed', async () => {
  const { store, run } = await fixture();
  const runtime = new AgentRuntime(store, [tool()], propose, { executorIdentity: identity });
  await runtime.start(run.id);
  const claimed = (await store.claimRun(run.id, 'test-owner', 3000))!;
  const options = { lease: { owner: claimed.leaseOwner!, fence: claimed.fence } };
  await assert.rejects(store.mutateRun(run.id, options, state => { delete state.steps[0].binding; }), /identity cannot change/);
  await assert.rejects(store.mutateRun(run.id, options, state => { state.steps[0].binding!.executorIdentity = changedIdentity; }), /identity cannot change/);
  await store.releaseRun(run.id, claimed.leaseOwner!, claimed.fence);
});

test('completed history is readable after implementation changes', async () => {
  const { store, run } = await fixture();
  const first = new AgentRuntime(store, [tool()], propose, { executorIdentity: identity });
  const pending = await first.start(run.id), approval = pending.approval!;
  await first.approve(run.id, approval.id, approval.digest, pending.revision);
  const completed = await first.start(run.id);
  const replacement = new AgentRuntime(store, [tool()], propose, { executorIdentity: changedIdentity });
  await replacement.recover();
  assert.deepEqual(await replacement.start(run.id), completed);
});

test('a build change does not authorize repeating a successful write in the same run', async () => {
  const { store, run } = await fixture(); let effects = 0;
  const descriptor = { ...tool(async () => { effects++; return { summary: 'Fake local receipt.' }; }), effect: 'local-write' as const };
  const first = new AgentRuntime(store, [descriptor], async state => state.steps.length
    ? { kind: 'ask', summary: 'Saved work.', question: 'Continue later?' }
    : { kind: 'tool', summary: 'Prepare fixture action.', tool: 'fixture.write', arguments: {} }, { executorIdentity: identity });
  assert.equal((await first.start(run.id)).status, 'waiting-input');
  const replacement = new AgentRuntime(store, [descriptor], async () => ({ kind: 'tool', summary: 'Must not repeat.', tool: 'fixture.write', arguments: {} }), { executorIdentity: changedIdentity });
  await replacement.resume(run.id);
  const stopped = await replacement.start(run.id);
  assert.equal(stopped.status, 'failed'); assert.match(stopped.summary, /AGENT_REPLAY_BLOCKED/); assert.equal(effects, 1);
});
