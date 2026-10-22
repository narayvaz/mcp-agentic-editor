import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentError, type AgentDecision, type AgentMutation, type AgentRun, type AgentStep, type AgentTool } from '../shared/agent-contracts.ts';
import { AgentRuntime, canonicalActionDigest, validateAgentDecision } from '../server/agent-runtime.ts';
import { MemoryAgentStore } from './agent-memory-store.ts';

const deferred = <T = void>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const delay = (ms: number) => new Promise(done => setTimeout(done, ms));
const finish: AgentDecision = { kind: 'finish', summary: 'Completed with retained evidence.' };
const action = (tool = 'read', arguments_: Record<string, unknown> = {}): AgentDecision => ({ kind: 'tool', tool, arguments: arguments_, summary: 'Use the selected resource.' });
async function fixture(names = ['read'], store = new MemoryAgentStore()) {
  const project = await store.createProject('QA only');
  const run = await store.createRun({ projectId: project.id, threadId: 'qa-thread', instruction: 'Inspect the selected QA record.', selection: { kind: 'evidence', id: 'qa-record', title: 'QA record', revision: 1 }, allowedTools: names });
  return { store, run };
}
function tool(name = 'read', effect: AgentStep['effect'] = 'read', execute: AgentTool['execute'] = async () => ({ summary: 'Read confirmed.', data: { value: 1 } })): AgentTool {
  return { name, effect, description: 'QA only', inputSchema: { type: 'object' }, validate(input) { assert.ok(input && typeof input === 'object' && !Array.isArray(input)); return input as Record<string, unknown>; }, execute };
}
function sequence(...decisions: unknown[]) { let index = 0; return async () => decisions[index++] ?? finish; }
const errorCode = (code: string) => (error: unknown) => error instanceof AgentError && error.code === code;

test('decisions reject unknown authority, malformed JSON, unsafe shapes and secret arguments', () => {
  for (const value of [ '{bad', { ...finish, execute: true }, { kind: 'tool', tool: 'read', summary: 'x', arguments: { authorization: 'secret' } },
    { kind: 'tool', tool: 'read', summary: 'x', arguments: JSON.parse('{"__proto__":{}}') }, { kind: 'plan', summary: 'x', plan: Array(9).fill('x') },
    { kind: 'tool', tool: 'read', summary: 'x', arguments: { value: Infinity } }, { kind: 'finish', summary: '' } ]) assert.throws(() => validateAgentDecision(value), errorCode('AGENT_DECISION_INVALID'));
  assert.deepEqual(validateAgentDecision(JSON.stringify(action())), action());
});

test('canonical digest is stable but binds action, project, run, selection and policy', async () => {
  const { run } = await fixture(); const step = { tool: 'read', effect: 'read' as const, arguments: { b: 2, a: { d: 4, c: 3 } } };
  const digest = canonicalActionDigest(run, step);
  assert.equal(digest, canonicalActionDigest(run, { ...step, arguments: { a: { c: 3, d: 4 }, b: 2 } }));
  for (const replacement of [{ id: 'other-run' }, { projectId: 'other-project' }, { policyVersion: 2 }, { workflowVersion: 2 }, { selection: { ...run.selection!, revision: 2 } }]) assert.notEqual(digest, canonicalActionDigest({ ...run, ...replacement }, step));
  assert.notEqual(digest, canonicalActionDigest(run, { ...step, arguments: { b: 3 } }));
});

test('prepared action is durable before execution and context cannot mutate frozen selection', async () => {
  const { store, run } = await fixture(['read', 'save']); let calls = 0;
  const read = tool('read', 'read', async context => {
    const current = await store.getRun(run.id); assert.equal(current.steps[0].status, 'running'); assert.ok((await store.events(run.id)).some(event => event.type === 'step.prepared'));
    context.run.selection!.id = 'attempted-mutation'; calls++; return { summary: 'Read confirmed.', data: { source: 'QA' } };
  });
  const save = tool('save', 'local-write', async () => ({ summary: 'Created a local QA record.', artifacts: [{ id: 'artifact', kind: 'evidence', resourceId: 'qa-created', title: 'QA draft' }] }));
  const runtime = new AgentRuntime(store, [read, save], sequence(action(), action('save'), finish));
  const result = await runtime.start(run.id);
  assert.equal(result.status, 'completed'); assert.equal(calls, 1); assert.equal(result.selection?.id, 'qa-record'); assert.equal(result.artifacts[0].resourceId, 'qa-created');
  assert.deepEqual(result.steps.map(step => step.status), ['succeeded', 'succeeded']); assert.equal(result.leaseOwner, undefined);
  await runtime.start(run.id); assert.equal(calls, 1);
});

