import { publicHttpUrl } from './editor-workflows';
import { normalizeTimestamp } from '../../shared/timestamps';
import { withReadDeadline } from '../../shared/deadline';
import React, { createContext, useContext, useEffect, useState } from 'react';

export interface StorySelection {
  kind: 'wordpress' | 'evidence'; id: string; title: string; siteId?: string;
  language?: string; url?: string; revision?: string | number; summary?: string;
}
export function readStored<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
export function useStored<T>(key: string, fallback: T): [T, React.Dispatch<React.SetStateAction<T>>, string] {
  const [value, setValue] = useState<T>(() => readStored(key, fallback));
  const [error, setError] = useState('');
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); setError(''); } catch { setError('Local storage is full or unavailable. Export your work before closing.'); } }, [key, value]);
  return [value, setValue, error];
}
const StudioContext = createContext<{ selection: StorySelection | null; selectStory: (story: StorySelection | null) => void }>({ selection: null, selectStory: () => {} });
export function StudioProvider({ children }: {children: React.ReactNode}) {
  const [selection, selectStory, storageError] = useStored<StorySelection | null>('azat.studio.selection.v1', null);
  return <StudioContext.Provider value={{selection, selectStory}}>{storageError && <div role="alert" className="storage-alert">{storageError}</div>}{children}</StudioContext.Provider>;
}
export function useStudio() { return useContext(StudioContext); }
export function stripMarkup(value: string = '') { const doc = new DOMParser().parseFromString(value, 'text/html'); return doc.body.textContent || ''; }
export function formatTime(value?: unknown) {
  const normalized = normalizeTimestamp(value);
  if (!normalized) return 'Unknown';
  if (!normalized.endsWith('Z')) return `${normalized.replace('T', ' ')} (timezone not reported)`;
  return new Date(normalized).toLocaleString([], {timeZone:'Asia/Yerevan', dateStyle:'medium', timeStyle:'short'});
}
export async function request<T = any>(url: string, init?: RequestInit): Promise<T> {
  const read = async (options?: RequestInit): Promise<T> => {
  const response = await fetch(url, options); const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error(`This capability is not available from the running backend (HTTP ${response.status}).`);
  const data = await response.json();
  if (!response.ok || data.ok === false) { const error: any = new Error(data.error || data.message || `Request failed (${response.status}).`); error.status = response.status; error.current = data.current; error.code = data.code; error.retryable = data.retryable; error.requestId = data.requestId; throw error; }
  return data;
  };
  const pathname = new URL(url, 'http://studio.local').pathname;
  const boundedRead = (!init?.method || init.method.toUpperCase() === 'GET') && ['/api/production/status', '/api/pipeline/status', '/api/automations'].includes(pathname);
  if (pathname === '/api/agent' && init?.method?.toUpperCase() === 'POST') return withReadDeadline(signal => read({ ...init, signal }), 130_000, 'The Assistant request timed out. Your question is retained; retry when ready.', { signal: init.signal ?? undefined });
  return boundedRead ? withReadDeadline(signal => read({ ...init, signal }), 40_000, 'The production status check timed out. Refresh to try again.', { signal: init?.signal ?? undefined }) : read(init);
}
export const jsonBody = (method: string, body: unknown): RequestInit => ({method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
export function downloadJson(name: string, value: unknown) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type:'application/json'})); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url); }
export const safeUrl = publicHttpUrl;
