import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentEvent, AgentProject, AgentRun, AgentStep } from '../../shared/agent-contracts';
import {
  acceptAgentDetail, agentApi, agentApprovalIssue, agentApprovalKey, agentArtifactSelection,
  agentCanPause, agentCanResume, agentIsTerminal, agentResumeIssue, defaultAgentTools, freezeAgentSelection, prepareAgentStart,
  type AgentAction, type AgentRunDetail, type AgentRuntimeStatus, type AgentStartDraft,
} from '../lib/agent-api';
import { formatTime, useStored, useStudio } from '../lib/studio';
import { Badge, EmptyState, Field, Notice, PageTitle, RefreshButton } from './StudioUI';
import './AgentTasks.css';

type TaskDraft = AgentStartDraft;
type RunList = { projectId: string; items: AgentRun[]; loaded: boolean };
const emptyDraft: TaskDraft = { instruction: '', threadId: '' };
const draftStorageKey = 'azat.studio.agent.drafts.v1';
const statusLabel = (status: AgentRun['status']) => ({
  queued: 'Queued', running: 'Running', 'waiting-approval': 'Needs approval', 'waiting-input': 'Needs your answer',
  paused: 'Paused', failed: 'Failed', cancelled: 'Stopped', completed: 'Completed',
}[status]);
const effectLabel = (effect: string) => ({ read: 'Read', 'local-write': 'Save local records', 'external-write': 'Change external system' }[effect] || 'Unavailable tool');
const toolLabel = (name: string) => ({ 'selection.read': 'Read attached story', 'research.search': 'Search public sources', 'research.capture': 'Read a public source URL', 'evidence.save': 'Save source-linked evidence', 'evidence.draft': 'Prepare a language draft', 'wordpress.edit': 'Update the attached article', 'production.observe': 'Check pipeline activity' }[name] || name);
function statusTone(status: AgentRun['status']): 'good' | 'warning' | 'error' | 'neutral' {
  return status === 'completed' ? 'good' : status === 'failed' ? 'error' : ['waiting-approval', 'waiting-input', 'paused'].includes(status) ? 'warning' : 'neutral';
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'The request could not be completed.'; }
function wasAborted(error: unknown) { return error instanceof Error && error.name === 'AbortError'; }
function showJson(value: unknown) {
  try { return JSON.stringify(value, null, 2) ?? 'No details recorded.'; } catch { return 'These details could not be displayed.'; }
}

function ApprovalChanges({ run, step }: { run: AgentRun; step?: AgentStep }) {
  if (!step || step.tool !== 'wordpress.edit') return <pre className="code-text" tabIndex={0}>{step ? showJson(step.arguments) : 'Prepared action not available.'}</pre>;
  const read = run.steps.filter(item => item.tool === 'selection.read' && item.status === 'succeeded').at(-1);
  const previous = (read?.result as { data?: Record<string, unknown> } | undefined)?.data;
  const fields = ['title', 'excerpt', 'content'].filter(field => typeof step.arguments[field] === 'string');
  const patches = Array.isArray(step.arguments.patches) ? step.arguments.patches as { before: string; after: string }[] : [];
  return <div className="section-space">
    <p className="agent-inline-note">Destination: {typeof previous?.destinationBaseUrl === 'string' ? previous.destinationBaseUrl : 'Inspect the attached site before approving'} · article {run.selection?.id}</p>
    {fields.map(field => <div className="section-space" key={field}><h3>{field === 'title' ? 'Headline' : field === 'excerpt' ? 'Summary' : 'Article text'}</h3><div className="agent-change-grid">
      <div><strong>Current</strong><pre className="code-text" tabIndex={0}>{typeof previous?.[field] === 'string' ? previous[field] as string : 'Current text is not retained. Inspect the article before approval.'}</pre></div>
      <div><strong>Proposed</strong><pre className="code-text" tabIndex={0}>{step.arguments[field] as string || '(empty)'}</pre></div>
    </div></div>)}
    {patches.map((patch, index) => <div className="section-space" key={index}><h3>Passage change {index + 1}</h3><div className="agent-change-grid">
      <div><strong>Current passage</strong><pre className="code-text" tabIndex={0}>{patch.before}</pre></div>
      <div><strong>Proposed passage</strong><pre className="code-text" tabIndex={0}>{patch.after || '(remove this passage)'}</pre></div>
    </div></div>)}
  </div>;
}

