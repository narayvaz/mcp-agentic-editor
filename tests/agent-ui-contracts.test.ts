import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentRun } from '../shared/agent-contracts';
import {
  acceptAgentDetail, agentApprovalIssue, agentApprovalKey, agentArtifactSelection,
  agentCanResume, agentIsTerminal, defaultAgentTools, freezeAgentSelection, prepareAgentStart,
} from '../src/lib/agent-api';

const now = Date.parse('2026-10-22T10:00:00Z');
function run(patch: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-a', projectId: 'project-a', threadId: 'thread-a', instruction: 'Review the attached evidence',
    allowedTools: ['wordpress.edit'], policyVersion: 1, workflowVersion: 2, status: 'waiting-approval', revision: 8,
    plan: [], artifacts: [], summary: '', createdAt: '2026-10-22T09:00:00Z', updatedAt: '2026-10-22T10:00:00Z',
    steps: [{ id: 'step-a', tool: 'wordpress.edit', arguments: { postId: '12', expectedRevision: 'source-revision', title: 'Exact title' },
      effect: 'external-write', status: 'prepared', summary: 'Save the reviewed title' }],
    approval: { id: 'approval-a', stepId: 'step-a', digest: 'a'.repeat(64), expiresAt: '2026-10-22T10:05:00Z', status: 'pending', summary: 'Save title' },
    limits: { maxSteps: 10, maxActiveMs: 60_000 }, activeMs: 0, cancelRequested: false, pauseRequested: false, fence: 0, ...patch,
  };
}

test('external changes never receive a default grant, including duplicate tool descriptions', () => {
  assert.deepEqual(defaultAgentTools([
    { name: 'read', description: '', effect: 'read' }, { name: 'local', description: '', effect: 'local-write' },
    { name: 'remote', description: '', effect: 'external-write' }, { name: 'read', description: '', effect: 'read' },
  ]), ['read', 'local']);
});

test('task context captures identity and revision without following later selection changes', () => {
  const story = { kind: 'wordpress' as const, id: '12', title: 'Original', siteId: 'hy', revision: 'r1', language: 'hy', summary: 'Private context', url: 'https://example.test' };
  const captured = freezeAgentSelection(story)!;
  story.title = 'Changed'; story.revision = 'r2';
  assert.equal(captured.title, 'Original'); assert.equal(captured.revision, 'r1');
  assert.equal('summary' in captured, false); assert.equal('url' in captured, false);
  assert.equal(freezeAgentSelection(null), undefined);
});

test('approval is unavailable after expiry, revision change, consumed action or missing tool grant', () => {
  const current = run(); assert.equal(agentApprovalIssue(current, now), undefined);
  assert.ok(agentApprovalIssue(current, now + 300_000));
  assert.ok(agentApprovalIssue(run({ allowedTools: [] }), now));
  assert.ok(agentApprovalIssue(run({ approval: { ...current.approval!, digest: 'invalid' } }), now));
  assert.ok(agentApprovalIssue(run({ approval: { ...current.approval!, status: 'consumed' } }), now));
  assert.ok(agentApprovalIssue(run({ steps: [{ ...current.steps[0], status: 'succeeded' }] }), now));
  assert.notEqual(agentApprovalKey(current), agentApprovalKey(run({ revision: 9 })));
  assert.notEqual(agentApprovalKey(current), agentApprovalKey(run({ approval: { ...current.approval!, digest: 'b'.repeat(64) } })));
});

test('a paused task can resolve its retained pending approval without bypassing it', () => {
  const paused = run({ status: 'paused', pauseRequested: true });
  assert.equal(agentApprovalIssue(paused, now), undefined);
  assert.equal(agentCanResume(paused), false);
  assert.match(agentApprovalIssue(paused, now + 300_000)!, /Reject it or send new guidance/);
});

test('late task reads cannot move selection or replace newer action receipts', () => {
  const latest = { run: run({ revision: 12 }), events: [] };
  assert.equal(acceptAgentDetail(latest, { run: run({ revision: 11 }), events: [] }, 'project-a', 'run-a'), latest);
  assert.equal(acceptAgentDetail(latest, { run: run({ projectId: 'project-b' }), events: [] }, 'project-a', 'run-a'), latest);
  assert.equal(acceptAgentDetail(latest, { run: run({ id: 'run-b' }), events: [] }, 'project-a', 'run-a'), latest);
  const next = { run: run({ revision: 13 }), events: [] };
  assert.equal(acceptAgentDetail(latest, next, 'project-a', 'run-a'), next);
});

