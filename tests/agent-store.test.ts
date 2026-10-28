import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AgentError, type AgentRunInput, type AgentStore } from '../shared/agent-contracts.ts';
import { createPostgresAgentStore, validateAgentRunInput, validateAgentRunRecord } from '../server/agent-store.ts';

const input = (projectId: string = randomUUID()): AgentRunInput => ({ projectId, threadId: 'test-thread', instruction: 'Prepare a supervised evidence brief.', allowedTools: ['test.read', 'test.write'] });
const code = (expected: string) => (issue: unknown) => issue instanceof AgentError && issue.code === expected;
const fixtureRun = () => ({ ...input(), id: randomUUID(), policyVersion: 1, workflowVersion: 1, status: 'queued' as const, revision: 1,
  plan: [], steps: [], artifacts: [], summary: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  limits: { maxSteps: 20, maxActiveMs: 900_000 }, activeMs: 0, cancelRequested: false, pauseRequested: false, fence: 0 });

test('run inputs enforce project UUID, bounded instructions, selection and tool allowlist', () => {
  const valid = input(); assert.deepEqual(validateAgentRunInput(valid), valid);
  for (const invalid of [
    { ...valid, projectId: 'not-a-uuid' }, { ...valid, requestId: 'not-a-uuid' }, { ...valid, instruction: ' ' }, { ...valid, instruction: 'x'.repeat(20_001) },
    { ...valid, threadId: '' }, { ...valid, allowedTools: [] }, { ...valid, allowedTools: ['test.read', 'test.read'] },
    { ...valid, allowedTools: ['test read'] }, { ...valid, limits: { maxSteps: 100 } },
    { ...valid, selection: { kind: 'wordpress', id: '1', title: 'Post', revision: -1 } },
    { ...valid, selection: { kind: 'unexpected', id: '1', title: 'Post' } },
  ]) assert.throws(() => validateAgentRunInput(invalid), code('AGENT_VALIDATION'));
  assert.equal(validateAgentRunInput({ ...valid, selection: { kind: 'wordpress', id: '42', title: 'Review', siteId: 'azat', revision: 2 } }).selection?.revision, 2);
});

test('run records reject excessive steps, time budgets and non-JSON tool arguments', () => {
  validateAgentRunRecord(fixtureRun());
  assert.throws(() => validateAgentRunRecord({ ...fixtureRun(), limits: { maxSteps: 21, maxActiveMs: 900_000 } }), code('AGENT_VALIDATION'));
  assert.throws(() => validateAgentRunRecord({ ...fixtureRun(), limits: { maxSteps: 20, maxActiveMs: 900_001 } }), code('AGENT_VALIDATION'));
  for (const args of [{ infinite: Infinity }, { fn: () => 1 }, { value: 'x'.repeat(1_000_001) }]) {
    assert.throws(() => validateAgentRunRecord({ ...fixtureRun(), steps: [{ id: 'step', tool: 'test.read', arguments: args, effect: 'read', status: 'prepared', summary: '' }] }), code('AGENT_VALIDATION'));
  }
});

test('missing or malformed database configuration returns a fixed safe error', () => {
  for (const url of ['', 'https://private-user:private-password@example.invalid/db', 'private-password']) {
    assert.throws(() => createPostgresAgentStore(url), issue => code('AGENT_STORE_UNAVAILABLE')(issue) && !String(issue).includes('private-password'));
  }
});

test('invalid requests are rejected before accessing an unavailable database', async () => {
  const store = createPostgresAgentStore('postgresql://private-user:private-password@127.0.0.1:1/private-db');
  try {
    await assert.rejects(store.getRun('invalid'), code('AGENT_VALIDATION'));
    await assert.rejects(store.createRun({ ...input(), instruction: '' }), code('AGENT_VALIDATION'));
    await assert.rejects(store.claimRun(randomUUID(), 'worker', 99), code('AGENT_VALIDATION'));
    for (const statuses of [[], ['invented'], ['queued); DROP SCHEMA azat_agent; --'], 'queued', null]) {
      await assert.rejects(store.listRuns(undefined, statuses as any), code('AGENT_VALIDATION'));
    }
    await assert.rejects(store.initialize(), issue => code('AGENT_STORE_UNAVAILABLE')(issue) && !String(issue).includes('private-password') && !String(issue).includes('private-user'));
  } finally { await store.close(); }
});

