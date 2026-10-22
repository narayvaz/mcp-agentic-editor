import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { AgentError, type AgentRun, type AgentTool, type AgentToolContext } from '../shared/agent-contracts.ts';
import { createStudioAgentTools, type StudioAgentDependencies } from '../server/agent-tools.ts';
import { EvidenceStore } from '../server/evidence.ts';

const fixtureRun = (patch: Partial<AgentRun> = {}): AgentRun => ({ id: randomUUID(), projectId: randomUUID(), threadId: 'test-thread', instruction: 'Prepare evidence and review the selected article.',
  allowedTools: ['selection.read', 'research.search', 'evidence.save', 'evidence.draft', 'wordpress.edit', 'production.observe'], policyVersion: 1, workflowVersion: 1,
  status: 'running', revision: 1, plan: [], steps: [], artifacts: [], summary: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  limits: { maxSteps: 20, maxActiveMs: 900_000 }, activeMs: 0, cancelRequested: false, pauseRequested: false, fence: 1, ...patch });
const context = (run = fixtureRun(), signal = new AbortController().signal): AgentToolContext => ({ run, signal, actionId: randomUUID() });
const scoped = (issue: unknown) => issue instanceof AgentError && issue.code === 'AGENT_SCOPE';
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'azat-agent-tools-'));
  const evidence = new EvidenceStore(path.join(directory, 'evidence.json'));
  const calls = { research: 0, read: 0, edit: 0, draft: 0, production: 0 };
  const post = { id: 42, title: 'Reviewed article', content: '<p>Confirmed text</p>', excerpt: 'Confirmed summary', status: 'draft', revision: 'after-revision' };
  const dependencies: StudioAgentDependencies = {
    evidence: () => evidence,
    research: async () => { calls.research++; return [{ title: 'Primary report', url: 'https://example.org/report', passage: 'Exact retained passage from the research adapter.', snippet: 'A shorter search lead.', contentHash: 'fixture-hash', sourceType: 'page', capturedAt: '2026-10-22T12:00:00.000Z' }]; },
    readWordPress: async () => { calls.read++; return { ...post, siteId: 'azat-en', revision: 'before-revision', destinationBaseUrl: 'https://example.org' }; },
    editWordPress: async () => { calls.edit++; return { ok: true, siteId: 'azat-en', post, receipt: { provider: 'wordpress', postId: 42, revision: post.revision, observedAt: new Date().toISOString() } }; },
    draft: async () => { calls.draft++; return 'Retained article draft requiring editorial verification.'; },
    production: async () => { calls.production++; return { observation: 'available', runningWorkers: 1 }; },
  };
  const tools = () => createStudioAgentTools(dependencies);
  const tool = (name: string): AgentTool => tools().find(item => item.name === name)!;
  return { evidence, dependencies, calls, post, tool, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
const selection = { kind: 'wordpress' as const, id: '42', siteId: 'azat-en', title: 'Selected article', revision: 'before-revision' };
const wordpressRun = () => fixtureRun({ selection, steps: [{ id: 'selected-read', tool: 'selection.read', arguments: {}, effect: 'read', status: 'succeeded', summary: 'Read selected article.' }] });
const evidenceInput = (sourceId: string) => ({ title: 'Evidence brief', summary: 'Editorial notes.', language: 'en', sourceIds: [sourceId], claims: [{ text: 'A reported claim requiring verification.', sourceIds: [sourceId] }] });
async function researchedRun(tool: AgentTool) {
  const run = fixtureRun(), receipt = await tool.execute(context(run), tool.validate({ query: 'A specific public report' }));
  run.steps.push({ id: 'research-receipt', tool: 'research.search', arguments: { query: 'A specific public report' }, effect: 'read', status: 'succeeded', summary: receipt.summary, result: { data: receipt.data } });
  return { run, source: (receipt.data as any).sources[0] };
}

test('tools reject extra arguments, arbitrary selection identifiers, publication status and source URLs', () => {
  const f = fixture();
  try {
    for (const [name, args] of [
      ['selection.read', { postId: '99' }], ['production.observe', { command: 'start' }],
      ['research.search', { query: 'Report', url: 'http://127.0.0.1/admin' }],
      ['evidence.save', { ...evidenceInput('source'), sources: [{ url: 'http://169.254.169.254/' }] }],
      ['evidence.draft', { recordId: 'other', language: 'en', projectId: 'other-project' }],
      ['wordpress.edit', { expectedRevision: 'before', title: 'Change', status: 'publish' }],
      ['wordpress.edit', { expectedRevision: 'before', title: 'Change', postId: 99 }],
      ['wordpress.edit', { expectedRevision: 'before' }],
    ] as [string, unknown][]) assert.throws(() => f.tool(name).validate(args), AgentError);
  } finally { f.cleanup(); }
});

test('evidence retains only successful tool sources and cannot fabricate references or excerpts', async () => {
  const f = fixture();
  try {
    const { run, source } = await researchedRun(f.tool('research.search'));
    const save = f.tool('evidence.save');
    await assert.rejects(save.execute(context(run), save.validate(evidenceInput('fabricated-source'))), scoped);
    await assert.rejects(save.execute(context(run), save.validate(evidenceInput('http://127.0.0.1/private'))), scoped);
    const badClaim = { ...evidenceInput(source.id), claims: [{ text: 'Invented citation', sourceIds: ['not-attached'] }] };
    await assert.rejects(save.execute(context(run), save.validate(badClaim)), AgentError);
    assert.equal(f.evidence.list().length, 0);
    const result = await save.execute(context(run), save.validate(evidenceInput(source.id)));
    const record = f.evidence.get((result.data as any).id);
    assert.equal(record.sources[0].excerpt, 'Exact retained passage from the research adapter.');
    assert.equal(record.sources[0].url, 'https://example.org/report');
    assert.equal(record.claims[0].status, 'unverified'); assert.equal(record.status, 'draft');
    assert.equal(result.artifacts?.[0].resourceId, record.id);
    const failedResearch = structuredClone(run); failedResearch.steps[0].status = 'failed';
    await assert.rejects(save.execute(context(failedResearch), save.validate(evidenceInput(source.id))), scoped);
    const otherProject = fixtureRun({ projectId: randomUUID() });
    await assert.rejects(save.execute(context(otherProject), save.validate(evidenceInput(source.id))), scoped);
  } finally { f.cleanup(); }
});

test('direct source capture rejects private URLs and unavailable pages, retaining only the exact hashed passage', async () => {
  const f = fixture();
  try {
    let calls = 0, available = true;
    const passage = 'Հայերեն Русский English '.repeat(400);
    f.dependencies.capture = async url => { calls++; return { title: 'Primary document', url, sourceType: available ? 'public-page' : 'search-snippet', passage, contentHash: 'not-the-retained-hash' }; };
    const tool = f.tool('research.capture');
    for (const url of ['http://127.0.0.1/private', 'http://169.254.169.254/', 'file:///private/data', 'https://name:password@example.org/']) assert.throws(() => tool.validate({ url }));
    assert.equal(calls, 0);
    const run = fixtureRun(), receipt = await tool.execute(context(run), tool.validate({ url: 'https://example.org/report#section' }));
    const source = (receipt.data as any).sources[0];
    assert.equal(source.url, 'https://example.org/report'); assert.equal(source.passage, passage.slice(0, 5000).trim());
    assert.equal(source.contentHash, createHash('sha256').update(source.passage, 'utf8').digest('hex'));
    run.steps.push({ id: 'capture', tool: tool.name, effect: 'read', status: 'succeeded', summary: receipt.summary, arguments: {}, result: { data: receipt.data } });
    const save = f.tool('evidence.save');
    const saved = await save.execute(context(run), save.validate(evidenceInput(source.id)));
    assert.equal((saved.data as any).sources[0].excerpt, source.passage);
    available = false;
    await assert.rejects(tool.execute(context(), tool.validate({ url: 'https://example.org/unavailable' })), (issue: unknown) => issue instanceof AgentError && issue.code === 'AGENT_SOURCE_UNAVAILABLE');
    assert.equal(f.evidence.list().length, 1);
  } finally { f.cleanup(); }
});

test('model claims cannot assign verified status, including when execute receives an extra claim property', async () => {
  const f = fixture();
  try {
    const { run, source } = await researchedRun(f.tool('research.search')), save = f.tool('evidence.save');
    const raw = { ...evidenceInput(source.id), claims: [{ text: 'Model assertion', sourceIds: [source.id], status: 'supported' }] };
    assert.throws(() => save.validate(raw), AgentError);
    const result = await save.execute(context(run), raw);
    assert.equal(f.evidence.get((result.data as any).id).claims[0].status, 'unverified');
  } finally { f.cleanup(); }
});

test('drafting requires evidence attached to this assignment and retains review metadata', async () => {
  const f = fixture();
  try {
    const { run, source } = await researchedRun(f.tool('research.search'));
    const saved = await f.tool('evidence.save').execute(context(run), evidenceInput(source.id));
    const recordId = (saved.data as any).id, draft = f.tool('evidence.draft'), args = draft.validate({ recordId, language: 'hy' });
    await assert.rejects(draft.execute(context(fixtureRun()), args), scoped); assert.equal(f.calls.draft, 0);
    run.artifacts.push(...saved.artifacts!);
    const output = await draft.execute(context(run), args);
    assert.equal(f.calls.draft, 1); assert.equal((output.data as any).languageParity, 'not-verified');
    const record = f.evidence.get(recordId);
    assert.equal(record.outputs.length, 1); assert.equal(record.outputs[0].language, 'hy');
    assert.equal(record.outputs[0].verification, 'editor-review-required'); assert.equal(record.outputs[0].text, 'Retained article draft requiring editorial verification.');
    const attached = fixtureRun({ selection: { kind: 'evidence', id: recordId, title: record.title } });
    await draft.execute(context(attached), draft.validate({ recordId, language: 'ru' }));
    assert.equal(f.evidence.get(recordId).outputs.length, 2);
  } finally { f.cleanup(); }
});

test('selected reads and WordPress changes use only the assigned article', async () => {
  const f = fixture();
  try {
    let observedSelection: unknown, observedChanges: unknown;
    const original = f.dependencies.editWordPress;
    f.dependencies.editWordPress = async (selected, changes, signal) => { observedSelection = selected; observedChanges = changes; return original(selected, changes, signal); };
    const run = wordpressRun(), read = f.tool('selection.read');
    assert.throws(() => read.validate({ id: '99' }), AgentError);
    const selectedRead = await read.execute(context(run), read.validate({})); assert.equal((selectedRead.data as any).id, 42);
    const edit = f.tool('wordpress.edit'), args = edit.validate({ expectedRevision: 'before-revision', title: f.post.title, content: f.post.content });
    const result = await edit.execute(context(run), args);
    assert.deepEqual(observedSelection, selection); assert.deepEqual(observedChanges, args);
    assert.equal(result.artifacts?.[0].resourceId, '42'); assert.equal(result.artifacts?.[0].siteId, 'azat-en');
    await assert.rejects(edit.execute(context(fixtureRun()), args), scoped);
    await assert.rejects(edit.execute(context(fixtureRun({ selection })), args), AgentError);
    assert.equal(f.calls.edit, 1);
  } finally { f.cleanup(); }
});

test('long article corrections require the exact retained page at the current revision', async () => {
  const f = fixture();
  try {
    const before = 'Երեվանը', after = 'Երևանը';
    const original = `<p>${'ա'.repeat(5500)}${before} Հայաստանի մայրաքաղաքն է։${'բ'.repeat(5200)}</p><p>Сохранённый конец статьи.</p>`;
    const expected = original.replace(before, after), destination = 'https://example.org';
    f.dependencies.readWordPress = async () => ({ ...f.post, content: original, revision: 'before-revision', siteId: 'azat-en', destinationBaseUrl: destination });
    let submitted: Record<string, unknown> | undefined, submittedDestination: string | undefined;
    f.dependencies.editWordPress = async (selected, changes, _signal, expectedDestination) => {
      f.calls.edit++; assert.deepEqual(selected, selection); submitted = changes; submittedDestination = expectedDestination;
      return { ok: true, siteId: 'azat-en', post: { ...f.post, content: expected }, receipt: { provider: 'wordpress', postId: 42, revision: f.post.revision } };
    };
    const run = fixtureRun({ selection }), read = f.tool('selection.read'), edit = f.tool('wordpress.edit');
    for (const section of [-1, 0.5, 101]) assert.throws(() => read.validate({ section }), AgentError);
    const first = await read.execute(context(run), read.validate({}));
    const firstData = first.data as any;
    assert.equal(firstData.content, original.slice(0, 5000)); assert.equal(firstData.contentTruncated, true); assert.equal(firstData.contentOffset, 0);
    run.steps.push({ id: 'page-0', tool: 'selection.read', arguments: { section: 0 }, effect: 'read', status: 'succeeded', summary: first.summary, result: { data: first.data } });
    const args = edit.validate({ expectedRevision: 'before-revision', patches: [{ before, after }] });
    await assert.rejects(edit.execute(context(run), args), scoped); assert.equal(f.calls.edit, 0);
    const second = await read.execute(context(run), read.validate({ section: 1 }));
    const secondData = second.data as any;
    assert.equal(secondData.content, original.slice(5000, 10_000)); assert.equal(secondData.content.length, 5000);
    assert.equal(secondData.section, 1); assert.equal(secondData.contentOffset, 5000); assert.equal(secondData.fullContentLength, original.length);
    assert.equal(secondData.sectionCount, 3); assert.equal(secondData.contentTruncated, true); assert.ok(secondData.content.includes(before));
    run.steps.push({ id: 'page-1', tool: 'selection.read', arguments: { section: 1 }, effect: 'read', status: 'succeeded', summary: second.summary, result: { data: second.data } });
    const stale = structuredClone(run); (stale.steps[1].result as any).data.revision = 'stale-revision';
    await assert.rejects(edit.execute(context(stale), args), scoped); assert.equal(f.calls.edit, 0);
    await assert.rejects(edit.execute(context(run), edit.validate({ expectedRevision: 'before-revision', content: secondData.content })), AgentError);
    assert.throws(() => edit.validate({ expectedRevision: 'before-revision', content: original, patches: [{ before, after }] }), AgentError);
    const result = await edit.execute(context(run), args);
    assert.equal(f.calls.edit, 1); assert.deepEqual(submitted, args); assert.equal(submitted?.content, undefined); assert.equal(submittedDestination, destination);
    assert.equal((result.data as any).post.content, expected); assert.ok((result.data as any).post.content.endsWith('</p><p>Сохранённый конец статьи.</p>'));
    assert.equal(result.artifacts?.[0].resourceId, '42');
    await assert.rejects(read.execute(context(run), read.validate({ section: 99 })), AgentError);
  } finally { f.cleanup(); }
});

test('WordPress success requires a receipt for the selected post and a concrete matching revision', async () => {
  const f = fixture();
  try {
    const variants = [
      { ok: true, siteId: 'azat-en', post: f.post },
      { ok: true, siteId: 'azat-en', post: f.post, receipt: { provider: 'wordpress', postId: 42, revision: 'different' } },
      { ok: true, siteId: 'azat-en', post: { id: 42, title: 'No revision' }, receipt: {} },
      { ok: true, siteId: 'azat-en', post: { ...f.post, id: 99 }, receipt: { provider: 'wordpress', postId: 99, revision: f.post.revision } },
      { ok: true, siteId: 'wrong-site', post: f.post, receipt: { provider: 'wordpress', postId: 42, revision: f.post.revision } },
    ];
    for (const response of variants) {
      f.dependencies.editWordPress = async () => response;
      const edit = f.tool('wordpress.edit');
      await assert.rejects(edit.execute(context(wordpressRun()), edit.validate({ expectedRevision: 'before-revision', title: f.post.title })), issue => issue instanceof AgentError && issue.code === 'AGENT_UNCERTAIN');
    }
  } finally { f.cleanup(); }
});

test('cancellation prevents evidence and WordPress writes, including cancellation during drafting', async () => {
  const f = fixture();
  try {
    const { run, source } = await researchedRun(f.tool('research.search')), abort = new AbortController(); abort.abort();
    await assert.rejects(f.tool('evidence.save').execute(context(run, abort.signal), evidenceInput(source.id)), AgentError);
    assert.equal(f.evidence.list().length, 0);
    const edit = f.tool('wordpress.edit');
    await assert.rejects(edit.execute(context(wordpressRun(), abort.signal), edit.validate({ expectedRevision: 'before-revision', title: f.post.title })), AgentError);
    assert.equal(f.calls.edit, 0);
    const saved = await f.tool('evidence.save').execute(context(run), evidenceInput(source.id));
    run.artifacts.push(...saved.artifacts!); const recordId = (saved.data as any).id;
    const during = new AbortController(); f.dependencies.draft = async () => { during.abort(); return 'Late draft'; };
    await assert.rejects(f.tool('evidence.draft').execute(context(run, during.signal), { recordId, language: 'en' }), AgentError);
    assert.equal(f.evidence.get(recordId).outputs.length, 0);
  } finally { f.cleanup(); }
});
