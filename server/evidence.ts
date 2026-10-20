import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Express } from 'express';

export type EvidenceSource = { id: string; title: string; url: string; excerpt: string; retrievedAt: string; contentHash: string };
export type EvidenceClaim = { id: string; text: string; status: 'supported' | 'disputed' | 'unverified'; sourceIds: string[] };
export type EvidenceOutput = { id: string; format: 'brief' | 'article' | 'script'; language: string; text: string; evidenceRevision: number; createdAt: string; status: 'current' | 'needs-review'; claimIds: string[]; verification: 'editor-review-required' };
export type EvidenceSnapshot = { title: string; summary: string; language: string; status: 'draft' | 'reviewed' | 'corrected'; sources: EvidenceSource[]; claims: EvidenceClaim[]; outputs: EvidenceOutput[] };
export type EvidenceChange = { id: string; revision: number; kind: 'created' | 'updated' | 'correction' | 'output'; reason: string; timestamp: string; snapshot: EvidenceSnapshot };
export type EvidenceItem = EvidenceSnapshot & { id: string; revision: number; evidenceRevision: number; createdAt: string; updatedAt: string; revisions: EvidenceChange[] };

export class EvidenceError extends Error {
  constructor(message: string, public status = 400, public current?: EvidenceItem) { super(message); }
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const copy = <T>(value: T): T => structuredClone(value);
const text = (value: unknown, max: number, name: string, required = false): string => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new EvidenceError(`${name} must be ${required ? 'non-empty ' : ''}text up to ${max} characters.`);
  return value.trim();
};

