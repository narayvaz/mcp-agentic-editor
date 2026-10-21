import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { normalizeTimestamp } from '../shared/timestamps';
import { withReadDeadline } from '../shared/deadline';

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

/** Return only fixed descriptions and allowlisted process metadata, never raw SSH output or Error.message. */
export function classifySshFailure(error: { code?: unknown; signal?: unknown; killed?: unknown } | null, stderr: unknown = ''): string {
  const diagnostic = typeof stderr === 'string' ? stderr.slice(0, 16_384) : '';
  const knownCodes = new Set(['EACCES', 'EPERM', 'ENOENT', 'ENOTDIR', 'ETIMEDOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER']);
  const knownSignals = new Set(['SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGINT', 'SIGHUP', 'SIGSEGV', 'SIGPIPE', 'SIGQUIT', 'SIGBUS']);
  const code = typeof error?.code === 'string' && knownCodes.has(error.code) ? error.code : typeof error?.code === 'number' && Number.isInteger(error.code) && error.code >= -4096 && error.code <= 255 ? String(error.code) : 'unreported';
  const signal = typeof error?.signal === 'string' && knownSignals.has(error.signal) ? error.signal : null;
  const metadata = ` [code=${code}${signal ? `; signal=${signal}` : ''}${error?.killed === true ? '; killed=true' : ''}]`;
  let message: string;
  if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || /Status response exceeds size limit/.test(diagnostic)) {
    message = 'SSH status response exceeded the configured output limit. Inspect the service status payload size; no complete observation was returned.';
  } else if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(diagnostic)) {
    message = 'SSH host verification failed. Verify the server identity and its saved known-host entry through a trusted SSH session.';
  } else if (error?.code === 'EACCES' || error?.code === 'EPERM' || /Operation not permitted|(?:Load key|identity file)[^\r\n]{0,1000}:\s*Permission denied/i.test(diagnostic)) {
    message = 'The operating system denied SSH or identity-file access. Check Azat Studio’s Files & Folders access and the configured identity’s file permissions.';
  } else if (/Permission denied/i.test(diagnostic)) {
    message = 'SSH authentication was rejected. Confirm the configured identity is readable by Azat Studio and authorized for the server.';
  } else if (error?.code === 'ENOTFOUND' || error?.code === 'EAI_AGAIN' || /Could not resolve hostname/i.test(diagnostic)) {
    message = 'SSH could not resolve the configured host. Check the saved SSH alias and DNS in the application’s launch environment.';
  } else if (error?.code === 'ETIMEDOUT' || /Connection timed out|Operation timed out/i.test(diagnostic)) {
    message = 'SSH connection timed out. Check the configured host and server reachability from this device.';
  } else if (error?.code === 'ECONNREFUSED' || /Connection refused/i.test(diagnostic)) {
    message = 'The SSH connection was refused. Check the server’s SSH service and configured port.';
  } else if (error?.code === 'EHOSTUNREACH' || error?.code === 'ENETUNREACH' || /No route to host|Network is unreachable/i.test(diagnostic)) {
    message = 'SSH could not reach the server. Check network access and routing from the application’s launch environment.';
  } else if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
    message = 'The SSH process could not start. Check the system SSH executable and the application’s working directory.';
  } else if (error?.killed === true || signal) {
    message = 'The SSH status reader was terminated before returning a complete observation. Check whether the bounded read timed out or the process was interrupted.';
  } else {
    message = 'SSH status read failed without a recognized diagnostic. Compare the installed application’s launch permissions, SSH identity access and known-host configuration with the working shell connection.';
  }
  return message + metadata;
}