test('execution is globally serial and a second runtime cannot take an active lease', async () => {
  const { store, run } = await fixture(); const second = await store.createRun({ projectId: run.projectId, threadId: 'qa-2', instruction: 'Read QA.', allowedTools: ['read'] });
  const entered = deferred(), release = deferred(); let calls = 0, active = 0, maxActive = 0;
  const read = tool('read', 'read', async () => { calls++; active++; maxActive = Math.max(maxActive, active); if (calls === 1) { entered.resolve(); await release.promise; } active--; return { summary: 'Read confirmed.' }; });
  const decide = async (state: AgentRun) => state.steps.length ? finish : action();
  const runtime = new AgentRuntime(store, [read], decide), other = new AgentRuntime(store, [read], decide);
  const first = runtime.start(run.id); await entered.promise;
  assert.equal((await other.start(second.id)).status, 'queued'); assert.equal(calls, 1);
  const next = runtime.start(second.id); release.resolve(); await Promise.all([first, next]); assert.equal(maxActive, 1); assert.equal(calls, 2);
});

test('external write requires exact revision-bound approval, fresh authorization, and one consumption', async () => {
  const { store, run } = await fixture(['publish']); let writes = 0; const phases: string[] = [];
  const runtime = new AgentRuntime(store, [tool('publish', 'external-write', async () => { writes++; return { summary: 'Confirmed external receipt.', data: { revision: 'remote-2' } }; })], sequence(action('publish'), finish), { authorize: context => { phases.push(context.phase); return true; } });
  const pending = await runtime.start(run.id); assert.equal(pending.status, 'waiting-approval'); assert.equal(writes, 0);
  const approval = pending.approval!;
  await assert.rejects(runtime.approve(run.id, approval.id, '0'.repeat(64), pending.revision), errorCode('AGENT_APPROVAL_INVALID'));
  const fresh = await store.getRun(run.id);
  await assert.rejects(runtime.approve(run.id, approval.id, approval.digest, fresh.revision - 1), errorCode('AGENT_CONFLICT'));
  const approved = await runtime.approve(run.id, approval.id, approval.digest, (await store.getRun(run.id)).revision);
  assert.equal(approved.status, 'queued'); assert.equal(writes, 0);
  const result = await runtime.start(run.id); assert.equal(result.status, 'completed'); assert.equal(writes, 1); assert.equal(result.approval?.status, 'consumed'); assert.deepEqual(phases, ['prepare', 'approve', 'execute']);
  await runtime.start(run.id); assert.equal(writes, 1);
  await assert.rejects(runtime.approve(run.id, approval.id, approval.digest, result.revision), errorCode('AGENT_CONFLICT'));
});

test('cross-run approval and revoked permission cannot execute a pending write', async () => {
  const { store, run } = await fixture(['publish']); let permitted = true, writes = 0;
  const runtime = new AgentRuntime(store, [tool('publish', 'external-write', async () => { writes++; return { summary: 'Written.' }; })], sequence(action('publish'), finish), { authorize: () => permitted });
  const pending = await runtime.start(run.id), approval = pending.approval!;
  const unrelated = await store.createRun({ projectId: run.projectId, threadId: 'other', instruction: 'Other.', allowedTools: ['publish'] });
  await assert.rejects(runtime.approve(unrelated.id, approval.id, approval.digest, unrelated.revision), errorCode('AGENT_APPROVAL_INVALID'));
  permitted = false;
  await assert.rejects(runtime.approve(run.id, approval.id, approval.digest, (await store.getRun(run.id)).revision), errorCode('AGENT_TOOL_DENIED'));
  permitted = true; await runtime.approve(run.id, approval.id, approval.digest, (await store.getRun(run.id)).revision); permitted = false;
  const result = await runtime.start(run.id); assert.equal(result.status, 'failed'); assert.equal(writes, 0); assert.match(result.summary, /AGENT_TOOL_DENIED/);
});

test('expired approval is unusable; redirect and rejection preserve superseded action history', async () => {
  let now = Date.now(); const { store, run } = await fixture(['publish', 'read'], new MemoryAgentStore(() => now)); let calls = 0;
  const runtime = new AgentRuntime(store, [tool('publish', 'external-write', async () => { calls++; return { summary: 'Written.' }; }), tool()], sequence(action('publish'), action(), finish), { now: () => now });
  let current = await runtime.start(run.id); now += 900_001;
  await assert.rejects(runtime.approve(run.id, current.approval!.id, current.approval!.digest, current.revision), errorCode('AGENT_APPROVAL_INVALID'));
  current = await runtime.redirect(run.id, 'Read the QA record instead.'); assert.equal(current.steps[0].status, 'superseded'); assert.equal(current.approval?.status, 'rejected'); assert.equal(current.directives?.length, 1);
  current = await runtime.start(run.id); assert.equal(current.status, 'completed'); assert.equal(calls, 0);
  const second = await store.createRun({ projectId: run.projectId, threadId: 'reject', instruction: 'QA.', allowedTools: ['publish'] });
  const rejecting = new AgentRuntime(store, [tool('publish', 'external-write')], sequence(action('publish')));
  const pending = await rejecting.start(second.id);
  const rejected = await rejecting.reject(second.id, pending.approval!.id, pending.approval!.digest, pending.revision);
  assert.equal(rejected.status, 'waiting-input'); assert.equal(rejected.steps[0].status, 'superseded');
});