/** Durable task records are separate from advice-chat history and its retry controls. */
export default function AgentTasks({ initialInstruction, onInstructionConsumed }: { initialInstruction?: string; onInstructionConsumed?: () => void } = {}) {
  const { selection, selectStory } = useStudio();
  const [runtime, setRuntime] = useState<AgentRuntimeStatus | null>(null);
  const [projects, setProjects] = useState<AgentProject[]>([]);
  const [projectId, setProjectId, projectStorageError] = useStored('azat.studio.agent.project.v1', '');
  const [drafts, setDrafts, draftStorageError] = useStored<Record<string, TaskDraft>>(draftStorageKey, {});
  const [selectedRuns, setSelectedRuns, runStorageError] = useStored<Record<string, string>>('azat.studio.agent.selected-runs.v1', {});
  const [projectName, setProjectName] = useState('');
  const [bootBusy, setBootBusy] = useState(true);
  const [bootError, setBootError] = useState('');
  const [projectError, setProjectError] = useState('');
  const [projectBusy, setProjectBusy] = useState(false);
  const [runList, setRunList] = useState<RunList>({ projectId: '', items: [], loaded: false });
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState('');
  const [detail, setDetail] = useState<AgentRunDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [listRefresh, setListRefresh] = useState(0);
  const [startingProject, setStartingProject] = useState('');
  const [startMessages, setStartMessages] = useState<Record<string, { error: boolean; text: string }>>({});
  const [actionBusy, setActionBusy] = useState('');
  const [actionMessage, setActionMessage] = useState<{ scope: string; error: boolean; text: string } | null>(null);
  const [redirectDrafts, setRedirectDrafts, redirectStorageError] = useStored<Record<string, string>>('azat.studio.agent.guidance.v1', {});
  const [reviewedApproval, setReviewedApproval] = useState('');
  const [clock, setClock] = useState(Date.now);
  const bootController = useRef<AbortController | null>(null);
  const bootstrapGeneration = useRef(0);
  const listGeneration = useRef(0);
  const mounted = useRef(true);
  const activeScope = useRef('');
  const currentProject = useRef(projectId);
  const initialApplied = useRef('');
  currentProject.current = projectId;
  const selectedRunId = selectedRuns[projectId] || '';
  const scope = projectId + ':' + selectedRunId;
  activeScope.current = scope;
  const selectedRun = detail?.run.projectId === projectId && detail.run.id === selectedRunId ? detail.run : null;
  const events = selectedRun ? detail!.events : [];
  const currentRuns = runList.projectId === projectId ? runList.items : [];
  const draft = drafts[projectId] || emptyDraft;
  const tools = Array.isArray(runtime?.tools) ? runtime.tools : [];
  const chosenTools = (draft.tools ?? defaultAgentTools(tools)).filter(name => tools.some(tool => tool.name === name));
  const ready = runtime?.available === true;
  const databaseReady = runtime?.databaseAvailable === true || (runtime?.databaseAvailable === undefined && ready);
  const projectLoaded = projects.some(project => project.id === projectId);
  const approvalKey = selectedRun ? agentApprovalKey(selectedRun) : '';
  const approvalIssue = selectedRun ? agentApprovalIssue(selectedRun, clock) : undefined;
  const approvalStep = selectedRun?.steps.find(step => step.id === selectedRun.approval?.stepId);
  const pendingApproval = selectedRun?.approval?.status === 'pending' ? selectedRun.approval : null;
  const storageError = projectStorageError || draftStorageError || runStorageError || redirectStorageError;

  const bootstrap = useCallback(async () => {
    bootController.current?.abort();
    const controller = new AbortController(); bootController.current = controller;
    const generation = ++bootstrapGeneration.current;
    setBootBusy(true); setBootError('');
    const [statusResult, projectsResult] = await Promise.allSettled([agentApi.status(controller.signal), agentApi.projects(controller.signal)]);
    if (!mounted.current || controller.signal.aborted || generation !== bootstrapGeneration.current) return;
    if (statusResult.status === 'fulfilled') {
      setRuntime(statusResult.value);
      if (statusResult.value.available !== true) setBootError(statusResult.value.reason || 'The task runtime is unavailable.');
    } else { setRuntime(null); setBootError(errorMessage(statusResult.reason)); }
    if (projectsResult.status === 'fulfilled') {
      setProjects(projectsResult.value.projects);
      setProjectError('');
      setProjectId(current => projectsResult.value.projects.some(project => project.id === current) ? current : projectsResult.value.projects[0]?.id || '');
    } else { setProjectError(errorMessage(projectsResult.reason)); }
    setBootBusy(false);
  }, [setProjectId]);
  useEffect(() => {
    mounted.current = true; void bootstrap();
    return () => { mounted.current = false; bootController.current?.abort(); };
  }, [bootstrap]);

  function changeDraft(patch: Partial<TaskDraft>, owner = projectId) {
    if (!owner) return;
    setDrafts(current => ({ ...current, [owner]: { ...(current[owner] || emptyDraft), threadId: current[owner]?.threadId || crypto.randomUUID(), requestId: undefined, requestFingerprint: undefined, ...patch } }));
  }
  useEffect(() => {
    if (!initialInstruction) { initialApplied.current = ''; return; }
    if (!projectId || initialApplied.current === initialInstruction) return;
    // An incoming suggestion never overwrites work already in the composer.
    if (!drafts[projectId]?.instruction.trim()) {
      changeDraft({ instruction: initialInstruction, threadId: crypto.randomUUID(), selection: undefined, tools: tools.length ? defaultAgentTools(tools) : undefined }, projectId);
      initialApplied.current = initialInstruction; onInstructionConsumed?.();
    }
  }, [initialInstruction, projectId]);

  useEffect(() => {
    if (!projectId || !databaseReady) return;
    const owner = projectId; const controller = new AbortController(); let live = true;
    const generation = ++listGeneration.current;
    setListBusy(true); setListError('');
    if (runList.projectId !== owner) setRunList({ projectId: owner, items: [], loaded: false });
    agentApi.runs(owner, controller.signal).then(data => {
      if (!live || currentProject.current !== owner || generation !== listGeneration.current) return;
      setRunList({ projectId: owner, items: data.runs, loaded: true });
      setSelectedRuns(current => data.runs.some(run => run.id === current[owner]) ? current : { ...current, [owner]: data.runs[0]?.id || '' });
    }).catch(error => { if (live && currentProject.current === owner && generation === listGeneration.current && !wasAborted(error)) setListError(errorMessage(error)); })
      .finally(() => { if (live && generation === listGeneration.current) setListBusy(false); });
    return () => { live = false; controller.abort(); };
  }, [projectId, databaseReady, listRefresh]);

  useEffect(() => {
    if (!projectId || !selectedRunId || !databaseReady) return;
    const ownerScope = scope; let live = true; let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let lastRun: AgentRun | null = null;
    const foreground = () => document.visibilityState === 'visible' && document.hasFocus();
    const poll = async () => {
      if (!live || inFlight || !foreground()) return;
      inFlight = true; controller = new AbortController();
      setDetailBusy(true);
      let succeeded = false;
      try {
        const incoming = await agentApi.run(selectedRunId, controller.signal);
        if (!live || activeScope.current !== ownerScope) return;
        if (incoming.run.projectId !== projectId || incoming.run.id !== selectedRunId) throw new Error('The server returned a different task. Refresh before continuing.');
        lastRun = incoming.run; succeeded = true; setDetailError('');
        setDetail(current => acceptAgentDetail(current, incoming, projectId, selectedRunId));
        setRunList(current => current.projectId === projectId ? { ...current, items: current.items.map(run => run.id === incoming.run.id && run.revision <= incoming.run.revision ? incoming.run : run) } : current);
      } catch (error) {
        if (live && activeScope.current === ownerScope && !wasAborted(error)) setDetailError(errorMessage(error));
      } finally {
        inFlight = false;
        if (live && activeScope.current === ownerScope) {
          setDetailBusy(false);
          if (foreground()) {
            if (succeeded && lastRun && !agentIsTerminal(lastRun.status)) timer = setTimeout(poll, 3_000);
            // Focus can return before an interrupted read settles.
            else if (controller?.signal.aborted) timer = setTimeout(poll, 0);
          }
        }
      }
    };
    const visibility = () => {
      if (timer) clearTimeout(timer);
      if (foreground()) void poll();
      else controller?.abort();
    };
    setDetailError(''); void poll(); document.addEventListener('visibilitychange', visibility);
    window.addEventListener('focus', visibility); window.addEventListener('blur', visibility);
    return () => {
      live = false; if (timer) clearTimeout(timer); controller?.abort();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('focus', visibility); window.removeEventListener('blur', visibility);
    };
  }, [projectId, selectedRunId, databaseReady, refresh]);
  useEffect(() => {
    if (!pendingApproval) return;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [pendingApproval?.id, pendingApproval?.expiresAt]);

  async function createProject(event: React.FormEvent) {
    event.preventDefault(); const name = projectName.trim(); if (!name || projectBusy || !databaseReady) return;
    setProjectBusy(true); setProjectError('');
    try {
      const data = await agentApi.createProject(name); if (!mounted.current) return;
      setProjects(current => [...current.filter(project => project.id !== data.project.id), data.project]);
      setProjectId(data.project.id); setProjectName(current => current.trim() === name ? '' : current);
    } catch (error) {
      if (mounted.current) setProjectError(errorMessage(error) + ' Refresh projects before retrying; the request may have been saved.');
    } finally { if (mounted.current) setProjectBusy(false); }
  }
  async function startTask(event: React.FormEvent) {
    event.preventDefault(); if (!ready || !projectLoaded || !projectId || startingProject || !draft.instruction.trim() || draft.instruction.length > 20000 || !chosenTools.length) return;
    const owner = projectId;
    const prepared = prepareAgentStart(owner, draft, chosenTools);
    const pendingDraft: TaskDraft = {
      ...draft, threadId: prepared.input.threadId, tools: prepared.input.allowedTools,
      requestId: prepared.input.requestId, requestFingerprint: prepared.requestFingerprint, startUnconfirmed: true,
    };
    // Persist the identity before sending; a restart must not turn this into a second task.
    try { localStorage.setItem(draftStorageKey, JSON.stringify({ ...drafts, [owner]: pendingDraft })); }
    catch {
      setStartMessages(current => ({ ...current, [owner]: { error: true, text: 'The task was not sent because its request identity could not be saved locally. Free local storage and try again; your instruction is retained.' } }));
      return;
    }
    setDrafts(current => ({ ...current, [owner]: pendingDraft }));
    setStartingProject(owner); setStartMessages(current => ({ ...current, [owner]: { error: false, text: 'Saving this task…' } }));
    try {
      const data = await agentApi.start(prepared.input);
      if (!mounted.current) return;
      setStartMessages(current => ({ ...current, [owner]: { error: false, text: 'Task saved. Your instruction is retained for reuse; starting again creates a separate task.' } }));
      setDrafts(current => current[owner]?.requestId === prepared.input.requestId ? {
        ...current, [owner]: { ...current[owner], requestId: undefined, requestFingerprint: undefined, startUnconfirmed: false, tools: defaultAgentTools(tools) },
      } : current);
      if (currentProject.current === owner) {
        // A pre-start list response must not remove the newly saved task or move selection.
        listGeneration.current += 1; setListBusy(false); setListError('');
        setRunList(current => ({ projectId: owner, loaded: true, items: [data.run, ...(current.projectId === owner ? current.items.filter(run => run.id !== data.run.id) : [])] }));
        setSelectedRuns(current => ({ ...current, [owner]: data.run.id }));
        setDetail({ run: data.run, events: [] }); setRefresh(value => value + 1);
      }
    } catch (error) {
      if (mounted.current) setStartMessages(current => ({ ...current, [owner]: { error: true, text: errorMessage(error) + ' Your instruction and request identity are retained. Refresh the task list first. Starting again with unchanged details reuses this request; editing them creates a new request.' } }));
    } finally { if (mounted.current) setStartingProject(''); }
  }
  async function act(action: AgentAction) {
    const needsModel = action === 'approve' || action === 'resume' || action === 'redirect';
    if (!selectedRun || !(needsModel ? ready : databaseReady) || actionBusy) return;
    const captured = selectedRun; const ownerScope = scope;
    const instruction = (redirectDrafts[captured.id] || '').trim();
    if (action === 'redirect' && (!instruction || instruction.length > 4000)) return;
    if (action === 'approve' && (agentApprovalIssue(captured) || reviewedApproval !== agentApprovalKey(captured))) return;
    const extra = action === 'redirect' ? { instruction } : (action === 'approve' || action === 'reject') && captured.approval ? { approvalId: captured.approval.id, digest: captured.approval.digest } : {};
    setActionBusy(ownerScope); setActionMessage(null);
    try {
      const data = await agentApi.action(captured, action, extra); if (!mounted.current) return;
      if (activeScope.current === ownerScope) {
        setDetail(current => acceptAgentDetail(current, { run: data.run, events: data.events || (current?.run.id === captured.id ? current.events : []) }, captured.projectId, captured.id));
        setRunList(current => current.projectId === captured.projectId ? { ...current, items: current.items.map(run => run.id === data.run.id && run.revision <= data.run.revision ? data.run : run) } : current);
        setActionMessage({ scope: ownerScope, error: false, text: action === 'cancel' ? 'Stop requested. An action already sent to an external service may still finish; inspect its receipt.' : action === 'pause' ? 'Pause requested. The task will pause at a safe checkpoint.' : 'Task updated.' });
        setRefresh(value => value + 1);
      }
      if (action === 'redirect') setRedirectDrafts(current => current[captured.id]?.trim() === instruction ? { ...current, [captured.id]: '' } : current);
    } catch (error) {
      if (mounted.current && activeScope.current === ownerScope) {
        const stale = (error as { status?: number })?.status === 409;
        setActionMessage({ scope: ownerScope, error: true, text: stale ? 'This task changed while you were reviewing it. Refreshing now; review the current action before trying again.' : errorMessage(error) + ' Refresh the task to confirm its state before retrying.' });
        if (stale) setRefresh(value => value + 1);
      }
    } finally { if (mounted.current) setActionBusy(''); }
  }
  const refreshLists = () => { setListRefresh(value => value + 1); setRefresh(value => value + 1); };
  const actionPending = actionBusy === scope;

  return <div className="page-stack agent-tasks">
    <PageTitle eyebrow="WORK" title="Agent tasks" action={<RefreshButton onClick={() => { void bootstrap(); refreshLists(); }} busy={bootBusy} />}>
      Give a task a goal, choose its tools, and review its recorded work. The Assistant chat remains a separate place for advice.
    </PageTitle>
    <Notice>Execution runs in this desktop app. Keep it open for tasks to make progress. Continuous remote work is not enabled in this version.</Notice>
    {storageError && <Notice kind="warning">{storageError}</Notice>}
    {bootError && <Notice kind="error">{bootError} <button className="btn" onClick={() => void bootstrap()} disabled={bootBusy}>Retry connection</button></Notice>}
    {!ready && databaseReady && <Notice>Saved tasks can still be inspected, paused or stopped, and pending actions can be rejected. Configure the AI connection to start or continue work.</Notice>}
    {!runtime && bootBusy && <p className="loading-line" role="status">Checking the task runtime…</p>}
    <section className="panel section-space" aria-labelledby="agent-project-heading">
      <h2 id="agent-project-heading">Project</h2>
      <div className="agent-project-row">
        <Field label="Selected project" help="Projects group saved tasks. Each task has its own tool grants and receipts.">
          <select value={projects.some(project => project.id === projectId) ? projectId : ''} onChange={event => setProjectId(event.target.value)} disabled={!projects.length || !databaseReady}>
            {!projects.length && <option value="">No project loaded</option>}
            {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </Field>
        <form className="agent-create-project" onSubmit={createProject}>
          <Field label="New project name"><input value={projectName} maxLength={160} onChange={event => setProjectName(event.target.value)} placeholder="For example, public spending investigation" disabled={!databaseReady} /></Field>
          <button className="btn" type="submit" disabled={!databaseReady || !projectName.trim() || projectBusy}>{projectBusy ? 'Creating…' : 'Create project'}</button>
        </form>
      </div>
      {projectError && <Notice kind="error">{projectError} <button className="btn" onClick={() => void bootstrap()} disabled={bootBusy}>Refresh projects</button></Notice>}
      {!bootBusy && !projects.length && !projectError && <p className="agent-inline-note">Create a project to save your first task.</p>}
    </section>
    {projectId && <section className="panel section-space" aria-labelledby="agent-new-heading">
      <div className="panel-header"><h2 id="agent-new-heading">New task</h2><button className="btn" disabled={startingProject === projectId} onClick={() => {
        if (draft.instruction.trim() && !window.confirm('Clear this project’s task instruction and selected story? Saved tasks will remain.')) return;
        setDrafts(current => ({ ...current, [projectId]: { instruction: '', threadId: crypto.randomUUID(), startUnconfirmed: current[projectId]?.startUnconfirmed } }));
      }}>Clear instruction</button></div>
      {!projectLoaded && <Notice kind="warning">The saved project has not been loaded. Refresh projects before starting this task. Your instruction is retained.</Notice>}
      {initialInstruction && initialApplied.current !== initialInstruction && <Notice kind="warning">
        <div className="section-space"><strong>Incoming instruction from the Assistant</strong><p>Your saved instruction is still here. Replacing it clears the old captured story and resets tool grants; choose the intended context again.</p>
          <pre className="code-text" tabIndex={0}>{initialInstruction}</pre>
          <div className="actions"><button className="btn" disabled={startingProject === projectId} onClick={() => {
            changeDraft({ instruction: initialInstruction, threadId: crypto.randomUUID(), selection: undefined, tools: tools.length ? defaultAgentTools(tools) : undefined });
            initialApplied.current = initialInstruction; onInstructionConsumed?.();
          }}>Replace saved instruction</button><button className="btn" onClick={() => { initialApplied.current = initialInstruction; onInstructionConsumed?.(); }}>Dismiss incoming instruction</button></div>
        </div>
      </Notice>}
      {draft.startUnconfirmed && startingProject !== projectId && <Notice kind="warning">A previous start may already have saved a task. Refresh saved tasks before continuing. An unchanged retry uses the same request identity; changing the instruction, story or tools starts a separate request. <button className="btn" onClick={refreshLists}>Refresh saved tasks</button></Notice>}
      <form className="section-space" onSubmit={startTask}>
        <Field label="What should this task achieve?" help={`Describe the outcome, source requirements, languages and stopping point. Do not include passwords or keys. ${draft.instruction.length.toLocaleString()} / 20,000 characters.`}>
          <textarea value={draft.instruction} disabled={startingProject === projectId} onChange={event => changeDraft({ instruction: event.target.value })} maxLength={20000} placeholder="Gather evidence for… Keep disputed claims separate, save a source-linked brief, and stop for my review." />
        </Field>
        <div className="agent-context">
          {draft.selection ? <><strong>Captured story: {draft.selection.title}</strong><span>{draft.selection.kind === 'evidence' ? 'Evidence' : 'WordPress'} · {draft.selection.language || 'Language not set'} · revision {draft.selection.revision ?? 'not reported'}</span></> : <span>No story attached. The task will use its instruction and authorized tools.</span>}
          <div className="actions">
            <button className="btn" type="button" disabled={!selection || startingProject === projectId} onClick={() => changeDraft({ selection: freezeAgentSelection(selection) })}>Use currently selected story</button>
            {draft.selection && <button className="btn" type="button" disabled={startingProject === projectId} onClick={() => changeDraft({ selection: undefined })}>Remove story</button>}
          </div>
          <small>Starting a task freezes this context. Changing the global story later will not redirect a running task.</small>
        </div>
        <fieldset disabled={!ready || startingProject === projectId}>
          <legend>Tools this task may use</legend>
          <p className="agent-inline-note">Read tools and local records are selected by default. External changes require your opt-in here and a separate approval for the prepared action.</p>
          <div className="agent-tool-list section-space">
            {tools.map(tool => <label className="agent-tool" key={tool.name}>
              <input type="checkbox" checked={chosenTools.includes(tool.name)} disabled={!['read', 'local-write', 'external-write'].includes(tool.effect)} onChange={event => {
                const checked = event.target.checked;
                changeDraft({ tools: checked ? [...new Set([...chosenTools, tool.name])] : chosenTools.filter(name => name !== tool.name) });
              }} />
              <span><strong>{toolLabel(tool.name)}</strong><Badge tone={tool.effect === 'external-write' ? 'warning' : 'neutral'}>{effectLabel(tool.effect)}</Badge><small>{tool.description}</small></span>
            </label>)}
          </div>
          {!tools.length && <p className="empty-inline">No executable tools reported by the runtime. Refresh the connection before starting.</p>}
          {tools.length > 0 && !chosenTools.length && <p className="agent-inline-note">Select at least one tool before starting this task.</p>}
        </fieldset>
        {draft.instruction.length > 20000 && <Notice kind="warning">Shorten this instruction to 20,000 characters before starting. The full transferred text is retained.</Notice>}
        <div className="actions"><button className="btn btn-primary" type="submit" disabled={!ready || !projectLoaded || !draft.instruction.trim() || draft.instruction.length > 20000 || !chosenTools.length || Boolean(startingProject)}>{startingProject === projectId ? 'Saving task…' : 'Start task'}</button><span className="agent-inline-note">Only checked tools can be used. A task may ask you for clarification.</span></div>
      </form>
      {startMessages[projectId] && <Notice kind={startMessages[projectId].error ? 'error' : 'info'}>{startMessages[projectId].text}{startMessages[projectId].error && <button className="btn" onClick={refreshLists}>Refresh task list</button>}</Notice>}
    </section>}
    {projectId && <div className="agent-grid">
      <section className="panel section-space" aria-labelledby="agent-runs-heading">
        <div className="panel-header"><h2 id="agent-runs-heading">Saved tasks</h2><RefreshButton onClick={refreshLists} busy={listBusy} /></div>
        {listError && <Notice kind="error">{listError} <button className="btn" onClick={refreshLists}>Retry</button></Notice>}
        <div className="record-list agent-run-list">
          {currentRuns.map(run => <button key={run.id} className={'record-button' + (selectedRunId === run.id ? ' active' : '')} aria-pressed={selectedRunId === run.id} onClick={() => setSelectedRuns(current => ({ ...current, [projectId]: run.id }))}>
            <strong>{run.instruction}</strong><Badge tone={statusTone(run.status)}>{statusLabel(run.status)}</Badge><span className="agent-inline-note">{formatTime(run.updatedAt)}</span>
          </button>)}
        </div>
        {!currentRuns.length && !listBusy && !listError && <p className="empty-inline">{runList.projectId === projectId && runList.loaded ? 'No saved tasks in this project.' : 'Task history has not been loaded.'}</p>}
        {listBusy && <p className="agent-inline-note" role="status">Loading saved tasks…</p>}
      </section>
      <div className="section-space">
        {selectedRunId && <div className="actions"><RefreshButton onClick={() => setRefresh(value => value + 1)} busy={detailBusy} /><span className="agent-inline-note">Active task status refreshes while this workspace is visible.</span></div>}
        {detailError && <Notice kind="error">{detailError} Showing the last recorded state, if available. <button className="btn" onClick={() => setRefresh(value => value + 1)}>Retry status</button></Notice>}
        {actionMessage?.scope === scope && <Notice kind={actionMessage.error ? 'error' : 'info'}>{actionMessage.text}</Notice>}
        {!selectedRun && <EmptyState title={selectedRunId ? 'Loading selected task' : 'Choose a saved task'}>{selectedRunId ? 'Its current state and receipts will appear here. If loading fails, retry the status request.' : 'Start a task or select one to inspect its plan, actions and retained outputs.'}</EmptyState>}
        {selectedRun && <>
          <section className="panel section-space" aria-labelledby="agent-task-heading">
            <div className="panel-header"><h2 id="agent-task-heading">Task progress</h2><Badge tone={statusTone(selectedRun.status)}>{statusLabel(selectedRun.status)}</Badge></div>
            <p className="agent-run-title">{selectedRun.instruction}</p>
            <div className="agent-receipt-meta"><span>Revision {selectedRun.revision}</span><span>Updated {formatTime(selectedRun.updatedAt)}</span><span>{selectedRun.steps.length} / {selectedRun.limits.maxSteps} recorded steps</span></div>
            {selectedRun.selection && <p className="agent-inline-note">Captured context: {selectedRun.selection.title} · revision {selectedRun.selection.revision ?? 'not reported'}</p>}
            {selectedRun.summary && <p className="prose">{selectedRun.summary}</p>}
            {(selectedRun.pauseRequested || selectedRun.cancelRequested) && <Notice kind="warning">{selectedRun.status === 'cancelled' ? 'This task was stopped. Actions already sent may have taken effect; inspect their receipts.' : selectedRun.status === 'paused' ? 'This task is paused. Inspect unresolved action receipts before continuing.' : selectedRun.cancelRequested ? 'Stop requested. Waiting for the current action to settle.' : 'Pause requested. Waiting for a safe checkpoint.'}</Notice>}
            <div className="actions">
              <button className="btn" disabled={!databaseReady || !agentCanPause(selectedRun) || Boolean(actionBusy)} onClick={() => void act('pause')}>Pause task</button>
              <button className="btn" disabled={!ready || !agentCanResume(selectedRun) || Boolean(actionBusy)} onClick={() => void act('resume')}>Resume task</button>
              <button className="btn btn-danger" disabled={!databaseReady || agentIsTerminal(selectedRun.status) || selectedRun.cancelRequested || Boolean(actionBusy)} onClick={() => void act('cancel')}>Stop task</button>
              {actionPending && <span className="agent-inline-note" role="status">Saving task control…</span>}
            </div>
            <p className="agent-inline-note">Pause and stop take effect at a safe checkpoint. They cannot undo an external action already sent.</p>
            {(selectedRun.status === 'paused' || selectedRun.status === 'waiting-input') && agentResumeIssue(selectedRun) && <p className="agent-inline-note">{agentResumeIssue(selectedRun)}</p>}
            {selectedRun.plan.length ? <ol className="agent-plan">{selectedRun.plan.map((step, index) => <li key={index}>{step}</li>)}</ol> : <p className="agent-inline-note">No plan has been recorded yet.</p>}
            {Boolean(selectedRun.directives?.length) && <details><summary>Recorded operator guidance ({selectedRun.directives!.length})</summary><div className="section-space">{selectedRun.directives!.map(directive => <div className="receipt" key={directive.id}><time className="agent-inline-note">{formatTime(directive.createdAt)}</time><pre className="code-text" tabIndex={0}>{directive.instruction}</pre></div>)}</div></details>}
          </section>
          {!agentIsTerminal(selectedRun.status) && <section className="panel section-space" aria-labelledby="agent-redirect-heading">
            <h2 id="agent-redirect-heading">{selectedRun.status === 'waiting-input' ? 'Answer the task' : 'Redirect the task'}</h2>
            {selectedRun.question && <Notice kind="warning">{selectedRun.question}</Notice>}
            <Field label="New guidance for this task" help="Up to 4,000 characters. This records new guidance. It does not add tool permissions or authorize a pending external action.">
              <textarea value={redirectDrafts[selectedRun.id] || ''} onChange={event => setRedirectDrafts(current => ({ ...current, [selectedRun.id]: event.target.value }))} maxLength={4000} />
            </Field>
            {(redirectDrafts[selectedRun.id] || '').length > 4000 && <Notice kind="warning">Shorten this saved guidance to 4,000 characters before sending. Its full text is retained.</Notice>}
            <div className="actions"><button className="btn" disabled={!ready || !(redirectDrafts[selectedRun.id] || '').trim() || (redirectDrafts[selectedRun.id] || '').length > 4000 || Boolean(actionBusy) || selectedRun.cancelRequested} onClick={() => void act('redirect')}>Send guidance</button></div>
          </section>}
          {pendingApproval && <section className="panel section-space agent-approval" aria-labelledby="agent-approval-heading">
            <h2 id="agent-approval-heading">Review exact action</h2>
            <p>{pendingApproval.summary}</p>
            <p className="agent-inline-note">Approval applies only to this prepared action, arguments and task revision. It does not authorize later actions.</p>
            <div className="agent-receipt-meta"><span>{approvalStep ? toolLabel(approvalStep.tool) : 'Missing prepared action'}</span><span>Effect: {effectLabel(approvalStep?.effect || '')}</span><span>Task revision: {selectedRun.revision}</span><span>Expires: {formatTime(pendingApproval.expiresAt)}</span></div>
            <ApprovalChanges run={selectedRun} step={approvalStep} />
            <details><summary>Recorded action details</summary><pre className="code-text" tabIndex={0}>{approvalStep ? showJson(approvalStep.arguments) : 'Prepared action not available.'}</pre></details>
            <details><summary>Approval identity and digest</summary><pre className="code-text" tabIndex={0}>{showJson({ approvalId: pendingApproval.id, stepId: pendingApproval.stepId, digest: pendingApproval.digest, expectedRevision: selectedRun.revision, expiresAt: pendingApproval.expiresAt })}</pre></details>
            {approvalIssue && <Notice kind="warning">{approvalIssue}</Notice>}
            {detailError && <Notice kind="warning">Refresh the task status successfully before approving this action.</Notice>}
            {!ready && <Notice kind="warning">Approval requires an available AI connection. You can still reject the action while the database is available.</Notice>}
            <label className="agent-review-check"><input type="checkbox" checked={reviewedApproval === approvalKey} disabled={Boolean(approvalIssue) || actionPending} onChange={event => setReviewedApproval(event.target.checked ? approvalKey : '')} /><span>I reviewed the destination, exact changes, revision and expiry above.</span></label>
            <div className="actions">
              <button className="btn btn-primary" disabled={!ready || Boolean(detailError) || Boolean(approvalIssue) || reviewedApproval !== approvalKey || Boolean(actionBusy)} onClick={() => void act('approve')}>Approve this action</button>
              <button className="btn btn-danger" disabled={!databaseReady || Boolean(actionBusy) || !['waiting-approval', 'paused'].includes(selectedRun.status)} onClick={() => void act('reject')}>Reject this action</button>
            </div>
          </section>}
          <section className="panel section-space" aria-labelledby="agent-receipts-heading">
            <h2 id="agent-receipts-heading">Action receipts</h2>
            {selectedRun.steps.length ? selectedRun.steps.map((step, index) => <details className="receipt" key={step.id}>
              <summary><Badge tone={step.status === 'succeeded' ? 'good' : step.status === 'failed' ? 'error' : step.status === 'uncertain' ? 'warning' : 'neutral'}>{step.status}</Badge> {index + 1}. {toolLabel(step.tool)}</summary>
              <p>{step.summary}</p><p>{effectLabel(step.effect)} · {formatTime(step.finishedAt || step.startedAt)}</p>
              {step.status === 'uncertain' && <Notice kind="warning">The outcome is uncertain. Inspect the destination before attempting the action again.</Notice>}
              <h3>Arguments</h3><pre className="code-text" tabIndex={0}>{showJson(step.arguments)}</pre>
              {step.result !== undefined && <><h3>Recorded result</h3><pre className="code-text" tabIndex={0}>{showJson(step.result)}</pre></>}
            </details>) : <p className="agent-inline-note">No tool actions have been recorded. A plan alone is not evidence of completed work.</p>}
          </section>
          <section className="panel section-space" aria-labelledby="agent-artifacts-heading">
            <h2 id="agent-artifacts-heading">Retained outputs</h2>
            {selectedRun.artifacts.length ? selectedRun.artifacts.map(artifact => {
              const target = agentArtifactSelection(artifact);
              return <div className="receipt section-space" key={artifact.id}><strong>{artifact.title}</strong><div className="agent-receipt-meta"><span>{artifact.kind}</span><span>{artifact.language || 'Language not reported'}</span><span>Revision {artifact.revision ?? 'not reported'}</span></div>
                <div className="actions"><button className="btn" disabled={!target} onClick={() => target && selectStory(target)}>Select output for review</button></div>
                {!target && <p className="agent-inline-note">This output has no supported record destination. Inspect its action receipt.</p>}
              </div>;
            }) : <p className="agent-inline-note">No retained outputs have been recorded.</p>}
            {selectedRun.artifacts.length > 0 && <p className="agent-inline-note">Selecting an output sets the story context. Use the selected-story controls to open its review workspace. Generated text still needs source and language review.</p>}
          </section>
          <section className="panel section-space" aria-labelledby="agent-events-heading">
            <h2 id="agent-events-heading">Recorded activity</h2>
            {events.length ? <ul className="agent-event-list">{events.map((event: AgentEvent) => <li key={event.id}><time>{formatTime(event.createdAt)} · revision {event.revision}</time>{event.message}</li>)}</ul> : <p className="agent-inline-note">No activity events loaded yet.</p>}
          </section>
        </>}
      </div>
    </div>}
  </div>;
}
