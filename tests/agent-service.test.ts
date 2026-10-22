import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { registerAgentRuntimeRoutes, type AgentServiceOptions } from '../server/agent-service.ts';
import { createRuntimeSecurity } from '../server/runtime-security.ts';
import { createStudioAgentTools } from '../server/agent-tools.ts';
import { EvidenceStore } from '../server/evidence.ts';
import { type AgentDecider, type AgentRun, type AgentTool } from '../shared/agent-contracts.ts';

const token = 'b'.repeat(64), prefix = '/api/agent-runtime';
const readTool: AgentTool = { name: 'fixture.read', description: 'Read deterministic test evidence.', effect: 'read', inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  validate(input) { assert.deepEqual(input, {}); return {}; }, async execute() { return { summary: 'Observed a fixture record.', data: { source: 'fixture', observed: true } }; } };
const readDecider: AgentDecider = async run => run.steps.some(step => step.status === 'succeeded')
  ? { kind: 'finish', summary: 'Finished with a retained observation.' }
  : { kind: 'tool', tool: readTool.name, arguments: {}, summary: 'Read the fixture.' };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function application(options: AgentServiceOptions, capabilities?: string[]) {
  const app = express(), server = http.createServer(app);
  let security: ReturnType<typeof createRuntimeSecurity>;
  app.use((req, res, next) => security.middleware(req, res, next)); app.use(express.json());
  const service = registerAgentRuntimeRoutes(app, options);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  const port = (server.address() as { port: number }).port;
  security = createRuntimeSecurity({ token, port, ...(capabilities ? { capabilities } : {}) });
  const request = async (route: string, method = 'GET', body?: unknown, authenticated = true) => {
    const response = await fetch(`http://127.0.0.1:${port}${prefix}${route}`, { method, headers: { ...(authenticated ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as any };
  };
  return { request, async close() { try { await service.close(); } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(issue => issue ? reject(issue) : resolve())); } } };
}
async function waitFor(app: Awaited<ReturnType<typeof application>>, id: string, predicate: (run: AgentRun) => boolean): Promise<AgentRun> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const response = await app.request(`/runs/${id}`);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    if (predicate(response.body.run)) return response.body.run;
    await sleep(10);
  }
  const current = await app.request(`/runs/${id}`);
  assert.fail(`Timed out waiting for an agent state: ${JSON.stringify(current.body)}`);
}
const createInput = (projectId: string, allowedTools = [readTool.name]) => ({ requestId: randomUUID(), projectId, threadId: randomUUID(), instruction: 'Read deterministic evidence and complete the assignment.', allowedTools });
const configured = (databaseUrl: string): AgentServiceOptions => ({ databaseUrl: () => databaseUrl, tools: [readTool], decide: readDecider, modelConfigured: () => true });

test('unconfigured service reports unavailable status and refuses durable actions without a fallback', async () => {
  let factories = 0;
  const app = await application({ ...configured(''), storeFactory: () => { factories++; throw new Error('A fallback must never be constructed.'); } });
  try {
    const status = await app.request('/status'); assert.equal(status.status, 200); assert.equal(status.body.available, false);
    assert.match(status.body.reason, /PostgreSQL/); assert.equal(status.body.executionLocation, 'desktop'); assert.equal(status.body.backgroundAvailable, false);
    for (const [route, method, body] of [['/projects', 'GET'], ['/projects', 'POST', { name: 'No database' }], ['/runs', 'POST', createInput(randomUUID())]] as [string, string, unknown?][]) {
      const result = await app.request(route, method, body); assert.equal(result.status, 503); assert.equal(result.body.code, 'AGENT_NOT_CONFIGURED');
    }
    assert.equal(factories, 0);
  } finally { await app.close(); }
});