test('same external action cannot be automatically proposed again after a successful write', async () => {
  const { store, run } = await fixture(['publish']); let writes = 0;
  const runtime = new AgentRuntime(store, [tool('publish', 'external-write', async () => { writes++; return { summary: 'Written.' }; })], sequence(action('publish'), action('publish')));
  const pending = await runtime.start(run.id); await runtime.approve(run.id, pending.approval!.id, pending.approval!.digest, pending.revision);
  const result = await runtime.start(run.id); assert.equal(result.status, 'failed'); assert.match(result.summary, /AGENT_REPLAY_BLOCKED/); assert.equal(writes, 1);
});

test('a provider pause preserves confirmed work and resumes without repeating a local write', async () => {
  const { store, run } = await fixture(['save']); let writes = 0, decisions = 0;
  const save = tool('save', 'local-write', async () => { writes++; return { summary: 'Saved confirmed.', artifacts: [{ id: 'saved', kind: 'evidence', title: 'Saved record', resourceId: 'saved' }] }; });
  const runtime = new AgentRuntime(store, [save], async state => {
    decisions++;
    if (!state.steps.length) return action('save');
    if (decisions === 2) throw Object.assign(new Error('Private provider error TOKEN'), { code: 'MODEL_RATE_LIMIT' });
    return finish;
  });
  const paused = await runtime.start(run.id);
  assert.equal(paused.status, 'paused'); assert.equal(paused.steps[0].status, 'succeeded'); assert.equal(paused.artifacts.length, 1); assert.equal(writes, 1);
  assert.doesNotMatch(JSON.stringify([paused, await store.events(run.id)]), /Private provider error|TOKEN/);
  await runtime.resume(run.id, paused.revision);
  const done = await runtime.start(run.id); assert.equal(done.status, 'completed'); assert.equal(writes, 1); assert.equal(done.steps.length, 1);
  const duplicate = await fixture(['save']); let repeated = 0;
  const replay = new AgentRuntime(duplicate.store, [tool('save', 'local-write', async () => { repeated++; return { summary: 'Saved.' }; })], sequence(action('save'), action('save')));
  const blocked = await replay.start(duplicate.run.id); assert.equal(blocked.status, 'failed'); assert.match(blocked.summary, /AGENT_REPLAY_BLOCKED/); assert.equal(repeated, 1);
});

test('tool failures and malformed model responses retain safe errors and cannot finish', async () => {
  for (const effect of ['read', 'local-write'] as const) {
    const { store, run } = await fixture();
    const runtime = new AgentRuntime(store, [tool('read', effect, async () => { throw new Error('password=TOPSECRET /private/credentials.json Bearer TOKEN'); })], sequence(action(), finish));
    const result = await runtime.start(run.id); assert.equal(result.status, effect === 'read' ? 'failed' : 'paused'); assert.equal(result.steps[0].status, effect === 'read' ? 'failed' : 'uncertain');
    assert.doesNotMatch(JSON.stringify([result, await store.events(run.id)]), /TOPSECRET|credentials\.json|TOKEN/);
    await assert.rejects(runtime.resume(run.id), errorCode('AGENT_CONFLICT'));
  }
  const { store, run } = await fixture(); const result = await new AgentRuntime(store, [tool()], sequence('{"kind":"tool","secret":"raw"}')).start(run.id);
  assert.equal(result.status, 'failed'); assert.match(result.summary, /AGENT_DECISION_INVALID/); assert.equal(result.steps.length, 0);
});

test('lease loss aborts even an uncooperative tool, fences late outcomes, and recovery never replays', async () => {
  const { store, run } = await fixture(['save']); const entered = deferred(), late = deferred(); let writes = 0;
  const runtime = new AgentRuntime(store, [tool('save', 'local-write', async () => { writes++; entered.resolve(); await late.promise; return { summary: 'Late success.' }; })], sequence(action('save'), finish), { heartbeatMs: 2, leaseTtlMs: 100 });
  const execution = runtime.start(run.id); await entered.promise; store.loseLease(run.id); await execution;
  const afterLoss = await store.getRun(run.id); const revision = afterLoss.revision; assert.equal(afterLoss.steps[0].status, 'running'); late.resolve(); await delay(5);
  assert.equal((await store.getRun(run.id)).revision, revision); assert.equal(writes, 1);
  const restarted = new AgentRuntime(store, [tool('save', 'local-write', async () => { writes++; return { summary: 'Must not run.' }; })], sequence(finish));
  await restarted.recover(); const recovered = await store.getRun(run.id); assert.equal(recovered.status, 'paused'); assert.equal(recovered.steps[0].status, 'uncertain');
  await restarted.start(run.id); await assert.rejects(restarted.resume(run.id), errorCode('AGENT_CONFLICT')); assert.equal(writes, 1);
});

