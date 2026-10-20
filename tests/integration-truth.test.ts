import test from 'node:test';
import assert from 'node:assert/strict';
import { completedGscWindow, expertRunObservation, normalizeWordPressPost, readVpsStatus, smartRunObservation, unicodeTokens } from '../server/integrations';
import { observeProduction, observeWordPress, registerObservationRoutes } from '../server/observation';
import { registerWordPressEditRoutes } from '../server/wordpress-edit';
import { normalizeTimestamp } from '../shared/timestamps';
import { formatTime } from '../src/lib/studio';

function fakeApp() {
  const routes = new Map<string, Function>();
  const app: any = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, (path: string, callback: Function) => routes.set(`${method} ${path}`, callback)]));
  return { app, async request(method: string, path: string, body: any = {}, params: any = {}, query: any = {}) {
    let status = 200; let data: any;
    const response: any = { status(value: number) { status = value; return response; }, json(value: any) { data = value; return response; } };
    const callback = routes.get(`${method} ${path}`); assert.ok(callback, `Missing route ${method} ${path}`);
    await callback({ body, params, query }, response);
    return { status, data };
  } };
}

test('Unicode retrieval retains Armenian and Russian words and normalizes compatibility characters', () => {
  const tokens = unicodeTokens('Հայաստան Երևան Россия экономика ＡＺＡＴ', 3);
  assert.ok(tokens.includes('հայաստան')); assert.ok(tokens.includes('россия')); assert.ok(tokens.includes('azat'));
  assert.equal(unicodeTokens('Ա ԱԲ AB', 3).length, 0);
});
test('Search Console window contains exactly 28 completed dates across month boundaries', () => {
  const window = completedGscWindow(28, new Date('2026-03-01T01:00:00Z'));
  assert.deepEqual(window, { startDate: '2026-01-29', endDate: '2026-02-25', days: 28, timezone: 'America/Los_Angeles', dataState: 'final' });
});
test('remote reader refuses unknown paths and public HTTP before making a network request', async t => {
  let calls = 0; t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('unexpected'); });
  await assert.rejects(readVpsStatus({ baseUrl: 'https://example.com' }, '/api/expert/produce'), /no verified/);
  await assert.rejects(readVpsStatus({ baseUrl: 'http://example.com', apiToken: 'test-only' }, '/health'), /Public HTTP/);
  assert.equal(calls, 0);
});
test('read-only adapter rejects remote redirect instead of forwarding authorization', async t => {
  t.mock.method(globalThis, 'fetch', async (_url: any, init: any) => { assert.equal(init.redirect, 'error'); return new Response('', { status: 302 }); });
  await assert.rejects(readVpsStatus({ baseUrl: 'https://example.com', apiToken: 'test-only' }, '/health'), /HTTP 302/);
});
test('Expert and Smart observations use real fields without synthesizing run times or logs', () => {
  const expert = expertRunObservation({ is_running: false, is_paused: false, topic_count: 11, manifest: { status: 'complete', mode: 'produce' } });
  assert.equal(expert.status, 'complete'); assert.equal(expert.stage, 'produce'); assert.equal(expert.updatedAt, null); assert.deepEqual(expert.logs, []);
  const smart = smartRunObservation({ is_running: true, is_stopping: true, daily_count: 3 });
  assert.equal(smart.status, 'stopping'); assert.equal(smart.counts.publishedToday, 3);
  assert.throws(() => expertRunObservation({ status: 'success' }), /Unrecognized/);
});
test('source timestamps normalize seconds, milliseconds, fractional seconds, and offset ISO consistently', () => {
  const expected = '2026-10-20T10:00:22.000Z';
  for (const value of [1792490422, '1792490422', 1792490422000, '1792490422000', '2026-10-20T14:00:22+04:00', expected]) {
    assert.equal(normalizeTimestamp(value), expected, String(value));
    assert.equal(formatTime(value), formatTime(expected));
  }
  assert.equal(normalizeTimestamp(1792490422.125), '2026-10-20T10:00:22.125Z');
});
test('missing, sentinel, malformed, impossible and out-of-range timestamps stay unknown', () => {
  for (const value of [undefined, null, '', ' ', 0, '0', -1, '-1792490422', NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER,
    8.64e15 + 1, true, false, [], {}, 'yesterday', '1e9', '2026-02-30T10:00:00Z', '2026-13-01T00:00:00Z', '2026-10-20T24:00:00Z', '2026-10-20T10:60:00Z', '2026-10-20T10:00:00+25:00']) {
    assert.equal(normalizeTimestamp(value), null, String(value));
    assert.equal(formatTime(value), 'Unknown', String(value));
  }
  assert.equal(normalizeTimestamp('2024-02-29T10:00:00Z'), '2024-02-29T10:00:00.000Z');
  assert.equal(normalizeTimestamp('2026-10-20T10:00:22'), '2026-10-20T10:00:22');
  assert.equal(formatTime('2026-10-20T10:00:22'), '2026-10-20 10:00:22 (timezone not reported)');
});
test('Expert update time retains the source value and never substitutes the observation receipt time', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-21T00:00:00Z') });
  const result = expertRunObservation({ is_running: false, manifest: { finished_at: 0, updated_at: 1792490422, started_at: '2026-10-19T00:00:00Z' } });
  assert.equal(result.updatedAt, '2026-10-20T10:00:22.000Z');
  assert.deepEqual(result.updatedAtSource, { field: 'manifest.updated_at', value: 1792490422 });
  assert.deepEqual(result.receipt, { source: 'vps:/api/expert/status', observedAt: '2026-10-21T00:00:00.000Z' });
  const missing = expertRunObservation({ is_running: false, manifest: { finished_at: 'invalid', updated_at: 0 } });
  assert.equal(missing.updatedAt, null);
  assert.notEqual(missing.updatedAt, missing.receipt.observedAt);
});
test('schedule observations return normalized worker updates and retain cached source receipts', async t => {
  t.mock.method(globalThis, 'fetch', async (url: any) => Response.json(String(url).endsWith('/api/expert/status')
    ? { is_running: false, manifest: { finished_at: 1792490422 } } : { is_running: false }));
  const api = fakeApp(); registerObservationRoutes(api.app, { readConfig: () => ({ vps: { baseUrl: 'https://example.com' } }), getGoogleAccessToken: async () => { throw new Error('must not request token'); } });
  const first = await api.request('get', '/api/automations');
  const second = await api.request('get', '/api/automations');
  assert.equal(first.data.items[0].lastRun, '2026-10-20T10:00:22.000Z');
  assert.equal(first.data.items[1].lastRun, null);
  assert.deepEqual(second.data.items[0].receipt, first.data.items[0].receipt);
  assert.equal(second.data.observedAt, first.data.observedAt);
});
test('no VPS connection means unavailable observations, never fake scheduled jobs', async () => {
  const result = await observeProduction({ vps: {} }); assert.equal(result.available, false); assert.deepEqual(result.items, []); assert.equal(result.capabilities.trigger, false);
});
test('WordPress HTTP failures do not create healthy status, security findings, scores, or uptime', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('error', { status: 500 }));
  const result = await observeWordPress({ baseUrl: 'https://example.com', name: 'test' });
  assert.equal(result.status, 'degraded'); assert.equal(result.performance.uptime, null); assert.equal(result.performance.score, null);
  assert.equal(result.metrics.length, 1); assert.equal(result.metrics[0].value, 'HTTP 500');
});
test('missing GSC credentials returns unknown metrics without fetching or counting WP posts', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch'); });
  const api = fakeApp(); registerObservationRoutes(api.app, { readConfig: () => ({ vps: {}, google: {}, wordpressSites: [] }), getGoogleAccessToken: async () => { throw new Error('must not request token'); } });
  const result = await api.request('get', '/api/seo-stats');
  assert.equal(result.data.available, false); assert.equal(result.data.clicks, null); assert.equal(result.data.impressions, null); assert.deepEqual(result.data.history, []);
});
test('real GSC totals and daily rows remain distinct and use final data', async t => {
  const calls: any[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: any, init: any) => {
    const body = JSON.parse(init.body); calls.push(body); assert.equal(body.dataState, 'final');
    return Response.json({ rows: body.dimensions.length ? [{ keys: ['2026-10-01'], clicks: 0, impressions: 17 }] : [{ clicks: 0, impressions: 17, ctr: 0, position: 4.5 }] });
  });
  const api = fakeApp(); registerObservationRoutes(api.app, { readConfig: () => ({ vps: {}, google: { gscSiteUrl: 'sc-domain:example.com', serviceAccountJson: 'test-only' }, wordpressSites: [] }), getGoogleAccessToken: async () => 'test-only' });
  const result = await api.request('get', '/api/seo-stats');
  assert.equal(result.data.available, true); assert.equal(result.data.clicks, 0); assert.equal(result.data.avgPosition, 4.5); assert.equal(result.data.history[0].impressions, 17);
  assert.deepEqual(calls.map(call => call.dimensions), [[], ['date']]);
});
test('GSC provider errors return nulls, not apparent zero performance', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 403 }));
  const api = fakeApp(); registerObservationRoutes(api.app, { readConfig: () => ({ vps: {}, google: { gscSiteUrl: 'sc-domain:example.com', serviceAccountJson: 'test-only' }, wordpressSites: [] }), getGoogleAccessToken: async () => 'test-only' });
  const result = await api.request('get', '/api/seo-stats'); assert.equal(result.data.source, 'gsc-error'); assert.equal(result.data.clicks, null); assert.equal(result.data.avgPosition, null);
});

