export interface EditableDraft { title: string; content: string; baseTitle: string; baseContent: string; expectedRevision: string; }
export interface EditablePost { revision?: string; rawAvailable?: boolean; }
export function editReadiness(draft: EditableDraft | undefined, current: EditablePost | null) {
  if (!draft || !current) return { allowed: false, reason: 'Load the current article first.' };
  if (current.rawAvailable !== true) return { allowed: false, reason: 'Editable raw WordPress content is unavailable. Review or export only.' };
  if (!draft.expectedRevision || !current.revision) return { allowed: false, reason: 'A current revision token is required before editing WordPress.' };
  if (draft.expectedRevision !== current.revision) return { allowed: false, reason: 'WordPress changed after this draft began. Compare and reload deliberately.' };
  if (draft.title === draft.baseTitle && draft.content === draft.baseContent) return { allowed: false, reason: 'No title or body changes to save.' };
  return { allowed: true, reason: 'Ready for a remote preflight comparison.' };
}
export function hasMeasuredSearchData(stats: { available?: boolean } | null | undefined) { return stats?.available === true; }
export function formatSearchMetric(value: unknown, available: boolean, kind: 'count' | 'ctr' | 'position' = 'count') {
  if (!available || typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const normalized = kind === 'ctr' ? value * 100 : value;
  return normalized.toLocaleString(undefined, { maximumFractionDigits: kind === 'count' ? 0 : 2 }) + (kind === 'ctr' ? '%' : '');
}
export function publicHttpUrl(value: string = '') { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; } }
export function articlePreviewDocument(html: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; form-action 'none'; base-uri 'none'"><style>body{font:16px/1.8 system-ui,sans-serif;color:#243f4c;max-width:780px;margin:24px auto;padding:0 22px;overflow-wrap:anywhere}h1,h2,h3{line-height:1.35}img{max-width:100%}a{color:#0b7067}pre{white-space:pre-wrap}</style></head><body>${html}</body></html>`;
}
export function evidenceOutputLabel(output: { status?: string; evidenceRevision?: number }, currentEvidenceRevision?: number) {
  if (output.status === 'needs-review' || (currentEvidenceRevision !== undefined && output.evidenceRevision !== currentEvidenceRevision)) return { stale: true, label: 'Needs correction review' };
  return { stale: false, label: 'Matches evidence revision · unreviewed' };
}

export function refreshEvidenceDrafts<T extends {id?: string}>(drafts: Record<string, {item: T; dirty: boolean}>, incoming: T[]) {
  const next = {...drafts};
  for (const record of incoming) if (record.id && next[record.id] && !next[record.id].dirty) next[record.id] = {item: record, dirty: false};
  return next;
}

export function evidenceReceiptDrafts<T extends {id?: string}>(drafts: Record<string, {item: T; dirty: boolean}>, originKey: string, saved: T, submitted?: T) {
  if (!saved.id) throw new Error('A saved evidence record ID is required.');
  const next = {...drafts};
  const editedSinceSubmission = submitted && drafts[originKey]?.dirty && JSON.stringify(drafts[originKey].item) !== JSON.stringify(submitted);
  if (originKey !== saved.id && !editedSinceSubmission) delete next[originKey];
  if (originKey !== saved.id || !editedSinceSubmission) next[saved.id] = {item: saved, dirty: false};
  return next;
}
export function ownsSelectionResult(origin: {key: string; epoch: number}, current: {key: string; epoch: number}) {
  return origin.key === current.key && origin.epoch === current.epoch;
}
export function canSendAssistantMessage(status: string | undefined, prompt: string, busy: boolean) {
  return status === 'active' && Boolean(prompt.trim()) && !busy;
}