test('prepared local write from an expired worker is uncertain, not replayed after restart', async () => {
  let now = Date.now(); const { store, run } = await fixture(['save'], new MemoryAgentStore(() => now));
  const claimed = await store.claimRun(run.id, 'dead-worker', 100);
  await store.mutateRun(run.id, { lease: { owner: 'dead-worker', fence: claimed!.fence } }, state => { state.status = 'running'; state.steps.push({ id: 'prepared', tool: 'save', arguments: {}, effect: 'local-write', status: 'prepared', summary: 'Prepared.' }); });
  now += 101; let writes = 0;
  const runtime = new AgentRuntime(store, [tool('save', 'local-write', async () => { writes++; return { summary: 'Wrong.' }; })], sequence(finish), { now: () => now });
  await runtime.recover(); const result = await runtime.start(run.id); assert.equal(result.status, 'paused'); assert.equal(result.steps[0].status, 'uncertain'); assert.equal(writes, 0);
});

test('cancel stops next action and an in-flight write stays uncertain despite late success', async () => {
  const { store, run } = await fixture(['save']); const entered = deferred(), late = deferred(); let calls = 0;
  const runtime = new AgentRuntime(store, [tool('save', 'local-write', async () => { calls++; entered.resolve(); await late.promise; return { summary: 'Late success.' }; })], sequence(action('save'), action('save'), finish));
  const execution = runtime.start(run.id); await entered.promise;
  const cancelled = await runtime.cancel(run.id); assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.steps[0].status, 'uncertain');
  await execution; const revision = (await store.getRun(run.id)).revision; late.resolve(); await delay(5);
  assert.equal((await store.getRun(run.id)).revision, revision); assert.equal(calls, 1);
});

test('paused read can resume and a redirect queued during interruption starts after old work settles', async () => {
  const { store, run } = await fixture(); const entered = deferred(), late = deferred(); let calls = 0;
  const runtime = new AgentRuntime(store, [tool('read', 'read', async () => { if (++calls === 1) { entered.resolve(); await late.promise; } return { summary: 'Read confirmed.' }; })], sequence(action(), action(), finish));
  const first = runtime.start(run.id); await entered.promise;
  const paused = await runtime.pause(run.id); assert.equal(paused.status, 'paused'); assert.equal(paused.steps[0].status, 'superseded'); await first;
  await runtime.resume(run.id); const result = await runtime.start(run.id); assert.equal(result.status, 'completed'); assert.equal(calls, 2); late.resolve();

  const second = await store.createRun({ projectId: run.projectId, threadId: 'redirect', instruction: 'QA.', allowedTools: ['read'] });
  const started = deferred(), unfinished = deferred(); let secondCalls = 0;
  const redirectedRuntime = new AgentRuntime(store, [tool('read', 'read', async () => { if (++secondCalls === 1) { started.resolve(); await unfinished.promise; } return { summary: 'Read confirmed.' }; })], sequence(action(), action(), finish));
  const old = redirectedRuntime.start(second.id); await started.promise; await redirectedRuntime.redirect(second.id, 'Use the updated QA direction.');
  const updated = await redirectedRuntime.start(second.id); await old; assert.equal(updated.status, 'completed'); assert.equal(secondCalls, 2); unfinished.resolve();
});

test('independent deadlines, planning and completion rules bound non-progress', async () => {
  const { store, run } = await fixture();
  const never = new AgentRuntime(store, [tool()], async () => new Promise(() => {}), { decisionTimeoutMs: 10 });
  const timed = await never.start(run.id); assert.equal(timed.status, 'failed'); assert.match(timed.summary, /AGENT_TIMEOUT/);
  for (const decision of [finish, { kind: 'plan', summary: 'Plan only.', plan: ['Think.'] }]) {
    const next = await store.createRun({ projectId: run.projectId, threadId: 'bounded', instruction: 'QA.', allowedTools: ['read'] });
    const result = await new AgentRuntime(store, [tool()], async () => decision).start(next.id); assert.equal(result.status, 'failed'); assert.equal(result.steps.length, 0);
  }
});

