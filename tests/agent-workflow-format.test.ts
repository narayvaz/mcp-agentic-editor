import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_WORKFLOW_VERSION, type AgentRun } from '../shared/agent-contracts.ts';
import { MemoryAgentStore } from './agent-memory-store.ts';

/**
 * Pinned historical reader contract, not the current runtime implementation.
 * ae5b620bba1127a25d7a80e3a436c5b58e4166fb:
 * shared/agent-contracts.ts declares AGENT_WORKFLOW_VERSION=1;
 * server/agent-runtime.ts supported() checks that exact version and policyVersion=1.
 * Keep this fixture fixed when the current workflow advances. No Git history is
 * read at test time, so shallow CI checkouts exercise the same downgrade guard.
 */
const historicalV1ReaderAccepts = (run: Pick<AgentRun, 'workflowVersion' | 'policyVersion'>) => run.workflowVersion === 1 && run.policyVersion === 1;

test('new run envelopes are refused by the pinned historical v1 reader', async () => {
  const store = new MemoryAgentStore(), project = await store.createProject('Workflow format fixtures');
  assert.equal(historicalV1ReaderAccepts({ workflowVersion: 1, policyVersion: 1 }), true);
  for (const completionContract of [undefined, { version: 1 as const, requiredArtifacts: [{ kind: 'report' as const, minCount: 1, language: 'hy' }] }]) {
    const run = await store.createRun({ projectId: project.id, threadId: 'fixture', instruction: 'Retain a synthetic result.', allowedTools: ['fixture.write'], ...(completionContract ? { completionContract } : {}) });
    assert.equal(run.workflowVersion, AGENT_WORKFLOW_VERSION); assert.equal(run.workflowVersion, 2);
    assert.equal(historicalV1ReaderAccepts(run), false);
    run.steps.push({ id: 'prepared', tool: 'fixture.write', effect: 'local-write', arguments: {}, status: 'prepared', summary: 'Synthetic prepared action.',
      binding: { version: 1, executorIdentity: 'a'.repeat(64), toolSchemaHash: 'b'.repeat(64) } });
    assert.equal(historicalV1ReaderAccepts(run), false);
  }
});
