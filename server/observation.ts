import type { Express } from 'express';
import { createHash } from 'node:crypto';
import { completedGscWindow, expertRunObservation, readVpsStatus, smartRunObservation } from './integrations';
import { withReadDeadline } from '../shared/deadline';

type Dependencies = { readConfig: () => any; getGoogleAccessToken: (config: any, scopes: string[]) => Promise<string>; resolveVpsConfig?: (config: any) => Promise<any> };
export async function observeWordPress(site: any) {
  const observedAt = new Date().toISOString();
  if (!site) return { site: 'none', status: 'not-configured', lastCheck: observedAt, metrics: [], performance: { score: null, responseTime: null, uptime: null }, error: 'No WordPress site configured.' };
  const started = Date.now();
  try {
    const response = await fetch(`${site.baseUrl.replace(/\/+$/, '')}/wp-json/`, { signal: AbortSignal.timeout(8000), redirect: 'error', headers: { Accept: 'application/json' } });
    let isWordPress = false;
    if (response.ok) {
      const payload = await response.json();
      isWordPress = Array.isArray(payload.namespaces) && payload.namespaces.includes('wp/v2');
    }
    return { site: site.name || site.baseUrl, siteUrl: site.baseUrl, status: isWordPress ? 'healthy' : 'degraded', lastCheck: observedAt,
      metrics: [{ name: 'WordPress REST API', status: isWordPress ? 'reachable' : 'unverified', value: `HTTP ${response.status}`, color: isWordPress ? 'emerald' : 'amber' }],
      performance: { score: null, responseTime: `${Date.now() - started}ms`, uptime: null },
      note: 'This point-in-time REST check does not measure database latency, cache configuration, vulnerabilities, uptime, or Core Web Vitals.' };
  } catch { return { site: site.name || site.baseUrl, siteUrl: site.baseUrl, status: 'unreachable', lastCheck: observedAt, metrics: [], performance: { score: null, responseTime: null, uptime: null }, error: 'WordPress REST API could not be reached.' }; }
}

export async function observeProduction(config: any, resolveVpsConfig?: Dependencies['resolveVpsConfig'], options: { readStatus?: typeof readVpsStatus; timeoutMs?: number } = {}) {
  const vps = config.vps ?? {};
  const observedAt = new Date().toISOString();
  const capabilities = { observe: true, trigger: false, stop: false };
  if (!vps.baseUrl && vps.transport !== 'ssh') return { available: false, source: 'not-configured', observedAt, items: [], capabilities, note: 'Configure HTTPS or the verified SSH connection to observe Expert and Smart.' };
  const resolvedVps = Promise.resolve().then(() => resolveVpsConfig ? resolveVpsConfig(vps) : vps);
  const readStatus = options.readStatus ?? readVpsStatus;
  const worker = (name: string, route: string, normalize: (payload: any) => any) => withReadDeadline(async signal => {
    const resolved = await resolvedVps;
    if (signal.aborted) throw signal.reason;
    return normalize(await readStatus(resolved, route));
  }, options.timeoutMs ?? 30_000, `${name} status observation timed out. No complete observation was returned; refresh to retry.`);
  const outcomes = await Promise.allSettled([worker('Expert', '/api/expert/status', expertRunObservation), worker('Smart', '/api/smart_status', smartRunObservation)]);
  const items = outcomes.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  const errors = outcomes.flatMap((result, index) => result.status === 'rejected' ? [{ id: index === 0 ? 'expert' : 'smart', error: result.reason instanceof Error ? result.reason.message : 'Status unavailable.' }] : []);
  return { available: items.length > 0, source: items.length ? 'vps' : 'vps-error', transport: vps.transport === 'ssh' ? 'ssh' : 'https', observedAt, items, capabilities, errors,
    note: 'Read-only observations of the existing VPS. No run, stop, publication, or schedule changes are sent.' };
}