test('outputs redact secrets, flag truncation explicitly, and keep artifact references', async () => {
  const { store, run } = await fixture();
  const read = tool('read', 'read', async () => ({ summary: 'Receipt Bearer HIDDEN', data: { password: 'TOPSECRET', body: 'x'.repeat(10_000), header: 'Bearer ANOTHER', rows: Array(50).fill({ value: 'row' }) }, artifacts: [{ id: 'artifact', kind: 'report', title: 'QA report', resourceId: 'qa-report' }] }));
  const result = await new AgentRuntime(store, [read], sequence(action(), finish)).start(run.id); assert.equal(result.status, 'completed');
  const receipt = result.steps[0].result as { dataTruncated: boolean; data: { dataTruncated: boolean } }; assert.equal(receipt.dataTruncated, true); assert.equal(receipt.data.dataTruncated, true);
  assert.equal(result.artifacts[0].resourceId, 'qa-report'); assert.doesNotMatch(JSON.stringify(result), /TOPSECRET|ANOTHER|HIDDEN/); assert.ok(JSON.stringify(result).length < 15_000);
});

test('control revisions are checked after lease acquisition and at the mutation boundary', async () => {
  class RacingStore extends MemoryAgentStore {
    race = false;
    override async claimRun(id: string, owner: string, ttlMs: number) { if (this.race) { this.race = false; this.records.get(id)!.revision++; } return super.claimRun(id, owner, ttlMs); }
  }
  const { store, run } = await fixture(['read'], new RacingStore()); const racing = store as RacingStore;
  const runtime = new AgentRuntime(store, [tool()], sequence(action(), finish)); racing.race = true;
  await assert.rejects(runtime.redirect(run.id, 'A stale UI request.', run.revision), errorCode('AGENT_CONFLICT'));
  assert.equal((await store.getRun(run.id)).directives, undefined);
  let current = await store.getRun(run.id); current = await runtime.pause(run.id, current.revision); assert.equal(current.status, 'paused');
  await assert.rejects(runtime.resume(run.id, current.revision - 1), errorCode('AGENT_CONFLICT'));
  current = await runtime.resume(run.id, (await store.getRun(run.id)).revision);
  current = await runtime.redirect(run.id, 'The current UI request.', current.revision); assert.equal(current.directives?.length, 1);
  await assert.rejects(runtime.cancel(run.id, current.revision - 1), errorCode('AGENT_CONFLICT'));
  assert.equal((await runtime.cancel(run.id, (await store.getRun(run.id)).revision)).status, 'cancelled');
});

test('late completion cannot overwrite cancellation between model return and commit', async () => {
  const committing = deferred(), allowCommit = deferred();
  class CompletionRaceStore extends MemoryAgentStore {
    override async mutateRun(id: string, options: AgentMutation, mutate: (run: AgentRun) => void) {
      if (options.event?.type === 'run.completed') { committing.resolve(); await allowCommit.promise; }
      return super.mutateRun(id, options, mutate);
    }
  }
  const { store, run } = await fixture(['read'], new CompletionRaceStore()); const runtime = new AgentRuntime(store, [tool()], sequence(action(), finish));
  const executing = runtime.start(run.id); await committing.promise;
  await runtime.cancel(run.id, (await store.getRun(run.id)).revision); allowCommit.resolve();
  assert.equal((await executing).status, 'cancelled'); assert.equal((await store.getRun(run.id)).status, 'cancelled');
});

test('active time deadline marks an ignored-abort write uncertain and preserves late fencing', async () => {
  const { store, run } = await fixture(['save']); store.records.get(run.id)!.limits.maxActiveMs = 20; const late = deferred();
  const runtime = new AgentRuntime(store, [tool('save', 'local-write', async () => { await late.promise; return { summary: 'Late write result.' }; })], sequence(action('save'), finish));
  const result = await runtime.start(run.id); assert.equal(result.status, 'paused'); assert.equal(result.steps[0].status, 'uncertain');
  const revision = result.revision; late.resolve(); await delay(5); assert.equal((await store.getRun(run.id)).revision, revision);
});

test('unsupported retained workflow or policy cannot execute, and undeclared tools are denied', async () => {
  for (const field of ['workflowVersion', 'policyVersion'] as const) {
    const { store, run } = await fixture(); store.records.get(run.id)![field] = 999; let calls = 0;
    const runtime = new AgentRuntime(store, [tool('read', 'read', async () => { calls++; return { summary: 'Wrong.' }; })], sequence(action(), finish));
    const result = await runtime.start(run.id); assert.equal(result.status, 'paused'); assert.match(result.summary, /unsupported/); assert.equal(calls, 0);
    await assert.rejects(runtime.resume(run.id), errorCode('AGENT_CONFLICT'));
  }
  const { store, run } = await fixture(['read']); let calls = 0;
  const runtime = new AgentRuntime(store, [tool(), tool('forbidden', 'local-write', async () => { calls++; return { summary: 'Wrong.' }; })], sequence(action('forbidden')));
  const result = await runtime.start(run.id); assert.equal(result.status, 'failed'); assert.equal(result.steps.length, 0); assert.equal(calls, 0);
});

