import { createHash } from 'node:crypto';
import { AgentError, type AgentRun, type AgentSelection, type AgentTool } from '../shared/agent-contracts';
import { EvidenceStore, type EvidenceItem } from './evidence';
import { validateTextPatches } from './agent-wordpress-patches';
import { validatePublicUrl } from './research';

type Source = { id: string; title: string; url: string; passage: string; sourceType: string; contentHash: string; capturedAt: string };
export type StudioAgentDependencies = {
  evidence: () => EvidenceStore;
  research: (query: string, signal: AbortSignal) => Promise<any[]>;
  capture?: (url: string, signal: AbortSignal) => Promise<any>;
  readWordPress: (selection: AgentSelection, signal: AbortSignal) => Promise<any>;
  editWordPress: (selection: AgentSelection, changes: Record<string, unknown>, signal: AbortSignal, expectedDestination?: string) => Promise<any>;
  draft: (record: EvidenceItem, language: string, signal: AbortSignal) => Promise<string>;
  production: (signal: AbortSignal) => Promise<unknown>;
};
const object = (input: unknown, keys: string[]) => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) throw new AgentError('Tool arguments contain unsupported fields.');
  return input as Record<string, unknown>;
};
const text = (input: unknown, name: string, max: number, empty = false) => {
  if (typeof input !== 'string' || input.length > max || (!empty && !input.trim())) throw new AgentError(`${name} must be text up to ${max} characters.`);
  return input.trim();
};
const ids = (input: unknown, name = 'sourceIds') => {
  if (!Array.isArray(input) || input.length > 100 || input.some(id => typeof id !== 'string' || id.length > 120)) throw new AgentError(`${name} must contain valid source identifiers.`);
  return [...new Set(input as string[])];
};
const schema = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const string = { type: 'string' };
const strings = { type: 'array', items: string };
function retainedSource(source: any): Source {
  const passage = String(source.passage ?? source.snippet ?? '').slice(0, 5000).trim();
  const contentHash = createHash('sha256').update(passage, 'utf8').digest('hex');
  return { id: createHash('sha256').update(String(source.url) + contentHash).digest('hex').slice(0, 24),
    title: String(source.title ?? source.url).slice(0, 1000), url: String(source.url), passage,
    sourceType: source.sourceType === 'public-page' ? 'public-page' : 'search-snippet', contentHash,
    capturedAt: source.capturedAt ?? new Date().toISOString() };
}
function retainedSources(run: AgentRun): Source[] {
  return run.steps.filter(step => step.status === 'succeeded' && ['research.search', 'research.capture'].includes(step.tool))
    .flatMap(step => ((step.result as any)?.data?.sources ?? (step.result as any)?.sources ?? [])).filter(source => source?.id && source?.url && typeof source.passage === 'string');
}
function ownedEvidence(run: AgentRun, id: string) {
  if (run.selection?.kind === 'evidence' && run.selection.id === id) return;
  if (run.artifacts.some(item => item.resourceId === id && item.kind !== 'wordpress')) return;
  throw new AgentError('This evidence record was not attached to this assignment.', 403, 'AGENT_SCOPE');
}
const live = (signal: AbortSignal) => { if (signal.aborted) throw new AgentError('Assignment was stopped.', 409, 'AGENT_CANCELLED'); };