test('unreachable database failures never expose connection credentials', async () => {
  const secret = 'fixture-private-password', app = await application(configured(`postgresql://fixture-private-user:${secret}@127.0.0.1:1/private-db`));
  try {
    const status = await app.request('/status'); assert.equal(status.status, 200); assert.equal(status.body.available, false); assert.ok(status.body.reason);
    const mutation = await app.request('/projects', 'POST', { name: 'Unavailable' }); assert.equal(mutation.status, 503); assert.equal(mutation.body.code, 'AGENT_STORE_UNAVAILABLE');
    assert.equal(JSON.stringify([status.body, mutation.body]).includes(secret), false); assert.equal(JSON.stringify([status.body, mutation.body]).includes('fixture-private-user'), false);
  } finally { await app.close(); }
});

test('agent controls require operator capabilities independently of a model-enabled session', async () => {
  const app = await application(configured(''), ['read', 'model:request']);
  try {
    assert.equal((await app.request('/status', 'GET', undefined, false)).status, 401);
    for (const [route, body, capability] of [
      ['/projects', { name: 'Forbidden' }, 'agent:run'], ['/runs', createInput(randomUUID()), 'agent:run'],
      [`/runs/${randomUUID()}/pause`, { expectedRevision: 1 }, 'agent:run'],
      [`/runs/${randomUUID()}/approve`, { expectedRevision: 1, approvalId: randomUUID(), digest: 'a'.repeat(64) }, 'agent:approve'],
      [`/runs/${randomUUID()}/reject`, { expectedRevision: 1, approvalId: randomUUID(), digest: 'a'.repeat(64) }, 'agent:approve'],
    ] as [string, unknown, string][]) {
      const response = await app.request(route, 'POST', body); assert.equal(response.status, 403); assert.match(response.body.error, new RegExp(capability));
    }
    assert.equal((await app.request('/status')).status, 200);
  } finally { await app.close(); }
});