test('only allowlisted provider error codes are retained, never provider messages or unknown codes', async () => {
  for (const code of ['MODEL_UNAVAILABLE', 'secret-code-TOPSECRET']) {
    const { store, run } = await fixture();
    const result = await new AgentRuntime(store, [tool()], async () => { throw Object.assign(new Error('Bearer TOKEN /private/key.json'), { code }); }).start(run.id);
    assert.match(result.summary, code === 'MODEL_UNAVAILABLE' ? /MODEL_UNAVAILABLE/ : /AGENT_EXECUTION_FAILED/);
    assert.doesNotMatch(JSON.stringify([result, await store.events(run.id)]), /TOPSECRET|TOKEN|key\.json/);
  }
});

test('independent lease watchdog aborts work if the heartbeat never settles', async () => {
  class HungHeartbeatStore extends MemoryAgentStore { override async heartbeat(): Promise<boolean> { return new Promise(() => {}); } }
  const { store, run } = await fixture(['save'], new HungHeartbeatStore()); const entered = deferred(), late = deferred();
  const runtime = new AgentRuntime(store, [tool('save', 'local-write', async () => { entered.resolve(); await late.promise; return { summary: 'Late result.' }; })], sequence(action('save'), finish), { leaseTtlMs: 100, heartbeatMs: 2 });
  const execution = runtime.start(run.id); await entered.promise; const startedAt = Date.now(); const result = await execution;
  assert.ok(Date.now() - startedAt < 1000); assert.equal(result.steps[0].status, 'running');
  const revision = result.revision; late.resolve(); await delay(5); assert.equal((await store.getRun(run.id)).revision, revision);
  await runtime.recover(); assert.equal((await store.getRun(run.id)).steps[0].status, 'uncertain');
});

test('failed nonmutating read remains visible while the model selects a successful alternative', async () => {
  const { store, run } = await fixture(['readA', 'readB']); const calls: string[] = []; let observedFailure = false;
  const readA = tool('readA', 'read', async () => { calls.push('A'); throw Object.assign(new Error('Missing private URL password=TOPSECRET'), { status: 404 }); });
  const readB = tool('readB', 'read', async () => { calls.push('B'); return { summary: 'Alternative source read.', data: { source: 'QA alternate' } }; });
  const runtime = new AgentRuntime(store, [readA, readB], async state => {
    if (!state.steps.length) return action('readA');
    if (state.steps.length === 1) {
      assert.equal(state.steps[0].status, 'failed'); assert.deepEqual(state.steps[0].result, { error: { code: 'AGENT_READ_NOT_FOUND', status: 404 } }); observedFailure = true; return action('readB');
    }
    return finish;
  });
  const result = await runtime.start(run.id); assert.equal(result.status, 'completed'); assert.equal(observedFailure, true); assert.deepEqual(calls, ['A', 'B']);
  assert.deepEqual(result.steps.map(step => step.status), ['failed', 'succeeded']); assert.doesNotMatch(JSON.stringify([result, await store.events(run.id)]), /TOPSECRET|private URL/);
});

test('failed reads alone cannot complete, and repeated attempts stay within the step limit', async () => {
  const { store, run } = await fixture(); let calls = 0;
  const read = tool('read', 'read', async () => { calls++; throw Object.assign(new Error('Unavailable.'), { status: 503 }); });
  let result = await new AgentRuntime(store, [read], sequence(action(), finish)).start(run.id);
  assert.equal(result.status, 'failed'); assert.match(result.summary, /AGENT_COMPLETION_INVALID/); assert.equal(result.steps[0].status, 'failed');
  const next = await store.createRun({ projectId: run.projectId, threadId: 'bounded-read', instruction: 'QA.', allowedTools: ['read'] }); calls = 0;
  result = await new AgentRuntime(store, [read], async () => action()).start(next.id);
  assert.equal(calls, 20); assert.equal(result.steps.length, 20); assert.equal(result.status, 'failed'); assert.match(result.summary, /AGENT_LIMIT/);
});

test('a failed read can ask for direction, resume, and finish after a later successful read', async () => {
  const { store, run } = await fixture(['readA', 'readB']);
  const runtime = new AgentRuntime(store, [tool('readA', 'read', async () => { throw new Error('Read unavailable.'); }), tool('readB')], sequence(action('readA'), { kind: 'ask', summary: 'Need a source choice.', question: 'Use the alternative source?' }, action('readB'), finish));
  const waiting = await runtime.start(run.id); assert.equal(waiting.status, 'waiting-input'); assert.equal(waiting.steps[0].status, 'failed');
  const resumed = await runtime.resume(run.id, waiting.revision); assert.equal(resumed.status, 'queued');
  const result = await runtime.start(run.id); assert.equal(result.status, 'completed'); assert.deepEqual(result.steps.map(step => step.status), ['failed', 'succeeded']);
});