test('uncertain external writes cannot be resumed as if they had never executed', () => {
  assert.equal(agentCanResume(run({ status: 'paused', approval: undefined, steps: [] })), true);
  assert.equal(agentCanResume(run({ status: 'paused', approval: undefined, steps: [{ ...run().steps[0], status: 'uncertain' }] })), false);
  assert.equal(agentCanResume(run({ status: 'paused' })), false);
  assert.equal(agentCanResume(run({ status: 'paused', approval: undefined, cancelRequested: true })), false);
  assert.equal(agentIsTerminal('failed'), true); assert.equal(agentIsTerminal('waiting-input'), false);
});

test('a failed read can resume while an unresolved write stays blocked', () => {
  const step = { ...run().steps[0], status: 'failed' as const };
  assert.equal(agentCanResume(run({ status: 'paused', approval: undefined, steps: [{ ...step, effect: 'read' }] })), true);
  assert.equal(agentCanResume(run({ status: 'paused', approval: undefined, steps: [{ ...step, effect: 'local-write' }] })), false);
});

test('legacy and future task formats cannot offer resume or approval controls', () => {
  for (const patch of [{ workflowVersion: 1 }, { workflowVersion: 3 }, { policyVersion: 2 }]) {
    assert.equal(agentCanResume(run({ status: 'paused', approval: undefined, steps: [], ...patch })), false);
    assert.match(agentApprovalIssue(run(patch), now)!, /unsupported format/);
  }
});

test('a quarantined prepared action with rejected authority cannot offer resume', () => {
  const current = run();
  assert.equal(agentCanResume(run({ status: 'paused', approval: { ...current.approval!, status: 'rejected' } })), false);
});

test('retained briefs and reports select their evidence record; WordPress requires an edition', () => {
  assert.equal(agentArtifactSelection({ id: 'out', kind: 'report', resourceId: 'evidence-1', revision: 4, title: 'Brief' })?.kind, 'evidence');
  assert.equal(agentArtifactSelection({ id: 'out', kind: 'draft', resourceId: 'evidence-1', title: 'Draft' })?.id, 'evidence-1');
  assert.equal(agentArtifactSelection({ id: 'out', kind: 'wordpress', resourceId: '12', title: 'Article' }), null);
  assert.equal(agentArtifactSelection({ id: 'out', kind: 'wordpress', resourceId: '12', siteId: 'hy', title: 'Article' })?.kind, 'wordpress');
});

test('an unchanged ambiguous start reuses its saved identity across a reload', () => {
  const draft = { instruction: ' Review this story ', threadId: 'thread-a', selection: { kind: 'evidence' as const, id: 'record-a', title: 'Original', revision: 2 } };
  const first = prepareAgentStart('project-a', draft, ['research.search', 'evidence.save', 'research.search'], () => 'request-a');
  const retained = JSON.parse(JSON.stringify({ ...draft, tools: first.input.allowedTools, requestId: first.input.requestId, requestFingerprint: first.requestFingerprint, startUnconfirmed: true }));
  const retry = prepareAgentStart('project-a', retained, ['evidence.save', 'research.search'], () => { throw new Error('An unchanged retry must not allocate a new identity.'); });
  assert.equal(retry.reused, true); assert.deepEqual(retry.input, first.input);
  assert.equal(first.input.instruction, 'Review this story');
  draft.selection.revision = 3;
  assert.equal(first.input.selection?.revision, 2);
});

test('changed task authority or content never reuses the earlier request identity', () => {
  const first = prepareAgentStart('project-a', { instruction: 'Review', threadId: 'thread-a' }, ['research.search'], () => 'request-a');
  const retained = { instruction: 'Review', threadId: 'thread-a', requestId: first.input.requestId, requestFingerprint: first.requestFingerprint };
  for (const [projectId, draft, tools] of [
    ['project-a', { ...retained, instruction: 'Publish' }, ['research.search']],
    ['project-b', retained, ['research.search']],
    ['project-a', retained, ['research.search', 'wordpress.edit']],
    ['project-a', { ...retained, selection: { kind: 'evidence' as const, id: 'record-b', title: 'Other' } }, ['research.search']],
  ] as const) {
    const next = prepareAgentStart(projectId, draft, [...tools], () => 'request-b');
    assert.equal(next.reused, false); assert.equal(next.input.requestId, 'request-b');
  }
});