type SshProcess = { kill: (signal: 'SIGKILL') => unknown; stdin?: { end: (data: string) => unknown; destroy: () => unknown; on: (event: 'error', listener: (error: Error) => void) => unknown } | null; stdout?: { destroy: () => unknown } | null; stderr?: { destroy: () => unknown } | null };
export type SshStatusExecutor = (file: string, args: string[], options: { timeout: number; killSignal: 'SIGKILL'; maxBuffer: number; encoding: 'utf8' }, callback: (error: any, stdout: string, stderr: string) => void) => SshProcess;
export async function readVpsStatus(config: VpsReadConfig, relativePath: string, options: { sshExecutor?: SshStatusExecutor; timeoutMs?: number } = {}): Promise<any> {
  if (!READ_ONLY_VPS_PATHS.has(relativePath)) throw new Error('This route has no verified read-only VPS adapter.');
  if (config.transport === 'ssh') {
    if ((config.sshHost ?? 'my-vps') !== 'my-vps') throw new Error('Only the verified my-vps SSH alias is supported.');
    if (!config.sshIdentityPath || !config.sshIdentityPath.startsWith('/')) throw new Error('Configure the absolute SSH identity path for the status reader.');
    const timeout = options.timeoutMs ?? 25_000;
    const execute: SshStatusExecutor = options.sshExecutor ?? ((file, args, settings, callback) => execFile(file, args, settings, callback));
    let child: SshProcess | undefined; let settled = false;
    const dispose = () => {
      try { child?.kill('SIGKILL'); } catch { /* The child may already have exited. */ }
      for (const stream of [child?.stdin, child?.stdout, child?.stderr]) try { stream?.destroy(); } catch { /* Release every owned pipe independently. */ }
    };
    return withReadDeadline(() => new Promise((resolve, reject) => {
      try {
      child = execute('/usr/bin/ssh', ['-i', config.sshIdentityPath!, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes', 'my-vps', `python3 -c ${shellQuoteConstant(SSH_READER)}`],
        { timeout, killSignal: 'SIGKILL', maxBuffer: 2_100_000, encoding: 'utf8' }, (error, stdout, stderr) => {
          if (settled) return; settled = true;
          if (error) return reject(new Error(classifySshFailure(error, stderr)));
          try {
            const result = JSON.parse(stdout);
            if (result?._transportError) return reject(new Error(`${result._transportError}${result.httpStatus ? ` (HTTP ${result.httpStatus})` : ''}.`));
            resolve(result);
          } catch { reject(new Error('SSH status service did not return valid JSON.')); }
        });
      } catch (error) { settled = true; dispose(); reject(new Error(classifySshFailure(error as any))); return; }
      if (!settled) {
        child.stdin?.on('error', () => { if (settled) return; settled = true; dispose(); reject(new Error('The SSH status request could not be sent. No complete observation was returned.')); });
        try { child.stdin?.end(JSON.stringify({ path: relativePath, token: config.apiToken ?? '' })); }
        catch { settled = true; dispose(); reject(new Error('The SSH status request could not be sent. No complete observation was returned.')); }
      }
    }), timeout, 'The SSH status read timed out before a complete observation was returned. Refresh to retry.', { onTimeout: () => { settled = true; dispose(); } }).finally(() => { settled = true; });
  }
  if (!config.baseUrl) throw new Error('VPS status connection is not configured.');
  const base = new URL(config.baseUrl);
  if (base.username || base.password) throw new Error('Do not put credentials in the VPS URL.');
  if (base.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Use HTTPS or the verified SSH status transport. Public HTTP credentials are not sent.');
  return withReadDeadline(async signal => {
  const response = await fetch(new URL(relativePath, base), { method: 'GET', redirect: 'error', headers: { Accept: 'application/json', ...(config.apiToken ? { Authorization: `Bearer ${config.apiToken}` } : {}) }, signal });
  if (!response.ok) throw new Error(`VPS status request failed (HTTP ${response.status}).`);
  return response.json();
  }, options.timeoutMs ?? 15_000, 'The VPS status read timed out before a complete response was returned. Refresh to retry.');
}

export function expertRunObservation(payload: any) {
  if (typeof payload?.is_running !== 'boolean' || !payload.manifest || typeof payload.manifest !== 'object') throw new Error('Unrecognized Expert status response.');
  const manifest = payload.manifest;
  const reportedTimes = ['finished_at', 'updated_at', 'started_at'].map(field => ({ field: `manifest.${field}`, value: manifest[field], normalized: normalizeTimestamp(manifest[field]) }));
  const reportedTime = reportedTimes.find(time => time.normalized !== null) ?? reportedTimes.find(time => time.value !== null && time.value !== undefined);
  return { id: 'expert', name: 'Expert', status: payload.is_paused ? 'paused' : payload.is_running ? 'running' : String(manifest.status ?? 'idle'),
    stage: typeof manifest.mode === 'string' ? manifest.mode : typeof manifest.stage === 'string' ? manifest.stage : null,
    updatedAt: reportedTime?.normalized ?? null,
    updatedAtSource: reportedTime ? { field: reportedTime.field, value: reportedTime.value } : null, logs: [],
    counts: { topics: payload.topic_count ?? null, selected: payload.selected_count ?? null, approved: payload.approved_count ?? null, contextReady: manifest.context_ready ?? null, needsReview: manifest.needs_review ?? null },
    receipt: { source: 'vps:/api/expert/status', observedAt: new Date().toISOString() } };
}
export function smartRunObservation(payload: any) {
  if (typeof payload?.is_running !== 'boolean') throw new Error('Unrecognized Smart status response.');
  return { id: 'smart', name: 'Smart', status: payload.is_stopping ? 'stopping' : payload.is_running ? 'running' : String(payload.state ?? 'idle'), stage: null, updatedAt: null, logs: [],
    counts: { publishedToday: typeof payload.daily_count === 'number' ? payload.daily_count : null },
    receipt: { source: 'vps:/api/smart_status', observedAt: new Date().toISOString() } };
}
