import type { Express } from 'express';
import { AgentError, AGENT_WORKFLOW_VERSION, type AgentDecider, type AgentRun, type AgentRunInput, type AgentStore, type AgentTool } from '../shared/agent-contracts';
import { createPostgresAgentStore } from './agent-store';
import { AgentRuntime, type AgentAuthorizationContext } from './agent-runtime';

export type AgentServiceOptions = {
  databaseUrl: () => string; tools: AgentTool[]; decide: AgentDecider;
  authorize?: (context: AgentAuthorizationContext) => boolean | Promise<boolean>;
  validateInput?: (input: AgentRunInput) => AgentRunInput;
  modelConfigured?: () => boolean;
  storeFactory?: (url: string) => AgentStore;
};
/** The desktop remains loopback-only. This service does not expose a remote listener. */
export function registerAgentRuntimeRoutes(app: Express, options: AgentServiceOptions) {
  let service: Promise<{ store: AgentStore; runtime: AgentRuntime }> | undefined;
  let closing = false;
  const active = new Set<string>();
  async function ready() {
    if (closing || !options.databaseUrl()) throw new AgentError('Agent tasks need a configured PostgreSQL connection. Existing chat and editing remain available.', 503, 'AGENT_NOT_CONFIGURED');
    if (!service) service = (async () => {
      const store = (options.storeFactory ?? createPostgresAgentStore)(options.databaseUrl());
      try {
        await store.initialize();
        const runtime = new AgentRuntime(store, options.tools, options.decide, { authorize: options.authorize });
        await runtime.recover();
        return { store, runtime };
      } catch (issue) { await store.close().catch(() => {}); throw issue; }
    })().catch(issue => { service = undefined; throw issue; });
    return service;
  }
  function dispatch(run: AgentRun, runtime: AgentRuntime) {
    if (run.status !== 'queued' && run.status !== 'running' || active.has(run.id)) return;
    active.add(run.id);
    void runtime.start(run.id).catch(() => { /* Runtime persists safe errors; never log secret-bearing causes. */ }).finally(() => active.delete(run.id));
  }
  const pump = setInterval(() => {
    if (!service || closing) return;
    void ready().then(async ({ store, runtime }) => {
      const runs = await store.listRuns(undefined, ['queued', 'running']);
      for (const run of runs) dispatch(run, runtime);
    }).catch(() => {});
  }, 3000);
  pump.unref();
  const fail = (res: any, issue: unknown) => {
    const safe = issue instanceof AgentError ? issue : new AgentError('The agent operation could not be confirmed. Refresh the task before continuing.', 503, 'AGENT_UNAVAILABLE');
    res.status(safe.status).json({ ok: false, error: safe.message, code: safe.code });
  };
  const handle = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any) => { void fn(req, res).catch(issue => fail(res, issue)); };
  app.get('/api/agent-runtime/status', handle(async (_req, res) => {
    const details = { tools: options.tools.map(({ name, description, effect }) => ({ name, description, effect })), workflowVersion: AGENT_WORKFLOW_VERSION,
      executionLocation: 'desktop', backgroundAvailable: false, note: 'Tasks use the installed desktop backend. Closing the app pauses execution; VPS execution is not yet enabled.' };
    try {
      const { store } = await ready(); await store.listProjects();
      const configured = options.modelConfigured?.() ?? true;
      res.json({ ...details, databaseAvailable: true, available: configured, ...(!configured ? { reason: 'Configure the AI connection before starting an agent task.' } : {}) });
    } catch (issue) { res.json({ ...details, databaseAvailable: false, available: false, reason: issue instanceof AgentError ? issue.message : 'The agent database is unavailable.' }); }
  }));
  app.get('/api/agent-runtime/projects', handle(async (_req, res) => { const { store } = await ready(); res.json({ projects: await store.listProjects() }); }));
  app.post('/api/agent-runtime/projects', handle(async (req, res) => { const { store } = await ready(); res.status(201).json({ project: await store.createProject(req.body?.name) }); }));
  app.get('/api/agent-runtime/runs', handle(async (req, res) => { const { store } = await ready(); res.json({ runs: await store.listRuns(typeof req.query.projectId === 'string' ? req.query.projectId : undefined) }); }));
  app.get('/api/agent-runtime/runs/:id', handle(async (req, res) => { const { store } = await ready(); res.json({ run: await store.getRun(req.params.id), events: await store.events(req.params.id) }); }));
  app.post('/api/agent-runtime/runs', handle(async (req, res) => {
    const { store, runtime } = await ready();
    if (options.modelConfigured && !options.modelConfigured()) throw new AgentError('Configure the AI provider before starting an agent task.', 503, 'AGENT_MODEL_NOT_CONFIGURED');
    const input = options.validateInput ? options.validateInput(req.body) : req.body;
    if (!Array.isArray(input?.allowedTools) || input.allowedTools.some((name: string) => !options.tools.some(tool => tool.name === name))) throw new AgentError('Choose only tools registered in this Studio installation.');
    const run = await store.createRun(input);
    res.status(202).json({ run }); dispatch(run, runtime);
  }));
  for (const action of ['pause', 'cancel', 'resume', 'redirect', 'approve', 'reject'] as const) {
    app.post(`/api/agent-runtime/runs/:id/${action}`, handle(async (req, res) => {
      const { store, runtime } = await ready(), body = req.body ?? {};
      const current = await store.getRun(req.params.id);
      if (!Number.isInteger(body.expectedRevision) || body.expectedRevision !== current.revision) throw new AgentError('The task changed. Refresh it before taking this action.', 409, 'AGENT_CONFLICT');
      let run: AgentRun;
      if (action === 'approve' || action === 'reject') run = await runtime[action](current.id, body.approvalId, body.digest, body.expectedRevision);
      else if (action === 'redirect') run = await runtime.redirect(current.id, body.instruction, body.expectedRevision);
      else run = await runtime[action](current.id, body.expectedRevision);
      res.status(202).json({ run }); dispatch(run, runtime);
    }));
  }
  return {
    async close() {
      closing = true; clearInterval(pump);
      if (!service) return;
      const { store, runtime } = await service;
      for (const id of active) await runtime.pause(id).catch(() => {});
      // Persisted leases protect unfinished external actions if process shutdown interrupts them.
      await store.close();
    },
  };
}
