import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceTaskBridge, voiceTaskReceipt } from '../server/voice-task-bridge.ts';
import type { AgentRun } from '../shared/agent-contracts.ts';
import express from 'express';
import { registerAgentRuntimeRoutes } from '../server/agent-service.ts';
import { MemoryAgentStore } from './agent-memory-store.ts';

const run = { id: 'selected-task', revision: 7, status: 'running', instruction: 'Read public sources.', summary: 'Retained observation.', artifacts: [], steps: [{ result: 'private source material' }], approval: { digest: 'private approval' } } as unknown as AgentRun;
test('voice controls use the fresh revision and return only bounded task receipts', async () => {
  let calls = 0;
  const bridge = createVoiceTaskBridge({ capabilities: ['read', 'model:request', 'agent:run'], read: async id => { assert.equal(id, run.id); return run; },
    control: async (id, action, revision) => { assert.equal(id, run.id); assert.equal(action, 'pause'); assert.equal(revision, 7); calls++; return { ...run, status: 'paused', revision: 8 }; } });
  const result = await bridge('pause', run.id, new AbortController().signal);
  assert.equal(result.status, 'paused'); assert.equal(result.revision, 8); assert.equal(calls, 1);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(voiceTaskReceipt({ ...run, instruction: 'x'.repeat(5000), summary: 'x'.repeat(5000) }).summary.length, 2000);
});
test('voice status does not need task-control permission, and an ended call cannot dispatch a late control', async () => {
  let controls = 0; const controller = new AbortController();
  const readOnly = createVoiceTaskBridge({ capabilities: ['read', 'model:request'], read: async () => run, control: async () => { controls++; return run; } });
  assert.equal((await readOnly('status', run.id, controller.signal)).status, 'running');
  await assert.rejects(readOnly('cancel', run.id, controller.signal), /cannot control/);
  const ended = createVoiceTaskBridge({ capabilities: ['read', 'model:request', 'agent:run'], read: async () => { controller.abort(); return run; }, control: async () => { controls++; return run; } });
  await assert.rejects(ended('pause', run.id, controller.signal)); assert.equal(controls, 0);
});

test('voice bridge controls the same durable runtime and a stale revision cannot overwrite the result', async () => {
  const store = new MemoryAgentStore();
  const project = await store.createProject('Voice acceptance fixture');
  const retained = await store.createRun({ projectId: project.id, threadId: 'voice-test', instruction: 'Retained fixture task.', allowedTools: ['fixture.read'] });
  let decisions = 0;
  const service = registerAgentRuntimeRoutes(express(), { databaseUrl: () => 'postgresql://isolated.invalid/test', storeFactory: () => store, tools: [], decide: async () => { decisions++; return { kind: 'finish', summary: 'Must not execute.' }; } });
  const bridge = createVoiceTaskBridge({ capabilities: ['read', 'model:request', 'agent:run'], read: service.inspectVoiceTask, control: service.controlVoiceTask });
  try {
    const initial = await bridge('status', retained.id, new AbortController().signal);
    assert.equal(initial.status, 'queued');
    const cancelled = await bridge('cancel', retained.id, new AbortController().signal);
    assert.equal(cancelled.status, 'cancelled'); assert.ok(cancelled.revision > initial.revision); assert.equal(decisions, 0);
    await assert.rejects(service.controlVoiceTask(retained.id, 'pause', initial.revision, new AbortController().signal));
    assert.equal((await store.getRun(retained.id)).status, 'cancelled');
  } finally { await service.close(); }
});
