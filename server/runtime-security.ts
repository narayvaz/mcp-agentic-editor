import { timingSafeEqual, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage } from 'node:http';

export const DEFAULT_CAPABILITIES = ['read', 'settings:write', 'evidence:write', 'model:request', 'wordpress:write', 'development:propose', 'development:validate', 'agent:run', 'agent:approve'] as const;

export function tokenMatches(expected: string, supplied: string): boolean {
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requiredCapability(method: string, requestPath: string): string {
  if (method === 'GET' || method === 'HEAD') return 'read';
  if (requestPath.startsWith('/api/agent-runtime/')) return /\/(approve|reject)$/.test(requestPath) ? 'agent:approve' : 'agent:run';
  if (requestPath === '/api/settings' || requestPath.startsWith('/api/rules') || requestPath === '/api/connector/import') return 'settings:write';
  if (/^\/api\/(wp\/post\/|seo\/inject_internal_link)/.test(requestPath)) return 'wordpress:write';
  if (/^\/api\/(evidence|questions|claims|corrections|watches|outputs)(\/|$)/.test(requestPath)) return 'evidence:write';
  if (/^\/(devops|api\/(self-mod|autoresearch))\b/.test(requestPath)) return /apply|approve|build|deploy|restore|self-heal|git-push/.test(requestPath) ? 'development:validate' : 'development:propose';
  return 'model:request';
}

export function createRuntimeSecurity(options: { token: string; port: number; capabilities?: readonly string[] }) {
  if (!/^[a-f0-9]{64}$/.test(options.token)) throw new Error('A per-launch desktop session is required. Start Azat Studio through its desktop launcher.');
  const origin = `http://127.0.0.1:${options.port}`;
  const capabilities = new Set(options.capabilities ?? DEFAULT_CAPABILITIES);
  const host = new URL(origin).host;
  const validHeaders = (headers: IncomingMessage['headers']) => {
    if (headers.host !== host) return false;
    if (headers.origin && headers.origin !== origin) return false;
    if (headers['sec-fetch-site'] === 'cross-site') return false;
    return true;
  };
  const authenticated = (headers: IncomingMessage['headers']) => {
    const value = String(headers.authorization || '');
    return validHeaders(headers) && tokenMatches(options.token, value.startsWith('Bearer ') ? value.slice(7) : '');
  };
  return {
    origin,
    capabilities: [...capabilities],
    authenticated,
    middleware(req: Request, res: Response, next: NextFunction) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; media-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
      if (!validHeaders(req.headers)) return res.status(403).json({ ok: false, error: 'This request does not belong to the local Studio session.' });
      if (!req.path.startsWith('/api/') && !req.path.startsWith('/devops/')) return next();
      res.setHeader('Cache-Control', 'no-store');
      if (req.path === '/api/health' && req.method === 'GET') return next();
      if (!authenticated(req.headers)) return res.status(401).json({ ok: false, error: 'Open this workspace in Azat Studio to authenticate.' });
      if (req.method === 'GET' && /^\/api\/automations\/[^/]+\/trigger$/.test(req.path)) return res.status(405).json({ ok: false, error: 'A read request cannot execute a job.' });
      const required = requiredCapability(req.method, req.path);
      if (!capabilities.has(required)) return res.status(403).json({ ok: false, error: `This session cannot perform ${required}.` });
      return next();
    },
    acceptSocket(request: IncomingMessage) {
      if (!validHeaders(request.headers) || request.headers.origin !== origin || !capabilities.has('read')) return false;
      const protocols = String(request.headers['sec-websocket-protocol'] || '').split(',').map(x => x.trim());
      return protocols.some(x => x.startsWith('azat-session.') && tokenMatches(options.token, x.slice('azat-session.'.length)));
    },
  };
}

export function getRuntimeIdentity(root: string) {
  const manifestPath = process.env.AZAT_BUILD_MANIFEST || path.join(root, 'build-manifest.json');
  let manifest: Record<string, unknown> = {};
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { /* A missing build identity must remain visible. */ }
  return {
    appVersion: manifest.appVersion || 'development',
    buildId: manifest.buildId || null,
    frontendBuildId: manifest.frontendHash || null,
    backendBuildId: manifest.backendHash || null,
    builtAt: manifest.builtAt || null,
    sourceHash: manifest.sourceHash || null,
    runtimeSource: process.env.AZAT_RUNTIME_SOURCE || 'standalone',
    identityStatus: manifest.buildId ? 'identified' : 'unidentified',
    developmentMode: 'isolated-proposals',
    automaticApplication: false,
    observedAt: new Date().toISOString(),
  };
}

export function createSessionToken() { return randomBytes(32).toString('hex'); }
