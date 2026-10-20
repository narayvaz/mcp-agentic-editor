import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';

export function unicodeTokens(text: string, minimumLength = 3): string[] {
  return [...new Set((text.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).filter(word => [...word].length >= minimumLength))];
}

export function normalizeWordPressPost(post: any) {
  const title = typeof post?.title?.raw === 'string' ? post.title.raw : post?.title?.rendered ?? '';
  const content = typeof post?.content?.raw === 'string' ? post.content.raw : post?.content?.rendered ?? '';
  const excerpt = typeof post?.excerpt?.raw === 'string' ? post.excerpt.raw : post?.excerpt?.rendered ?? '';
  const revision = createHash('sha256').update(JSON.stringify({ id: post.id, modified: post.modified_gmt ?? post.modified, title, content, excerpt,
    status: post.status, date: post.date_gmt ?? post.date, featured_media: post.featured_media, categories: post.categories, tags: post.tags })).digest('hex');
  return { id: post.id, date: post.date, status: post.status, title, content, excerpt, link: post.link,
    modified: post.modified ?? null, modifiedGmt: post.modified_gmt ?? null, revision,
    rawAvailable: typeof post?.content?.raw === 'string', rendered: { title: post?.title?.rendered ?? '', content: post?.content?.rendered ?? '', excerpt: post?.excerpt?.rendered ?? '' } };
}

export function completedGscWindow(days = 28, now = new Date()) {
  // Search Console dates are Pacific dates; a three-day lag avoids asking for an incomplete current day.
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(part=>[part.type,part.value]));
  const boundedDays = Math.max(1, Math.min(120, Math.floor(days)));
  const end = new Date(`${parts.year}-${parts.month}-${parts.day}`); end.setUTCDate(end.getUTCDate() - 3);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - boundedDays + 1);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), days: boundedDays, timezone: 'America/Los_Angeles', dataState: 'final' };
}

export const READ_ONLY_VPS_PATHS = new Set(['/health', '/api/expert/status', '/api/smart_status', '/api/cs_status', '/api/liveblog_status', '/api/stats', '/api/seo/overview']);
export type VpsReadConfig = { baseUrl?: string; apiToken?: string; transport?: string; sshHost?: string; sshIdentityPath?: string; runStatusPath?: string };

// The only remote program is a fixed GET reader. No user command, endpoint, token, or script text is interpolated into it.
const SSH_READER = `import sys,json,urllib.request,urllib.error
data=json.load(sys.stdin)
allowed={'/health','/api/expert/status','/api/smart_status','/api/cs_status','/api/liveblog_status','/api/stats','/api/seo/overview'}
route=data.get('path','')
if route not in allowed: raise SystemExit('Unapproved read-only status route')
token=data.get('token','')
headers={'Accept':'application/json'}
if token: headers['Authorization']='Bearer '+token
try:
    with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:5000'+route,headers=headers,method='GET'),timeout=12) as response:
        body=response.read(2000001)
        if len(body)>2000000: raise SystemExit('Status response exceeds size limit')
        parsed=json.loads(body)
        print(json.dumps(parsed,ensure_ascii=False))
except urllib.error.HTTPError as error:
    print(json.dumps({'_transportError':'Remote status request failed','httpStatus':error.code}))
except Exception:
    print(json.dumps({'_transportError':'Remote status service is unavailable'}))
`;
const shellQuoteConstant = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;

export async function readVpsStatus(config: VpsReadConfig, relativePath: string): Promise<any> {
  if (!READ_ONLY_VPS_PATHS.has(relativePath)) throw new Error('This route has no verified read-only VPS adapter.');
  if (config.transport === 'ssh') {
    if ((config.sshHost ?? 'my-vps') !== 'my-vps') throw new Error('Only the verified my-vps SSH alias is supported.');
    if (!config.sshIdentityPath || !config.sshIdentityPath.startsWith('/')) throw new Error('Configure the absolute SSH identity path for the status reader.');
    return new Promise((resolve, reject) => {
      const child = execFile('/usr/bin/ssh', ['-i', config.sshIdentityPath!, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes', 'my-vps', `python3 -c ${shellQuoteConstant(SSH_READER)}`],
        { timeout: 25_000, maxBuffer: 2_100_000, encoding: 'utf8' }, (error, stdout) => {
          if (error) return reject(new Error('SSH status connection failed. Check the configured identity and known host.'));
          try {
            const result = JSON.parse(stdout);
            if (result?._transportError) return reject(new Error(`${result._transportError}${result.httpStatus ? ` (HTTP ${result.httpStatus})` : ''}.`));
            resolve(result);
          } catch { reject(new Error('SSH status service did not return valid JSON.')); }
        });
      child.stdin?.end(JSON.stringify({ path: relativePath, token: config.apiToken ?? '' }));
    });
  }
  if (!config.baseUrl) throw new Error('VPS status connection is not configured.');
  const base = new URL(config.baseUrl);
  if (base.username || base.password) throw new Error('Do not put credentials in the VPS URL.');
  if (base.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Use HTTPS or the verified SSH status transport. Public HTTP credentials are not sent.');
  const response = await fetch(new URL(relativePath, base), { method: 'GET', redirect: 'error', headers: { Accept: 'application/json', ...(config.apiToken ? { Authorization: `Bearer ${config.apiToken}` } : {}) }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`VPS status request failed (HTTP ${response.status}).`);
  return response.json();
}

export function expertRunObservation(payload: any) {
  if (typeof payload?.is_running !== 'boolean' || !payload.manifest || typeof payload.manifest !== 'object') throw new Error('Unrecognized Expert status response.');
  const manifest = payload.manifest;
  return { id: 'expert', name: 'Expert', status: payload.is_paused ? 'paused' : payload.is_running ? 'running' : String(manifest.status ?? 'idle'),
    stage: typeof manifest.mode === 'string' ? manifest.mode : typeof manifest.stage === 'string' ? manifest.stage : null,
    updatedAt: manifest.finished_at ?? manifest.updated_at ?? manifest.started_at ?? null, logs: [],
    counts: { topics: payload.topic_count ?? null, selected: payload.selected_count ?? null, approved: payload.approved_count ?? null, contextReady: manifest.context_ready ?? null, needsReview: manifest.needs_review ?? null },
    receipt: { source: 'vps:/api/expert/status', observedAt: new Date().toISOString() } };
}
export function smartRunObservation(payload: any) {
  if (typeof payload?.is_running !== 'boolean') throw new Error('Unrecognized Smart status response.');
  return { id: 'smart', name: 'Smart', status: payload.is_stopping ? 'stopping' : payload.is_running ? 'running' : String(payload.state ?? 'idle'), stage: null, updatedAt: null, logs: [],
    counts: { publishedToday: typeof payload.daily_count === 'number' ? payload.daily_count : null },
    receipt: { source: 'vps:/api/smart_status', observedAt: new Date().toISOString() } };
}