test('cancelling a read stops adaptation and ignores its late failure', async () => {
  const { store, run } = await fixture(['readA', 'readB']); const entered = deferred(), late = deferred(); let alternativeCalls = 0, decisions = 0;
  const runtime = new AgentRuntime(store, [tool('readA', 'read', async () => { entered.resolve(); await late.promise; throw Object.assign(new Error('Late missing source.'), { status: 404 }); }), tool('readB', 'read', async () => { alternativeCalls++; return { summary: 'Wrong.' }; })], async () => ++decisions === 1 ? action('readA') : action('readB'));
  const execution = runtime.start(run.id); await entered.promise; await runtime.cancel(run.id); const result = await execution;
  const revision = result.revision; assert.equal(result.status, 'cancelled'); assert.equal(result.steps[0].status, 'superseded'); late.resolve(); await delay(5);
  assert.equal(alternativeCalls, 0); assert.equal(decisions, 1); assert.equal((await store.getRun(run.id)).revision, revision);
});

test('scope authorization and invalid model decisions stay fatal after adaptive read support', async () => {
  const { store, run } = await fixture(['readA', 'readB']); let alternativeCalls = 0;
  const blocked = tool('readA', 'read', async () => { throw new AgentError('Unattached resource.', 403, 'AGENT_SCOPE'); });
  const alternative = tool('readB', 'read', async () => { alternativeCalls++; return { summary: 'Wrong.' }; });
  let result = await new AgentRuntime(store, [blocked, alternative], sequence(action('readA'), action('readB'), finish)).start(run.id);
  assert.equal(result.status, 'failed'); assert.equal(alternativeCalls, 0);
  const next = await store.createRun({ projectId: run.projectId, threadId: 'bad-model', instruction: 'QA.', allowedTools: ['readA', 'readB'] });
  result = await new AgentRuntime(store, [tool('readA', 'read', async () => { throw new Error('Unavailable.'); }), alternative], sequence(action('readA'), { kind: 'tool', tool: 'readB', arguments: {}, summary: 'Invalid model decision.', authorize: true })).start(next.id);
  assert.equal(result.status, 'failed'); assert.match(result.summary, /AGENT_DECISION_INVALID/); assert.equal(alternativeCalls, 0);
});

test('a lease that expires after startup recovery pauses an orphan before any new model call', async () => {
  for (const completedRead of [false, true]) {
    let now = Date.now(); const { store, run } = await fixture(['read'], new MemoryAgentStore(() => now));
    const abandoned = (await store.claimRun(run.id, 'previous-process', 1000))!;
    await store.mutateRun(run.id, { lease: { owner: abandoned.leaseOwner!, fence: abandoned.fence } }, state => {
      state.status = 'running';
      if (completedRead) state.steps.push({ id: 'confirmed-before-restart', tool: 'read', arguments: {}, effect: 'read', status: 'succeeded', summary: 'Confirmed earlier read.' });
    });
    let decisions = 0, reads = 0;
    const restarted = new AgentRuntime(store, [tool('read', 'read', async () => { reads++; return { summary: 'Must not run.' }; })], async () => { decisions++; return action(); }, { now: () => now });
    await restarted.recover(); assert.equal((await store.getRun(run.id)).status, 'running');
    now += 1001;
    const paused = await restarted.start(run.id);
    assert.equal(paused.status, 'paused'); assert.equal(paused.pauseRequested, true); assert.equal(paused.leaseOwner, undefined);
    assert.equal(decisions, 0); assert.equal(reads, 0);
    if (completedRead) assert.equal(paused.steps[0].status, 'succeeded');
    await restarted.shutdown();
  }
});

test('shutdown aborts the provider immediately, pauses queued starts and ignores its late action', async () => {
  const { store, run } = await fixture(), entered = deferred(), late = deferred<AgentDecision>();
  const next = await store.createRun({ projectId: run.projectId, threadId: 'queued-at-quit', instruction: 'Read after the first task.', allowedTools: ['read'] });
  let decisions = 0, reads = 0, signal!: AbortSignal;
  const runtime = new AgentRuntime(store, [tool('read', 'read', async () => { reads++; return { summary: 'Must not run.' }; })], async (_state, _tools, providerSignal) => {
    decisions++; signal = providerSignal; entered.resolve(); return late.promise;
  });
  const first = runtime.start(run.id); await entered.promise; const second = runtime.start(next.id);
  const closing = runtime.shutdown(); assert.equal(signal.aborted, true); assert.equal(runtime.shutdown(), closing);
  await closing; await Promise.all([first, second]);
  assert.equal((await store.getRun(run.id)).status, 'paused'); assert.equal((await store.getRun(next.id)).status, 'paused');
  late.resolve(action()); await delay(1);
  await runtime.start(run.id); assert.equal(decisions, 1); assert.equal(reads, 0);
  assert.equal((await store.events(run.id)).some(event => event.type === 'step.prepared'), false);
});

