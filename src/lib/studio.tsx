import { publicHttpUrl } from './editor-workflows';
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
export function formatTime(value?: string | null) { if (!value) return 'Not recorded'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], {timeZone:'Asia/Yerevan', dateStyle:'medium', timeStyle:'short'}); }
export async function request<T = any>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init); const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) throw new Error(`This capability is not available from the running backend (HTTP ${response.status}).`);
  const data = await response.json();
  if (!response.ok || data.ok === false) { const error: any = new Error(data.error || data.message || `Request failed (${response.status}).`); error.status = response.status; error.current = data.current; throw error; }
  return data;
}
export const jsonBody = (method: string, body: unknown): RequestInit => ({method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
export function downloadJson(name: string, value: unknown) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type:'application/json'})); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url); }
export const safeUrl = publicHttpUrl;