const databaseUrl = process.env.AZAT_AGENT_TEST_DATABASE_URL;
test('PostgreSQL durable ledger and fenced execution', { skip: databaseUrl ? false : 'Set AZAT_AGENT_TEST_DATABASE_URL to run real PostgreSQL integration tests.' }, async t => {
  const stores: AgentStore[] = [createPostgresAgentStore(databaseUrl!), createPostgresAgentStore(databaseUrl!)];
  const admin = new Pool({ connectionString: databaseUrl!, max: 1 });
  let projectId: string | undefined;
  try {
    await Promise.all(stores.map(store => store.initialize()));
    const [store, other] = stores;
    const project = await store.createProject(`store-test-${randomUUID()}`); projectId = project.id;
    assert.ok((await other.listProjects()).some(item => item.id === project.id));

    await t.test('creation survives a second connection and commits the initial event', async () => {
      const run = await store.createRun(input(project.id));
      assert.equal(run.revision, 1); assert.equal(run.status, 'queued'); assert.deepEqual(run.limits, { maxSteps: 20, maxActiveMs: 900_000 });
      assert.deepEqual(await other.getRun(run.id), run);
      assert.deepEqual((await other.events(run.id)).map(event => [event.revision, event.type]), [[1, 'run.created']]);
      assert.ok((await other.listRuns(project.id)).some(item => item.id === run.id));
      await assert.rejects(store.createRun(input()), code('AGENT_NOT_FOUND'));
    });

    await t.test('concurrent optimistic mutations allow one winner and retain every committed event', async () => {
      const run = await store.createRun(input(project.id));
      const outcomes = await Promise.allSettled([store, other].map((worker, index) => worker.mutateRun(run.id, { expectedRevision: run.revision, event: { type: 'test.updated', message: 'Updated.' } }, next => { next.summary = `winner-${index}`; })));
      assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
      const failure = outcomes.find(outcome => outcome.status === 'rejected') as PromiseRejectedResult;
      assert.ok(code('AGENT_CONFLICT')(failure.reason));
      const current = await store.getRun(run.id); assert.equal(current.revision, 2);
      assert.deepEqual((await store.events(run.id)).map(event => event.revision), [1, 2]);
      assert.deepEqual((await store.events(run.id, 1)).map(event => event.revision), [2]);
      await assert.rejects(store.mutateRun(run.id, { expectedRevision: 2 }, next => { next.summary = 'must rollback'; next.limits.maxSteps = 100; }), code('AGENT_VALIDATION'));
      assert.deepEqual(await store.getRun(run.id), current); assert.equal((await store.events(run.id)).length, 2);
    });

    await t.test('concurrent repeated creation uses the request UUID once and rejects conflicting authority', async () => {
      const request: AgentRunInput = { ...input(project.id), requestId: randomUUID(), selection: { kind: 'wordpress', id: '42', title: 'Selected article', siteId: 'azat', revision: 'revision-before' } };
      const created = await Promise.all([store.createRun(request), other.createRun(structuredClone(request))]);
      assert.equal(created[0].id, request.requestId); assert.deepEqual(created[0], created[1]);
      assert.equal('requestId' in created[0], false);
      assert.deepEqual((await store.events(created[0].id)).map(event => event.type), ['run.created']);
      for (const changed of [{ ...request, instruction: 'Different work' }, { ...request, allowedTools: ['test.write'] }, { ...request, threadId: 'different-thread' }, { ...request, selection: { ...request.selection!, id: '99' } }]) {
        await assert.rejects(other.createRun(changed), code('AGENT_CONFLICT'));
      }
      const current = await store.mutateRun(created[0].id, { expectedRevision: 1 }, next => { next.status = 'waiting-input'; next.question = 'Choose the next source.'; });
      assert.deepEqual(await other.createRun(request), current);
      assert.equal((await store.events(created[0].id)).length, 2);
      assert.equal((await store.listRuns(project.id)).filter(run => run.id === request.requestId).length, 1);
    });

    await t.test('completion contracts persist, bind repeated requests and cannot be weakened by mutation', async () => {
      const completionContract = { version: 1 as const, requiredArtifacts: [{ kind: 'report' as const, minCount: 2, language: 'hy' }] };
      const request: AgentRunInput = { ...input(project.id), requestId: randomUUID(), completionContract };
      const run = await store.createRun(request);
      assert.deepEqual((await other.getRun(run.id)).completionContract, completionContract);
      assert.deepEqual(await other.createRun(structuredClone(request)), run);
      for (const changed of [undefined, { ...completionContract, requiredArtifacts: [{ ...completionContract.requiredArtifacts[0], minCount: 1 }] }]) {
        await assert.rejects(other.createRun({ ...request, completionContract: changed }), code('AGENT_CONFLICT'));
        await assert.rejects(store.mutateRun(run.id, { expectedRevision: run.revision }, next => { next.completionContract = changed; }), code('AGENT_VALIDATION'));
      }
      assert.deepEqual(await other.getRun(run.id), run);
      const legacy = await store.createRun({ ...input(project.id), requestId: randomUUID() });
      await assert.rejects(other.createRun({ ...input(project.id), requestId: legacy.id, completionContract }), code('AGENT_CONFLICT'));
      await assert.rejects(store.mutateRun(legacy.id, { expectedRevision: legacy.revision }, next => { next.completionContract = completionContract; }), code('AGENT_VALIDATION'));
      assert.equal((await other.getRun(legacy.id)).completionContract, undefined);
    });

    await t.test('global lease serializes different runs and fences heartbeat, mutation and release', async () => {
      const a = await store.createRun(input(project.id)), b = await store.createRun(input(project.id));
      const claims = await Promise.all([store.claimRun(a.id, 'worker-a', 10_000), other.claimRun(b.id, 'worker-b', 10_000)]);
      assert.equal(claims.filter(Boolean).length, 1);
      const claimed = claims.find(Boolean)!; const owner = claimed.leaseOwner!;
      assert.equal(claimed.status, 'queued'); assert.equal(claimed.fence, 1);
      assert.equal(await other.heartbeat(claimed.id, 'wrong-worker', claimed.fence, 10_000), false);
      assert.equal(await other.heartbeat(claimed.id, owner, claimed.fence + 1, 10_000), false);
      const revision = claimed.revision;
      assert.equal(await other.heartbeat(claimed.id, owner, claimed.fence, 10_000), true);
      assert.equal((await other.getRun(claimed.id)).revision, revision);
      await assert.rejects(other.mutateRun(claimed.id, { lease: { owner: 'wrong-worker', fence: claimed.fence } }, next => { next.summary = 'bad'; }), code('AGENT_LEASE_LOST'));
      await assert.rejects(other.mutateRun(claimed.id, { expectedRevision: revision }, next => { next.summary = 'bad'; }), code('AGENT_LEASE_LOST'));
      await other.releaseRun(claimed.id, 'wrong-worker', claimed.fence);
      assert.equal((await store.getRun(claimed.id)).leaseOwner, owner);
      await other.releaseRun(claimed.id, owner, claimed.fence);
      const reclaimed = await store.claimRun(claimed.id, 'replacement', 10_000); assert.ok(reclaimed); assert.equal(reclaimed.fence, 2);
      await other.releaseRun(claimed.id, owner, claimed.fence);
      assert.equal((await store.getRun(claimed.id)).leaseOwner, 'replacement');
      await store.releaseRun(claimed.id, 'replacement', reclaimed.fence);
    });

    await t.test('implementation bindings persist across connections and cannot be rebound or removed', async () => {
      const run = await store.createRun(input(project.id));
      const binding = { version: 1 as const, executorIdentity: 'a'.repeat(64), toolSchemaHash: 'b'.repeat(64) };
      const prepared = await store.mutateRun(run.id, { expectedRevision: run.revision }, next => {
        next.steps.push({ id: 'bound-fixture', tool: 'test.write', effect: 'external-write', arguments: {}, binding, status: 'prepared', summary: 'Synthetic action only.' });
      });
      assert.deepEqual((await other.getRun(run.id)).steps[0].binding, binding);
      await assert.rejects(store.mutateRun(run.id, { expectedRevision: prepared.revision }, next => { delete next.steps[0].binding; }), code('AGENT_VALIDATION'));
      await assert.rejects(store.mutateRun(run.id, { expectedRevision: prepared.revision }, next => { next.steps[0].binding!.executorIdentity = 'c'.repeat(64); }), code('AGENT_VALIDATION'));
      assert.deepEqual(await other.getRun(run.id), prepared);
    });

    await t.test('lease expiry cannot be resurrected and interrupted external writes pause without replay', async () => {
      const run = await store.createRun(input(project.id));
      const claim = (await store.claimRun(run.id, 'crashed', 10_000))!;
      await store.mutateRun(run.id, { lease: { owner: 'crashed', fence: claim.fence } }, next => {
        next.status = 'running'; next.steps.push({ id: 'external-action', tool: 'test.write', arguments: { postId: 42 }, effect: 'external-write', status: 'running', summary: 'Dispatching selected edit.' });
      });
      await admin.query("UPDATE azat_agent.runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [run.id]);
      assert.equal(await store.heartbeat(run.id, 'crashed', claim.fence, 10_000), false);
      await assert.rejects(store.mutateRun(run.id, { lease: { owner: 'crashed', fence: claim.fence } }, next => { next.summary = 'late result'; }), code('AGENT_LEASE_LOST'));
      await store.releaseRun(run.id, 'crashed', claim.fence);
      assert.equal((await store.getRun(run.id)).leaseOwner, 'crashed');
      assert.equal(await other.claimRun(run.id, 'recovery', 10_000), null);
      const paused = await store.getRun(run.id); assert.equal(paused.status, 'paused'); assert.equal(paused.steps[0].status, 'uncertain'); assert.equal(paused.pauseRequested, true); assert.equal(paused.leaseOwner, undefined);
      assert.equal((await store.events(run.id)).at(-1)?.type, 'run.recovery-required');
      const review = (await store.claimRun(run.id, 'review', 10_000))!; assert.ok(review); assert.equal(review.status, 'paused');
      await assert.rejects(store.mutateRun(run.id, { lease: { owner: 'review', fence: review.fence } }, next => { next.steps[0].status = 'running'; }), code('AGENT_VALIDATION'));
      await store.releaseRun(run.id, 'review', review.fence);
    });

    await t.test('a mutation that outlives its lease cannot commit even while holding the row lock', async () => {
      const run = await store.createRun(input(project.id)), claimed = (await store.claimRun(run.id, 'slow-worker', 100))!;
      await assert.rejects(store.mutateRun(run.id, { lease: { owner: 'slow-worker', fence: claimed.fence } }, next => {
        next.summary = 'This expired worker must not commit.';
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
      }), code('AGENT_LEASE_LOST'));
      const current = await store.getRun(run.id);
      assert.equal(current.summary, ''); assert.equal(current.revision, claimed.revision);
      assert.equal((await store.events(run.id)).length, claimed.revision);
      // A new claim can replace an expired lease when there was no dispatched action.
      const replacement = (await other.claimRun(run.id, 'replacement', 10_000))!;
      assert.ok(replacement); await other.releaseRun(run.id, 'replacement', replacement.fence);
    });

    await t.test('prepared writes are uncertain after expiry, while deliberate release preserves pending approval', async () => {
      for (const deliberate of [false, true]) {
        const run = await store.createRun(input(project.id)), claim = (await store.claimRun(run.id, 'preparer', 10_000))!;
        await store.mutateRun(run.id, { lease: { owner: 'preparer', fence: claim.fence } }, next => {
          next.status = 'waiting-approval'; next.steps.push({ id: 'prepared', tool: 'test.write', arguments: {}, effect: 'local-write', status: 'prepared', summary: 'Awaiting review.' });
        });
        if (deliberate) await store.releaseRun(run.id, 'preparer', claim.fence);
        else await admin.query("UPDATE azat_agent.runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [run.id]);
        const result = await other.claimRun(run.id, 'reviewer', 10_000);
        if (deliberate) { assert.ok(result); assert.equal(result.status, 'waiting-approval'); assert.equal(result.steps[0].status, 'prepared'); await store.releaseRun(run.id, 'reviewer', result.fence); }
        else { assert.equal(result, null); assert.equal((await store.getRun(run.id)).steps[0].status, 'uncertain'); }
      }
    });

    await t.test('terminal runs cannot acquire a lease and mutations cannot change retained authority', async () => {
      const run = await store.createRun(input(project.id));
      for (const modify of [(next: any) => { next.allowedTools.push('admin.shell'); }, (next: any) => { next.projectId = randomUUID(); }, (next: any) => { next.fence++; }]) {
        await assert.rejects(store.mutateRun(run.id, { expectedRevision: run.revision }, modify), code('AGENT_VALIDATION'));
      }
      await store.mutateRun(run.id, { expectedRevision: run.revision }, next => { next.status = 'cancelled'; });
      assert.equal(await store.claimRun(run.id, 'worker', 10_000), null);
    });

    await t.test('scheduler status filtering precedes pagination and returns oldest work first', async () => {
      const isolated = await store.createProject(`pagination-test-${randomUUID()}`);
      try {
        const oldest = await store.createRun(input(isolated.id));
        const newestTerminals = await Promise.all(Array.from({ length: 205 }, () => store.createRun(input(isolated.id))));
        await Promise.all(newestTerminals.map(run => store.mutateRun(run.id, { expectedRevision: run.revision }, next => { next.status = 'completed'; })));
        const nextQueued = await store.createRun(input(isolated.id));
        const unfiltered = await store.listRuns(isolated.id);
        assert.equal(unfiltered.length, 200); assert.ok(unfiltered.some(run => run.id === nextQueued.id)); assert.equal(unfiltered.some(run => run.id === oldest.id), false);
        const scheduled = await other.listRuns(isolated.id, ['queued', 'running']);
        assert.deepEqual(scheduled.map(run => run.id), [oldest.id, nextQueued.id]);
        assert.equal((await other.listRuns(isolated.id, ['completed'])).length, 200);
        const acrossProjects = await other.listRuns(undefined, ['queued', 'running']);
        assert.ok(acrossProjects.some(run => run.id === oldest.id));
        for (const statuses of [[], ['unknown'], null, 'queued']) await assert.rejects(store.listRuns(isolated.id, statuses as any), code('AGENT_VALIDATION'));
      } finally {
        await admin.query('DELETE FROM azat_agent.events WHERE run_id IN (SELECT id FROM azat_agent.runs WHERE project_id=$1)', [isolated.id]);
        await admin.query('DELETE FROM azat_agent.runs WHERE project_id=$1', [isolated.id]); await admin.query('DELETE FROM azat_agent.projects WHERE id=$1', [isolated.id]);
      }
    });
  } finally {
    if (projectId) {
      await admin.query('DELETE FROM azat_agent.events WHERE run_id IN (SELECT id FROM azat_agent.runs WHERE project_id=$1)', [projectId]);
      await admin.query('DELETE FROM azat_agent.runs WHERE project_id=$1', [projectId]);
      await admin.query('DELETE FROM azat_agent.projects WHERE id=$1', [projectId]);
    }
    await Promise.allSettled(stores.map(store => store.close())); await admin.end();
  }
});