test('a claim returning after shutdown cannot start a provider or a tool', async () => {
  const claiming = deferred(), allowClaim = deferred();
  class DelayedClaimStore extends MemoryAgentStore {
    private delayed = false;
    override async claimRun(id: string, owner: string, ttlMs: number) {
      if (!this.delayed) { this.delayed = true; claiming.resolve(); await allowClaim.promise; }
      return super.claimRun(id, owner, ttlMs);
    }
  }
  const { store, run } = await fixture(['read'], new DelayedClaimStore()); let calls = 0;
  const runtime = new AgentRuntime(store, [tool()], async () => { calls++; return action(); });
  const execution = runtime.start(run.id); await claiming.promise;
  await runtime.shutdown(); allowClaim.resolve();
  assert.equal((await execution).status, 'paused'); assert.equal(calls, 0); assert.equal((await store.getRun(run.id)).leaseOwner, undefined);
});

test('a claim delivered after shutdown cannot renew or report a pause that never persisted', async () => {
  const claiming = deferred(), allowClaim = deferred(), allowPause = deferred();
  class LateClaimStore extends MemoryAgentStore {
    private delayed = false;
    heartbeats = 0;
    pauseAttempts = 0;
    override async claimRun(id: string, owner: string, ttlMs: number) {
      const claimed = await super.claimRun(id, owner, ttlMs);
      if (claimed && !this.delayed) { this.delayed = true; claiming.resolve(); await allowClaim.promise; }
      return claimed;
    }
    override async mutateRun(id: string, options: AgentMutation, mutate: (run: AgentRun) => void) {
      if (options.event?.type === 'run.recovered') { this.pauseAttempts++; await allowPause.promise; }
      return super.mutateRun(id, options, mutate);
    }
    override async heartbeat(id: string, owner: string, fence: number, ttlMs: number) {
      this.heartbeats++; return super.heartbeat(id, owner, fence, ttlMs);
    }
  }
  const store = new LateClaimStore(), { run } = await fixture(['read'], store); let calls = 0;
  const runtime = new AgentRuntime(store, [tool()], async () => { calls++; return action(); }, { leaseTtlMs: 100, heartbeatMs: 5 });
  const execution = runtime.start(run.id); await claiming.promise;
  try {
    await runtime.shutdown(10); allowClaim.resolve();
    await delay(125);
    const retained = await store.getRun(run.id);
    assert.equal(store.heartbeats, 0); assert.equal(store.pauseAttempts, 0); assert.equal(calls, 0);
    assert.equal(retained.status, 'queued'); assert.equal(retained.pauseRequested, false); assert.equal(retained.leaseOwner, undefined);
    assert.equal((await store.events(run.id)).some(event => event.type === 'run.recovered' || event.type === 'run.shutdown-paused'), false);
  } finally { allowClaim.resolve(); allowPause.resolve(); await execution; }
});

test('shutdown is bounded when pause persistence hangs and a late write receipt cannot replace recovery', async () => {
  const pauseEntered = deferred(), entered = deferred(), late = deferred();
  class HungPauseStore extends MemoryAgentStore {
    override async mutateRun(id: string, options: AgentMutation, mutate: (run: AgentRun) => void) {
      if (options.event?.type === 'run.shutdown-paused') { pauseEntered.resolve(); return new Promise<AgentRun>(() => {}); }
      return super.mutateRun(id, options, mutate);
    }
  }
  const { store, run } = await fixture(['save'], new HungPauseStore()); let signal!: AbortSignal, writes = 0, restartedCalls = 0;
  const runtime = new AgentRuntime(store, [tool('save', 'local-write', async context => { writes++; signal = context.signal; entered.resolve(); await late.promise; return { summary: 'Late confirmed write.' }; })], sequence(action('save'), finish));
  const execution = runtime.start(run.id); await entered.promise;
  const startedAt = Date.now(), closing = runtime.shutdown(25); assert.equal(signal.aborted, true); await pauseEntered.promise;
  await closing; assert.ok(Date.now() - startedAt < 1000);
  store.loseLease(run.id);
  const restarted = new AgentRuntime(store, [tool('save', 'local-write')], async () => { restartedCalls++; return action('save'); });
  const recovered = await restarted.start(run.id); assert.equal(recovered.status, 'paused'); assert.equal(recovered.steps[0].status, 'uncertain');
  late.resolve(); await execution; await delay(1);
  assert.equal(writes, 1); assert.equal(restartedCalls, 0); assert.equal((await store.getRun(run.id)).steps[0].status, 'uncertain');
  assert.equal((await store.events(run.id)).some(event => event.type === 'step.succeeded'), false);
  await restarted.shutdown();
});