const rawPost = { id: 7, date: '2026-10-19', modified: '2026-10-19T12:00:00', modified_gmt: '2026-10-19T08:00:00', status: 'draft', title: { raw: 'Հայաստան', rendered: 'Հայաստան' }, content: { raw: '<p>Original</p>', rendered: '<p>Original rendered</p>' }, excerpt: { raw: '', rendered: '' }, link: 'https://example.com/story' };
const basePost = normalizeWordPressPost(rawPost);
function wpApi(fetchPost = async () => basePost) {
  const api = fakeApp(); registerWordPressEditRoutes(api.app, { readConfig: () => ({}), getSite: () => ({ id: 'hy', baseUrl: 'https://example.com' }), fetchPost, authHeaders: () => ({}) }); return api;
}
test('WordPress revision includes raw content even when modified timestamps do not change', () => {
  const changed = normalizeWordPressPost({ ...rawPost, content: { raw: '<p>Manual change</p>', rendered: '<p>Manual change</p>' } });
  assert.notEqual(changed.revision, basePost.revision); assert.equal(basePost.content, '<p>Original</p>');
});
test('stale WordPress save is rejected before any write and returns current raw source', async t => {
  let writes = 0; t.mock.method(globalThis, 'fetch', async () => { writes++; return Response.json({}); });
  const response = await wpApi().request('put', '/api/wp/post/:postId', { content: '<p>Edit</p>', expectedRevision: 'stale' }, { postId: '7' });
  assert.equal(response.status, 409); assert.equal(response.data.current.content, '<p>Original</p>'); assert.equal(writes, 0);
});
test('WordPress preview returns complete before/after diff and never writes', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not write'); });
  const response = await wpApi().request('put', '/api/wp/post/:postId', { content: '<p>Edit</p>', expectedRevision: basePost.revision, previewOnly: true }, { postId: '7' });
  assert.equal(response.status, 200); assert.equal(response.data.previewOnly, true); assert.deepEqual(response.data.diff.changedFields, ['content']); assert.equal(response.data.diff.before.content, '<p>Original</p>'); assert.equal(response.data.diff.after.content, '<p>Edit</p>');
});
test('WordPress save requires a loaded revision and does not enable publication transitions', async () => {
  const api = wpApi();
  assert.equal((await api.request('put', '/api/wp/post/:postId', { content: 'Edit' }, { postId: '7' })).status, 428);
  assert.equal((await api.request('put', '/api/wp/post/:postId', { status: 'publish', expectedRevision: basePost.revision }, { postId: '7' })).status, 400);
});
test('WordPress success receipt requires confirmed remote readback', async t => {
  let reads = 0; let writes = 0;
  const updated = normalizeWordPressPost({ ...rawPost, content: { raw: '<p>Edit</p>', rendered: '<p>Edit</p>' } });
  t.mock.method(globalThis, 'fetch', async (_url: any, init: any) => { writes++; assert.deepEqual(JSON.parse(init.body), { content: '<p>Edit</p>' }); assert.equal(init.redirect, 'error'); return Response.json({ id: 7 }); });
  const response = await wpApi(async () => ++reads === 1 ? basePost : updated).request('put', '/api/wp/post/:postId', { content: '<p>Edit</p>', expectedRevision: basePost.revision }, { postId: '7' });
  assert.equal(response.status, 200); assert.equal(response.data.receipt.revision, updated.revision); assert.equal(response.data.atomicRemoteCompare, false); assert.equal(reads, 2); assert.equal(writes, 1);
});
test('mismatched remote readback does not claim the requested edit succeeded', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ id: 7 }));
  const response = await wpApi().request('put', '/api/wp/post/:postId', { content: '<p>Edit</p>', expectedRevision: basePost.revision }, { postId: '7' });
  assert.equal(response.status, 502); assert.equal(response.data.ok, false); assert.equal(response.data.receipt, undefined); assert.ok(response.data.current);
});
