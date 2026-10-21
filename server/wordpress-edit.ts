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

export function registerWordPressEditRoutes(app: Express, dependencies: {
  readConfig: () => any; getSite: (config: any, siteId?: string) => any; fetchPost: (site: any, id: number) => Promise<ReturnType<typeof normalizeWordPressPost>>; authHeaders: (site: any) => HeadersInit | Promise<HeadersInit>;
}) {
  const active = new Set<string>();
  app.get('/api/wp/post/:postId', async (req, res) => {
    try {
      const postId = Number(req.params.postId);
      if (!Number.isInteger(postId) || postId < 1) return res.status(400).json({ error: 'Invalid post id.' });
      const site = dependencies.getSite(dependencies.readConfig(), typeof req.query.siteId === 'string' ? req.query.siteId : undefined);
      const post = await dependencies.fetchPost(site, postId);
      res.json({ siteId: site.id, post, concurrency: 'preflight-revision-check', atomicRemoteCompare: false });
    } catch { res.status(502).json({ error: 'WordPress article could not be loaded. Check the site and editor credentials.' }); }
  });
  app.put('/api/wp/post/:postId', async (req, res) => {
    let operationKey = '';
    try {
      const postId = Number(req.params.postId);
      if (!Number.isInteger(postId) || postId < 1) return res.status(400).json({ error: 'Invalid post id.' });
      const site = dependencies.getSite(dependencies.readConfig(), typeof req.query.siteId === 'string' ? req.query.siteId : undefined);
      operationKey = `${site.id}:${postId}`;
      if (active.has(operationKey)) { operationKey = ''; return res.status(409).json({ error: 'A save for this article is already in progress.' }); }
      active.add(operationKey);
      const body = req.body ?? {};
      if (typeof body.expectedRevision !== 'string' && typeof body.expectedModified !== 'string') return res.status(428).json({ error: 'Load the article and supply expectedRevision before saving.' });
      const current = await dependencies.fetchPost(site, postId);
      if (body.expectedRevision ? body.expectedRevision !== current.revision : body.expectedModified !== current.modified) return res.status(409).json({ error: 'This article changed in WordPress. Review the latest revision before saving.', current });
      if (!current.rawAvailable) return res.status(403).json({ error: 'Editable source content is unavailable. Check WordPress editor credentials.' });
      const diff = postEditPreview(current, body);
      if (!diff.changedFields.length) return res.json({ ok: true, changed: false, siteId: site.id, post: current, diff });
      if (body.previewOnly === true) return res.json({ ok: true, previewOnly: true, siteId: site.id, post: current, diff });
      const target = new URL(`${site.baseUrl.replace(/\/+$/, '')}/wp-json/wp/v2/posts/${postId}?context=edit`);
      if (target.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) return res.status(400).json({ error: 'WordPress edits require HTTPS.' });
      const changes = Object.fromEntries(diff.changedFields.map(field => [field, diff.after[field]]));
      const headers = new Headers(await dependencies.authHeaders(site));
      headers.set('Content-Type', 'application/json');
      const response = await fetch(target, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000), headers, body: JSON.stringify(changes) });
      if (!response.ok) return res.status(502).json({ ok: false, error: `WordPress rejected the edit (HTTP ${response.status}).` });
      const responsePost = await response.json();
      if (responsePost?.id !== postId) return res.status(502).json({ ok: false, error: 'WordPress did not return the expected article. Reload before retrying.' });
      const post = await dependencies.fetchPost(site, postId);
      if (!post.rawAvailable || diff.changedFields.some(field => post[field] !== diff.after[field])) return res.status(502).json({ ok: false, error: 'The edit was sent, but the final WordPress content differs from the requested change. Reload and review before retrying.', current: post });
      res.json({ ok: true, changed: true, siteId: site.id, post, diff, receipt: { provider: 'wordpress', postId: post.id, revision: post.revision, observedAt: new Date().toISOString() }, concurrency: 'preflight-revision-check', atomicRemoteCompare: false,
        note: 'A fresh remote revision was checked before saving. WordPress REST does not provide an atomic compare-and-swap in this adapter.' });
    } catch (issue) { res.status(issue instanceof Error && /must be|status transitions/.test(issue.message) ? 400 : 502).json({ ok: false, error: issue instanceof Error && /must be|status transitions/.test(issue.message) ? issue.message : 'WordPress save could not be confirmed. Reload the article before retrying.' }); }
    finally { if (operationKey) active.delete(operationKey); }
  });
}
