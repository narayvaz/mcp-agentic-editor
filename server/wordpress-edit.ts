import type { Express } from 'express';
import { normalizeWordPressPost } from './integrations';

export function postEditPreview(current: ReturnType<typeof normalizeWordPressPost>, body: any) {
  const after = { title: current.title, content: current.content, excerpt: current.excerpt, status: current.status };
  for (const field of ['title', 'content', 'excerpt'] as const) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== 'string' || body[field].length > 1_000_000) throw new Error(`${field} must be text up to 1,000,000 characters.`);
      after[field] = body[field];
    }
  }
  if (body.status !== undefined && body.status !== current.status) throw new Error('Publication and status transitions are not enabled in this editor.');
  const before = { title: current.title, content: current.content, excerpt: current.excerpt, status: current.status };
  const changedFields = (['title', 'content', 'excerpt'] as const).filter(field => before[field] !== after[field]);
  return { before, after, changedFields, baseRevision: current.revision };
}

export type WordPressEditDependencies = {
  readConfig: () => any; getSite: (config: any, siteId?: string) => any;
  fetchPost: (site: any, id: number) => Promise<ReturnType<typeof normalizeWordPressPost>>;
  authHeaders: (site: any) => HeadersInit | Promise<HeadersInit>;
};
export class WordPressEditError extends Error {
  constructor(message: string, public status = 502, public current?: unknown) { super(message); }
}
/** Shared editor: UI and agent use the same revision checks, lock and remote readback. */
export function createWordPressEditor(dependencies: WordPressEditDependencies) {
  const active = new Set<string>();
  return {
    async read(postId: number, siteId?: string) {
      if (!Number.isInteger(postId) || postId < 1) throw new WordPressEditError('Invalid post id.', 400);
      const site = dependencies.getSite(dependencies.readConfig(), siteId);
      const post = await dependencies.fetchPost(site, postId);
      return { siteId: site.id, post, concurrency: 'preflight-revision-check', atomicRemoteCompare: false };
    },
    async save(postId: number, siteId: string | undefined, body: any, signal?: AbortSignal) {
      let operationKey = '';
      try {
        if (signal?.aborted) throw new WordPressEditError('The save was stopped before dispatch.', 409);
        if (!Number.isInteger(postId) || postId < 1) throw new WordPressEditError('Invalid post id.', 400);
        const site = dependencies.getSite(dependencies.readConfig(), siteId);
        operationKey = `${site.id}:${postId}`;
        if (active.has(operationKey)) { operationKey = ''; throw new WordPressEditError('A save for this article is already in progress.', 409); }
        active.add(operationKey);
        if (typeof body.expectedRevision !== 'string' && typeof body.expectedModified !== 'string') throw new WordPressEditError('Load the article and supply expectedRevision before saving.', 428);
        const current = await dependencies.fetchPost(site, postId);
        if (body.expectedRevision ? body.expectedRevision !== current.revision : body.expectedModified !== current.modified) throw new WordPressEditError('This article changed in WordPress. Review the latest revision before saving.', 409, current);
        if (!current.rawAvailable) throw new WordPressEditError('Editable source content is unavailable. Check WordPress editor credentials.', 403);
        const diff = postEditPreview(current, body);
        if (!diff.changedFields.length || body.previewOnly === true) return { ok: true, changed: false, previewOnly: body.previewOnly === true, siteId: site.id, post: current, diff,
          receipt: { provider: 'wordpress', postId: current.id, revision: current.revision, observedAt: new Date().toISOString() } };
        const target = new URL(`${site.baseUrl.replace(/\/+$/, '')}/wp-json/wp/v2/posts/${postId}?context=edit`);
        if (target.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) throw new WordPressEditError('WordPress edits require HTTPS.', 400);
        const changes = Object.fromEntries(diff.changedFields.map(field => [field, diff.after[field]]));
        const headers = new Headers(await dependencies.authHeaders(site)); headers.set('Content-Type', 'application/json');
        if (signal?.aborted) throw new WordPressEditError('The save was stopped before dispatch.', 409);
        const timeout = AbortSignal.timeout(20_000);
        const response = await fetch(target, { method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers, body: JSON.stringify(changes) });
        if (!response.ok) throw new WordPressEditError(`WordPress rejected the edit (HTTP ${response.status}).`);
        const responsePost = await response.json();
        if (responsePost?.id !== postId) throw new WordPressEditError('WordPress did not return the expected article. Reload before retrying.');
        const post = await dependencies.fetchPost(site, postId);
        if (!post.rawAvailable || diff.changedFields.some(field => post[field] !== diff.after[field])) throw new WordPressEditError('The edit was sent, but the final WordPress content differs from the requested change. Reload and review before retrying.', 502, post);
        return { ok: true, changed: true, siteId: site.id, post, diff, receipt: { provider: 'wordpress', postId: post.id, revision: post.revision, observedAt: new Date().toISOString() }, concurrency: 'preflight-revision-check', atomicRemoteCompare: false,
          note: 'A fresh remote revision was checked before saving. WordPress REST does not provide an atomic compare-and-swap in this adapter.' };
      } finally { if (operationKey) active.delete(operationKey); }
    },
  };
}
export function registerWordPressEditRoutes(app: Express, dependencies: WordPressEditDependencies, editor = createWordPressEditor(dependencies)) {
  const fail = (res: any, issue: unknown) => {
    const invalid = issue instanceof Error && /must be|status transitions/.test(issue.message);
    const safe = issue instanceof WordPressEditError ? issue : new WordPressEditError(invalid ? issue.message : 'WordPress save could not be confirmed. Reload the article before retrying.', invalid ? 400 : 502);
    res.status(safe.status).json({ ok: false, error: safe.message, ...(safe.current ? { current: safe.current } : {}) });
  };
  app.get('/api/wp/post/:postId', async (req, res) => {
    try { res.json(await editor.read(Number(req.params.postId), typeof req.query.siteId === 'string' ? req.query.siteId : undefined)); }
    catch { res.status(502).json({ error: 'WordPress article could not be loaded. Check the site and editor credentials.' }); }
  });
  app.put('/api/wp/post/:postId', async (req, res) => {
    try { res.json(await editor.save(Number(req.params.postId), typeof req.query.siteId === 'string' ? req.query.siteId : undefined, req.body ?? {})); }
    catch (issue) { fail(res, issue); }
  });
}