export function registerObservationRoutes(app: Express, dependencies: Dependencies) {
  let productionCache: { key: string; at: number; value: Promise<any> } | null = null;
  const production = () => {
    const config = dependencies.readConfig();
    const key = createHash('sha256').update(JSON.stringify(config.vps ?? {})).digest('hex');
    if (!productionCache || productionCache.key !== key || Date.now() - productionCache.at > 15_000) productionCache = { key, at: Date.now(), value: observeProduction(config, dependencies.resolveVpsConfig) };
    return productionCache.value;
  };
  app.get('/api/wordpress/health', async (_req, res) => { const config = dependencies.readConfig(); res.json(await observeWordPress(config.wordpressSites.find((site: any) => site.id === config.activeSiteId) ?? config.wordpressSites[0])); });
  app.get('/api/wp-status', async (_req, res) => {
    const config = dependencies.readConfig();
    const health = await observeWordPress(config.wordpressSites.find((site: any) => site.id === config.activeSiteId) ?? config.wordpressSites[0]);
    res.json({ status: health.status === 'healthy' ? 'ok' : 'warning', source: 'wordpress-rest', siteUrl: health.siteUrl ?? null, observedAt: health.lastCheck, issues: health.status === 'healthy' ? [] : [{ id: 'wp-rest', type: 'integration', message: health.error ?? 'REST response is unverified.', severity: 'high' }], scope: 'REST reachability only' });
  });
  const respondProduction = async (res: any, schedules = false) => {
    try {
    const observed = await production();
    res.json(schedules ? { ...observed, items: observed.items.map((item: any) => ({ ...item, type: 'vps', lastRun: item.updatedAt, cron: null, readOnly: true })), note: 'Existing pipeline observations. No local scheduler is installed; schedule and trigger controls are unavailable.' } : observed);
    } catch { res.status(503).json({ ok: false, available: false, error: 'Production status could not be read. Refresh to retry.' }); }
  };
  app.get('/api/production/status', async (_req, res) => { await respondProduction(res); });
  app.get('/api/pipeline/status', async (_req, res) => { await respondProduction(res); });
  app.get('/api/automations', async (_req, res) => { await respondProduction(res, true); });
  const unavailable = (_req: any, res: any) => res.status(501).json({ ok: false, available: false, error: 'No verified executor is registered. Use the existing Azat dashboard for production controls.', capabilities: { trigger: false, stop: false, publish: false } });
  app.post('/api/automations', unavailable); app.put('/api/automations/:id', unavailable); app.delete('/api/automations/:id', unavailable);
  app.get('/api/automations/:id/trigger', unavailable); app.post('/api/pipeline/start_stage', unavailable); app.post('/api/pipeline/stop', unavailable);
  app.get('/api/notebooklm/list', (_req, res) => res.status(501).json({ available: false, items: [], error: 'No NotebookLM content adapter is registered.' }));
  app.post('/api/notebooklm/generate', unavailable);
  app.post('/api/tools/execute', (_req, res) => res.status(501).json({ ok: false, available: false, error: 'Tool execution is unavailable. Prompt simulation is not an executable sandbox.' }));

  let seoCache: { key: string; at: number; value: Promise<any> } | null = null;
  app.get('/api/seo-stats', async (_req, res) => {
    const config = dependencies.readConfig();
    const window = completedGscWindow(28);
    const key = createHash('sha256').update(JSON.stringify([config.google?.gscSiteUrl, config.google?.serviceAccountJson, window])).digest('hex');
    const load = async () => {
      const unavailable = (source: string, note: string) => ({ available: false, clicks: null, impressions: null, avgPosition: null, ctr: null, history: [], source, window, note });
      if (!config.google?.gscSiteUrl || !config.google?.serviceAccountJson) return unavailable('not-configured', 'Configure the Search Console property and authorized Google service account. Unknown metrics are not zero.');
      try {
        const token = await dependencies.getGoogleAccessToken(config, ['https://www.googleapis.com/auth/webmasters.readonly']);
        const endpoint = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(config.google.gscSiteUrl)}/searchAnalytics/query`;
        const query = async (dimensions: string[]) => {
          const response = await fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(20_000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ startDate: window.startDate, endDate: window.endDate, dimensions, type: 'web', dataState: 'final', rowLimit: 25000 }) });
          if (!response.ok) throw new Error(`Search Console request failed (HTTP ${response.status}).`);
          return response.json();
        };
        const [totals, daily] = await Promise.all([query([]), query(['date'])]);
        const row = totals.rows?.[0];
        return { available: true, source: 'gsc-api', siteUrl: config.google.gscSiteUrl, window, observedAt: new Date().toISOString(),
          clicks: row?.clicks ?? 0, impressions: row?.impressions ?? 0, avgPosition: row?.position ?? null, ctr: row?.ctr ?? null,
          history: (daily.rows ?? []).map((day: any) => ({ date: day.keys?.[0], clicks: day.clicks, impressions: day.impressions })),
          note: 'Google Web Search data. AI-specific clicks are not isolated by this report. Search Console reporting limits still apply.' };
      } catch (issue) { return unavailable('gsc-error', issue instanceof Error ? issue.message : 'Search Console data is unavailable.'); }
    };
    if (!seoCache || seoCache.key !== key || Date.now() - seoCache.at > 60_000) seoCache = { key, at: Date.now(), value: load() };
    res.json(await seoCache.value);
  });
}