export function createStudioAgentTools(dependencies: StudioAgentDependencies): AgentTool[] {
  return [
    { name: 'selection.read', description: 'Read only the attached article or evidence record. WordPress text is paged in 5000-character sections; section 0 is the start. Read relevant sections before proposing exact text patches.', effect: 'read', inputSchema: schema({ section: { type: 'integer', minimum: 0, maximum: 100 } }, []),
      validate(input) { const value = object(input, ['section']); const section = value.section ?? 0; if (!Number.isInteger(section) || Number(section) < 0 || Number(section) > 100) throw new AgentError('Choose a valid article section.'); return { section }; },
      async execute({ run, signal }, input) {
        live(signal);
        if (!run.selection) throw new AgentError('Attach an article or evidence record, or research a topic without this tool.');
        const data = run.selection.kind === 'evidence' ? dependencies.evidence().get(run.selection.id) : await dependencies.readWordPress(run.selection, signal);
        live(signal);
        if (run.selection.kind === 'wordpress') {
          const full = String(data.content ?? ''), section = Number(input.section ?? 0), offset = section * 5000;
          if (offset >= full.length && section > 0) throw new AgentError('That article section does not exist.');
          return { summary: `Read attached article section ${section + 1} with its current revision.`, data: { ...data, content: full.slice(offset, offset + 5000), contentTruncated: full.length > 5000,
            section, sectionCount: Math.max(1, Math.ceil(full.length / 5000)), contentOffset: offset, fullContentLength: full.length } };
        }
        return { summary: 'Read the attached record and its current revision.', data };
      } },
    { name: 'research.search', description: 'Search public sources and retain available passages. Search snippets are leads, not verified facts. Use returned source IDs when saving evidence.', effect: 'read', inputSchema: schema({ query: string }),
      validate(input) { const value = object(input, ['query']); return { query: text(value.query, 'query', 500) }; },
      async execute({ signal }, input) {
        live(signal);
        const found = await dependencies.research(String(input.query), signal); live(signal);
        const sources = found.slice(0, 3).map(retainedSource);
        return { summary: `Retained ${sources.length} public research sources; editorial verification remains required.`, data: { query: input.query, sources } };
      } },
    ...(dependencies.capture ? [{ name: 'research.capture', description: 'Read and retain a public HTTP(S) source URL directly. Only a successful public-page capture can become evidence. Use supplied or discovered primary URLs when search is unavailable; never invent facts from an inaccessible URL.', effect: 'read' as const,
      inputSchema: schema({ url: string }),
      validate(input: unknown) { const value = object(input, ['url']); return { url: validatePublicUrl(text(value.url, 'url', 4000)).toString() }; },
      async execute({ signal }: { signal: AbortSignal }, input: Record<string, unknown>) {
        live(signal); const source = await dependencies.capture!(String(input.url), signal); live(signal);
        if (source?.sourceType !== 'public-page' || !source.passage?.trim()) throw new AgentError('This public page could not be retained. Try another accessible primary source or ask for a document.', 502, 'AGENT_SOURCE_UNAVAILABLE');
        const retained = retainedSource(source);
        return { summary: 'Retained a public source passage; its claims still require editorial verification.', data: { sources: [retained] } };
      } }] : []),
    { name: 'evidence.save', description: 'Save a local draft evidence record using source IDs actually returned by research in this assignment. Claims remain unverified. This does not publish.', effect: 'local-write',
      inputSchema: schema({ title: string, summary: string, language: { type: 'string', enum: ['hy', 'en', 'ru'] }, sourceIds: strings, claims: { type: 'array', items: schema({ text: string, sourceIds: strings }) } }),
      validate(input) {
        const value = object(input, ['title', 'summary', 'language', 'sourceIds', 'claims']);
        if (!['hy', 'en', 'ru'].includes(String(value.language))) throw new AgentError('Choose HY, EN or RU for the evidence record.');
        if (!Array.isArray(value.claims) || value.claims.length > 60) throw new AgentError('Provide at most 60 claims.');
        const claims = value.claims.map(claim => { const row = object(claim, ['text', 'sourceIds']); return { text: text(row.text, 'claim', 5000), sourceIds: ids(row.sourceIds) }; });
        return { title: text(value.title, 'title', 500), summary: text(value.summary, 'summary', 20_000, true), language: value.language, sourceIds: ids(value.sourceIds), claims };
      },
      async execute({ run, signal }, input) {
        live(signal);
        const known = new Map(retainedSources(run).map(source => [source.id, source]));
        const selected = (input.sourceIds as string[]).map(id => { const source = known.get(id); if (!source) throw new AgentError('A source was not retained by this assignment.', 403, 'AGENT_SCOPE'); return source; });
        if (!selected.length) throw new AgentError('Retain research sources before saving evidence.');
        const selectedIds = new Set(selected.map(source => source.id));
        const claims = (input.claims as any[]).map(claim => {
          if (claim.sourceIds.some((id: string) => !selectedIds.has(id))) throw new AgentError('A claim references an unattached source.');
          return { ...claim, status: 'unverified' };
        });
        const record = dependencies.evidence().create({ title: input.title, summary: input.summary, language: input.language, status: 'draft',
          sources: selected.map(source => ({ id: source.id, title: `${source.title}${source.sourceType === 'search-snippet' ? ' [search lead only]' : ''}`, url: source.url, excerpt: source.passage })), claims });
        return { summary: 'Saved a source-linked evidence draft; no claims were automatically verified.', data: record,
          artifacts: [{ id: record.id, kind: 'evidence', title: record.title, resourceId: record.id, revision: record.revision, language: record.language }] };
      } },
    { name: 'evidence.draft', description: 'Prepare and retain a HY, EN or RU article draft from an attached evidence record. Output needs human factual and language review.', effect: 'local-write', inputSchema: schema({ recordId: string, language: { type: 'string', enum: ['hy', 'en', 'ru'] } }),
      validate(input) { const value = object(input, ['recordId', 'language']); if (!['hy', 'en', 'ru'].includes(String(value.language))) throw new AgentError('Choose HY, EN or RU.'); return { recordId: text(value.recordId, 'recordId', 100), language: value.language }; },
      async execute({ run, signal }, input) {
        live(signal);
        ownedEvidence(run, String(input.recordId));
        const record = dependencies.evidence().get(String(input.recordId));
        if (!record.sources.length || !record.claims.length) throw new AgentError('The record needs source-linked claims before drafting.');
        const result = await dependencies.draft(record, String(input.language), signal); live(signal);
        const next = dependencies.evidence().update(record.id, { expectedRevision: record.revision, format: 'article', language: input.language, text: result }, 'output');
        const output = next.outputs.at(-1)!;
        return { summary: `Saved a ${input.language} draft requiring editorial review.`, data: { recordId: next.id, revision: next.revision, output, languageParity: 'not-verified' },
          artifacts: [{ id: output.id, kind: 'draft', title: `${next.title} · ${input.language}`, resourceId: next.id, revision: next.revision, language: String(input.language) }] };
      } },
    { name: 'wordpress.edit', description: 'Save an exact editor-approved title/content/excerpt change to the attached WordPress article only. Requires a fresh revision, exact approval and confirmed readback; cannot change publication status.', effect: 'external-write',
      inputSchema: schema({ expectedRevision: string, title: string, content: string, excerpt: string, patches: { type: 'array', items: schema({ before: string, after: string }) } }, ['expectedRevision']),
      validate(input) {
        const value = object(input, ['expectedRevision', 'title', 'content', 'excerpt', 'patches']);
        const changes: Record<string, unknown> = { expectedRevision: text(value.expectedRevision, 'expectedRevision', 200) };
        for (const field of ['title', 'content', 'excerpt']) if (value[field] !== undefined) changes[field] = text(value[field], field, field === 'content' ? 100_000 : field === 'title' ? 500 : 10_000, true);
        for (const field of ['title', 'excerpt']) if (typeof changes[field] === 'string' && /[<>]/.test(changes[field] as string)) throw new AgentError('Agent titles and excerpts must be plain text.');
        if (typeof changes.content === 'string' && /<\s*(?:script|style|iframe|object|embed|link|base|meta)\b|\bon[a-z]+\s*=|(?:javascript|vbscript|data)\s*:/i.test(changes.content)) throw new AgentError('Active markup is not supported in agent article replacements. Use Article review for that change.');
        if (value.patches !== undefined) changes.patches = validateTextPatches(value.patches);
        if (changes.patches && changes.content !== undefined) throw new AgentError('Choose exact text patches or a complete replacement, not both.');
        if (Object.keys(changes).length < 2) throw new AgentError('Prepare at least one article change.');
        return changes;
      },
      async execute({ run, signal }, input) {
        if (run.selection?.kind !== 'wordpress') throw new AgentError('Only the WordPress article attached to this assignment can be edited.', 403, 'AGENT_SCOPE');
        const read = run.steps.filter(step => step.tool === 'selection.read' && step.status === 'succeeded').at(-1);
        if (!read) throw new AgentError('Read the attached article before preparing an edit.');
        const retained = (read.result as any)?.data ?? read.result;
        if (input.content !== undefined && retained?.contentTruncated) throw new AgentError('The article exceeds this agent’s retained full-text limit. Prepare a draft or use Article review for the complete edit.');
        if (input.patches) {
          const passages = run.steps.filter(step => step.tool === 'selection.read' && step.status === 'succeeded')
            .map(step => (step.result as any)?.data ?? step.result).filter(data => data?.revision === input.expectedRevision);
          if ((input.patches as { before: string }[]).some(patch => !passages.some(data => typeof data.content === 'string' && data.content.includes(patch.before)))) throw new AgentError('Read the exact current article passage before proposing a text patch.', 403, 'AGENT_SCOPE');
        }
        live(signal);
        const result = await dependencies.editWordPress(run.selection, input, signal, retained?.destinationBaseUrl);
        if (result?.ok !== true || result.receipt?.provider !== 'wordpress' || String(result.post?.id) !== run.selection.id ||
          String(result.receipt?.postId) !== run.selection.id || typeof result.post?.revision !== 'string' || !result.post.revision ||
          result.post.revision !== result.receipt?.revision || result.siteId !== run.selection.siteId ||
          ['title', 'content', 'excerpt'].some(field => input[field] !== undefined && result.post[field] !== input[field])) {
          throw new AgentError('The remote edit has no verified readback.', 409, 'AGENT_UNCERTAIN');
        }
        return { summary: 'WordPress returned the approved content and a verified current revision.', data: result,
          artifacts: [{ id: `wp-${result.post.id}-${result.post.revision}`, kind: 'wordpress', title: result.post.title, resourceId: String(result.post.id), siteId: run.selection.siteId, revision: result.post.revision }] };
      } },
    { name: 'production.observe', description: 'Read current Expert and Smart observations. Cannot start/stop jobs or claim publication from worker counts.', effect: 'read', inputSchema: schema({}), validate(input) { return object(input, []); },
      async execute({ signal }) { live(signal); const data = await dependencies.production(signal); live(signal); return { summary: 'Read current worker observations; these are not publication receipts.', data }; } },
  ];
}