function validateSnapshot(input: any, previous?: EvidenceItem): EvidenceSnapshot {
  const title = text(input.title ?? previous?.title, 500, 'title', true);
  const summary = text(input.summary ?? previous?.summary ?? '', 30_000, 'summary');
  const language = text(input.language ?? previous?.language ?? 'hy', 30, 'language', true);
  const status = input.status ?? previous?.status ?? 'draft';
  if (!['draft', 'reviewed', 'corrected'].includes(status)) throw new EvidenceError('Unknown local record status.');
  const rawSources = input.sources ?? previous?.sources ?? [];
  if (!Array.isArray(rawSources) || rawSources.length > 100) throw new EvidenceError('sources must be an array of at most 100 records.');
  const sources: EvidenceSource[] = rawSources.map((source: any) => {
    const url = text(source.url, 4000, 'source.url', true);
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new EvidenceError('Source URL must be a valid http or https URL.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new EvidenceError('Source URL must be http or https without credentials.');
    const excerpt = text(source.excerpt ?? '', 50_000, 'source.excerpt');
    const id = typeof source.id === 'string' ? text(source.id, 100, 'source.id', true) : randomUUID();
    const old = previous?.sources.find(item => item.id === id);
    return { id, title: text(source.title ?? url, 1000, 'source.title', true), url, excerpt,
      retrievedAt: old && old.excerpt === excerpt && old.url === url ? old.retrievedAt : new Date().toISOString(),
      contentHash: hash(excerpt) };
  });
  const sourceIds = new Set(sources.map(source => source.id));
  if (sourceIds.size !== sources.length) throw new EvidenceError('Source IDs must be unique.');
  const rawClaims = input.claims ?? previous?.claims ?? [];
  if (!Array.isArray(rawClaims) || rawClaims.length > 200) throw new EvidenceError('claims must be an array of at most 200 records.');
  const claims: EvidenceClaim[] = rawClaims.map((claim: any) => {
    const status = claim.status ?? 'unverified';
    if (!['supported', 'disputed', 'unverified'].includes(status)) throw new EvidenceError('Unknown claim status.');
    if (!Array.isArray(claim.sourceIds ?? []) || !(claim.sourceIds ?? []).every((id: unknown) => typeof id === 'string' && sourceIds.has(id))) throw new EvidenceError('Every claim sourceId must refer to a source in this record.');
    const refs = [...new Set<string>(claim.sourceIds ?? [])];
    if (status === 'supported' && !refs.length) throw new EvidenceError('A supported claim needs at least one source reference.');
    return { id: typeof claim.id === 'string' ? text(claim.id, 100, 'claim.id', true) : randomUUID(), text: text(claim.text, 10_000, 'claim.text', true), status, sourceIds: refs };
  });
  if (new Set(claims.map(claim => claim.id)).size !== claims.length) throw new EvidenceError('Claim IDs must be unique.');
  return { title, summary, language, status, sources, claims, outputs: copy(previous?.outputs ?? []) };
}

/** Local records are editorial evidence, never a claim that something was published or verified automatically. */
export function renderEvidenceBrief(item: EvidenceItem): string {
  const parts = [`# ${item.title}`, `Local evidence brief · ${item.language} · revision ${item.revision}`, item.summary];
  for (const claim of item.claims) {
    const refs = claim.sourceIds.map(id => item.sources.find(source => source.id === id)).filter((source): source is EvidenceSource => Boolean(source));
    parts.push(`- [${claim.status}; editor assessment] ${claim.text}${refs.length ? ` (${refs.map(source => source.url).join(', ')})` : ''}`);
  }
  if (item.sources.length) parts.push('Sources', ...item.sources.map(source => `- ${source.title}: ${source.url}${source.excerpt ? `\n  Retained excerpt: ${source.excerpt}` : ''}`));
  parts.push('This local brief has not been published. Source links and retained excerpts do not independently establish that a claim is true.');
  return parts.filter(Boolean).join('\n\n');
}

export class EvidenceStore {
  constructor(private filePath: string) {}
  private read(): EvidenceItem[] {
    if (!fs.existsSync(this.filePath)) return [];
    const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    if (data.schemaVersion !== 1 || !Array.isArray(data.items)) throw new EvidenceError('Evidence store is unreadable; it has not been replaced.', 503);
    return data.items;
  }
  private write(items: EvidenceItem[]) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temp = `${this.filePath}.${randomUUID()}.tmp`;
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify({ schemaVersion: 1, items }, null, 2)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    try { fs.renameSync(temp, this.filePath); } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  list(): EvidenceItem[] { return copy(this.read()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  get(id: string): EvidenceItem {
    const item = this.read().find(item => item.id === id);
    if (!item) throw new EvidenceError('Evidence record not found.', 404);
    return copy(item);
  }
  create(input: unknown): EvidenceItem {
    const snapshot = validateSnapshot(input);
    const timestamp = new Date().toISOString();
    const item: EvidenceItem = { ...snapshot, id: randomUUID(), revision: 1, evidenceRevision: 1, createdAt: timestamp, updatedAt: timestamp,
      revisions: [{ id: randomUUID(), revision: 1, kind: 'created', reason: 'Local question and evidence record created.', timestamp, snapshot: copy(snapshot) }] };
    const items = this.read();
    items.push(item); this.write(items); return copy(item);
  }
  update(id: string, input: any, kind: 'updated' | 'correction' | 'output' = 'updated'): EvidenceItem {
    const items = this.read();
    const index = items.findIndex(item => item.id === id);
    if (index < 0) throw new EvidenceError('Evidence record not found.', 404);
    const current = items[index];
    if (!Number.isInteger(input.expectedRevision)) throw new EvidenceError('expectedRevision is required.', 428);
    if (input.expectedRevision !== current.revision) throw new EvidenceError('This record changed. Review the current revision before saving.', 409, current);
    const reason = kind === 'correction' ? text(input.reason, 5000, 'Correction reason', true) : text(input.reason ?? (kind === 'output' ? 'Local output retained.' : 'Editorial record updated.'), 5000, 'reason', true);
    // Output metadata describes a dependent draft, not a change to its source record.
    const snapshot = validateSnapshot(kind === 'output' ? current : input, current);
    const evidenceRevision = kind === 'output' ? current.evidenceRevision || current.revision : (current.evidenceRevision || current.revision) + 1;
    if (kind !== 'output') snapshot.outputs = snapshot.outputs.map(output => ({ ...output, status: 'needs-review' }));
    if (kind === 'correction') snapshot.status = 'corrected';
    if (kind === 'output') {
      const format = input.format ?? 'brief';
      if (!['brief', 'article', 'script'].includes(format)) throw new EvidenceError('Unknown output format.');
      const outputText = input.text === undefined ? renderEvidenceBrief(current) : text(input.text, 100_000, 'output text', true);
      snapshot.outputs.push({ id: randomUUID(), format, language: text(input.language ?? current.language, 30, 'language', true), text: outputText, evidenceRevision, createdAt: new Date().toISOString(), status: 'current', claimIds: current.claims.map(claim => claim.id), verification: 'editor-review-required' });
    }
    const timestamp = new Date().toISOString();
    const next: EvidenceItem = { ...snapshot, id: current.id, revision: current.revision + 1, evidenceRevision, createdAt: current.createdAt, updatedAt: timestamp,
      revisions: [...current.revisions, { id: randomUUID(), revision: current.revision + 1, kind, reason, timestamp, snapshot: copy(snapshot) }] };
    items[index] = next; this.write(items); return copy(next);
  }
}

export function registerEvidenceRoutes(app: Express, dataDirectory: () => string, options?: { generateOutput: (item: EvidenceItem, format: string, language: string) => Promise<string> }) {
  const store = () => new EvidenceStore(path.join(dataDirectory(), 'evidence.json'));
  const error = (res: any, issue: unknown) => {
    if (issue instanceof EvidenceError) return res.status(issue.status).json({ ok: false, error: issue.message, current: issue.current });
    return res.status(503).json({ ok: false, error: 'Local evidence storage is unavailable; existing data has not been replaced.' });
  };
  app.get('/api/evidence', (_req, res) => { try { res.json({ items: store().list(), source: 'local-evidence', capabilities: { create: true, update: true, correct: true, publish: false } }); } catch (issue) { error(res, issue); } });
  app.get('/api/evidence/:id', (req, res) => { try { res.json({ ok: true, item: store().get(req.params.id) }); } catch (issue) { error(res, issue); } });
  app.post('/api/evidence', (req, res) => { try { res.status(201).json({ ok: true, item: store().create(req.body ?? {}) }); } catch (issue) { error(res, issue); } });
  app.put('/api/evidence/:id', (req, res) => { try { res.json({ ok: true, item: store().update(req.params.id, req.body ?? {}) }); } catch (issue) { error(res, issue); } });
  app.post('/api/evidence/:id/corrections', (req, res) => { try { res.json({ ok: true, item: store().update(req.params.id, req.body ?? {}, 'correction') }); } catch (issue) { error(res, issue); } });
  app.post('/api/evidence/:id/outputs', async (req, res) => {
    try {
      const current = store().get(req.params.id), body = req.body ?? {};
      if (body.expectedRevision !== current.revision) throw new EvidenceError('The record changed. Review the current revision before creating output.', 409, current);
      const format = body.format ?? 'brief', language = body.language ?? current.language;
      if (!['brief','article','script'].includes(format) || !['hy','en','ru'].includes(language)) throw new EvidenceError('Choose a supported format and HY, EN or RU language.');
      let outputText = body.text;
      if (outputText === undefined) {
        if (format === 'brief' && language === current.language) outputText = renderEvidenceBrief(current);
        else {
          if (!options?.generateOutput) throw new EvidenceError('AI drafting is not configured for this output. Export a brief in the record language.', 503);
          if (!current.claims.length || !current.sources.length) throw new EvidenceError('Add source-linked claims before requesting a generated output.');
          outputText = await options.generateOutput(current, format, language);
        }
      }
      const item = store().update(req.params.id, { ...body, format, language, text: outputText }, 'output');
      return res.json({ ok: true, item, output: item.outputs.at(-1), published: false, languageParity: 'not-verified' });
    } catch (issue) { error(res, issue); }
  });
  app.get('/api/evidence/:id/brief', (req, res) => { try { const item = store().get(req.params.id); res.json({ ok: true, revision: item.revision, text: renderEvidenceBrief(item), source: 'retained-evidence', published: false }); } catch (issue) { error(res, issue); } });
}