const suppliedDatabase = process.env.AZAT_AGENT_TEST_DATABASE_URL;
const serviceDatabase = process.env.AZAT_AGENT_SERVICE_TEST_DATABASE_URL || (suppliedDatabase ? (() => { const url = new URL(suppliedDatabase); url.pathname = '/azat_agent_service_test'; return url.toString(); })() : undefined);
test('registered endpoints integrate PostgreSQL, runtime decisions and approved tools', { skip: serviceDatabase ? false : 'Set AZAT_AGENT_TEST_DATABASE_URL and provision azat_agent_service_test, or set AZAT_AGENT_SERVICE_TEST_DATABASE_URL.' }, async t => {
  const admin = new Pool({ connectionString: serviceDatabase!, max: 1 });
  const projects: string[] = [];
  const project = async (app: Awaited<ReturnType<typeof application>>) => {
    const response = await app.request('/projects', 'POST', { name: `service-test-${randomUUID()}` });
    assert.equal(response.status, 201, JSON.stringify(response.body)); projects.push(response.body.project.id); return response.body.project.id as string;
  };
  try {
    await t.test('asynchronous creation is idempotent and produces a completed read with durable events', async () => {
      const phases: string[] = [], app = await application({ ...configured(serviceDatabase!), authorize: async input => { phases.push(input.phase); return true; } });
      try {
        const status = await app.request('/status'); assert.equal(status.body.available, true); assert.equal(status.body.backgroundAvailable, false);
        const projectId = await project(app), input = createInput(projectId);
        const responses = await Promise.all([app.request('/runs', 'POST', input), app.request('/runs', 'POST', input)]);
        assert.ok(responses.every(response => response.status === 202)); assert.ok(responses.every(response => response.body.run.id === input.requestId));
        const done = await waitFor(app, input.requestId, run => run.status === 'completed' && !run.leaseOwner);
        assert.equal(done.steps.length, 1); assert.equal(done.steps[0].status, 'succeeded'); assert.equal((done.steps[0].result as any).data.observed, true);
        const detail = await app.request(`/runs/${done.id}`); assert.equal(detail.body.events.filter((event: any) => event.type === 'run.created').length, 1);
        assert.ok(detail.body.events.some((event: any) => event.type === 'run.completed')); assert.deepEqual(phases, ['prepare', 'execute']);
        const listed = await app.request(`/runs?projectId=${projectId}`); assert.equal(listed.body.runs.length, 1);
        const conflict = await app.request('/runs', 'POST', { ...input, instruction: 'Different instruction' }); assert.equal(conflict.status, 409);
        const unknown = await app.request('/runs', 'POST', { ...createInput(projectId), allowedTools: ['shell.execute'] }); assert.equal(unknown.status, 400);
        const stale = await app.request(`/runs/${done.id}/approve`, 'POST', { expectedRevision: 1, approvalId: randomUUID(), digest: 'a'.repeat(64) }); assert.equal(stale.status, 409); assert.equal(stale.body.code, 'AGENT_CONFLICT');
      } finally { await app.close(); }
    });

    await t.test('external actions remain unexecuted until exact approval and cannot be approved with a stale revision', async () => {
      let writes = 0;
      const write: AgentTool = { ...readTool, name: 'fixture.external', effect: 'external-write', async execute() { writes++; return { summary: 'Fixture external effect confirmed.', data: { receipt: { provider: 'fixture', observed: true } } }; } };
      const decide: AgentDecider = async run => run.steps.some(step => step.status === 'succeeded') ? { kind: 'finish', summary: 'Confirmed approved effect.' } : { kind: 'tool', tool: write.name, arguments: {}, summary: 'Propose an external test action.' };
      const phases: string[] = [], app = await application({ ...configured(serviceDatabase!), tools: [write], decide, authorize: async value => { phases.push(value.phase); return true; } });
      try {
        const created = await app.request('/runs', 'POST', createInput(await project(app), [write.name])); assert.equal(created.status, 202);
        const waiting = await waitFor(app, created.body.run.id, run => run.status === 'waiting-approval' && !run.leaseOwner);
        assert.equal(writes, 0); assert.equal(waiting.steps[0].status, 'prepared'); assert.equal(waiting.approval?.status, 'pending');
        const approvedBody = { expectedRevision: waiting.revision, approvalId: waiting.approval!.id, digest: waiting.approval!.digest };
        const stale = await app.request(`/runs/${waiting.id}/approve`, 'POST', { ...approvedBody, expectedRevision: waiting.revision - 1 }); assert.equal(stale.status, 409); assert.equal(writes, 0);
        const approved = await app.request(`/runs/${waiting.id}/approve`, 'POST', approvedBody); assert.equal(approved.status, 202, JSON.stringify(approved.body));
        const done = await waitFor(app, waiting.id, run => run.status === 'completed' && !run.leaseOwner);
        assert.equal(writes, 1); assert.equal(done.approval?.status, 'consumed'); assert.equal(done.steps[0].status, 'succeeded'); assert.deepEqual(phases, ['prepare', 'approve', 'execute']);
        const repeated = await app.request(`/runs/${waiting.id}/approve`, 'POST', approvedBody); assert.equal(repeated.status, 409); assert.equal(writes, 1);
      } finally { await app.close(); }
    });

    await t.test('execution policy can deny an allowed registered tool before any side effect', async () => {
      let reads = 0;
      const denied: AgentTool = { ...readTool, async execute() { reads++; return { summary: 'Should never execute.' }; } };
      const app = await application({ ...configured(serviceDatabase!), tools: [denied], authorize: () => false });
      try {
        const created = await app.request('/runs', 'POST', createInput(await project(app))); assert.equal(created.status, 202);
        const stopped = await waitFor(app, created.body.run.id, run => run.status === 'failed' && !run.leaseOwner);
        assert.equal(reads, 0); assert.match(stopped.summary, /AGENT_TOOL_DENIED/); assert.equal(stopped.steps.length, 0);
      } finally { await app.close(); }
    });

    await t.test('missing model configuration is visible and blocks task creation', async () => {
      const app = await application({ ...configured(serviceDatabase!), modelConfigured: () => false });
      try {
        const status = await app.request('/status'); assert.equal(status.body.available, false); assert.match(status.body.reason, /AI/);
        const projectId = await project(app), response = await app.request('/runs', 'POST', createInput(projectId));
        assert.equal(response.status, 503); assert.equal(response.body.code, 'AGENT_MODEL_NOT_CONFIGURED');
        const list = await app.request(`/runs?projectId=${projectId}`); assert.deepEqual(list.body.runs, []);
      } finally { await app.close(); }
    });

    await t.test('research receipts feed unverified evidence and retained HY and EN article drafts', async () => {
      const directory = mkdtempSync(path.join(tmpdir(), 'azat-agent-service-')), evidence = new EvidenceStore(path.join(directory, 'evidence.json'));
      const passage = 'Exact passage retained by the trusted research adapter.';
      const tools = createStudioAgentTools({ evidence: () => evidence,
        research: async () => [{ title: 'Original report', url: 'https://example.org/original', passage, snippet: 'Search lead', contentHash: 'fixture-source-hash', sourceType: 'page', capturedAt: new Date().toISOString() }],
        readWordPress: async () => { throw new Error('WordPress was not selected.'); }, editWordPress: async () => { throw new Error('WordPress was not authorized.'); },
        draft: async (record, language) => `${language}: Draft from retained record ${record.id}; editor verification required.`, production: async () => ({}) });
      const decide: AgentDecider = async run => {
        const research = run.steps.find(step => step.tool === 'research.search' && step.status === 'succeeded');
        if (!research) return { kind: 'tool', tool: 'research.search', summary: 'Find the original public report.', arguments: { query: 'A documented public event' } };
        const record = run.artifacts.find(artifact => artifact.kind === 'evidence');
        if (!record) {
          const sourceId = (research.result as any).data.sources[0].id;
          return { kind: 'tool', tool: 'evidence.save', summary: 'Retain source-linked claims for editorial review.', arguments: { title: 'Source-linked brief', summary: 'Requires editorial verification.', language: 'en', sourceIds: [sourceId], claims: [{ text: 'A claim from the original report.', sourceIds: [sourceId] }] } };
        }
        for (const language of ['hy', 'en']) if (!run.steps.some(step => step.tool === 'evidence.draft' && step.arguments.language === language && step.status === 'succeeded')) return { kind: 'tool', tool: 'evidence.draft', summary: `Draft a ${language} article.`, arguments: { recordId: record.resourceId, language } };
        return { kind: 'finish', summary: 'Retained evidence and two language drafts for editorial review.' };
      };
      const app = await application({ ...configured(serviceDatabase!), tools, decide, authorize: () => true });
      try {
        const input = createInput(await project(app), ['research.search', 'evidence.save', 'evidence.draft']), created = await app.request('/runs', 'POST', input); assert.equal(created.status, 202);
        const done = await waitFor(app, created.body.run.id, run => ['completed', 'failed', 'paused'].includes(run.status) && !run.leaseOwner);
        assert.equal(done.status, 'completed', JSON.stringify(done)); assert.equal(done.steps.length, 4); assert.ok(done.steps.every(step => step.status === 'succeeded'));
        const records = evidence.list(); assert.equal(records.length, 1); assert.equal(records[0].sources[0].excerpt, passage); assert.equal(records[0].claims[0].status, 'unverified');
        assert.deepEqual(records[0].outputs.map(output => output.language), ['hy', 'en']); assert.ok(records[0].outputs.every(output => output.verification === 'editor-review-required'));
        assert.equal(done.artifacts.filter(artifact => artifact.kind === 'draft').length, 2);
      } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
    });
  } finally {
    for (const id of projects) {
      await admin.query('DELETE FROM azat_agent.events WHERE run_id IN (SELECT id FROM azat_agent.runs WHERE project_id=$1)', [id]);
      await admin.query('DELETE FROM azat_agent.runs WHERE project_id=$1', [id]); await admin.query('DELETE FROM azat_agent.projects WHERE id=$1', [id]);
    }
    await admin.end();
  }
});
