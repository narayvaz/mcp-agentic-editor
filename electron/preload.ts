import { contextBridge, ipcRenderer } from 'electron';

type UpdaterStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';

interface DesktopUpdaterState {
  status: UpdaterStatus;
  currentVersion: string;
  availableVersion: string | null;
  progress: number;
  message: string;
  lastCheckedAt: string | null;
}

interface DesktopUpdaterResult {
  ok: boolean;
  message?: string;
  state: DesktopUpdaterState;
}

contextBridge.exposeInMainWorld('desktopUpdater', {
  getState: () => ipcRenderer.invoke('updater:get-state') as Promise<DesktopUpdaterState>,
  check: () => ipcRenderer.invoke('updater:check') as Promise<DesktopUpdaterResult>,
  download: () => ipcRenderer.invoke('updater:download') as Promise<DesktopUpdaterResult>,
  install: () => ipcRenderer.invoke('updater:install') as Promise<DesktopUpdaterResult>,
  onState: (callback: (state: DesktopUpdaterState) => void) => {
    const listener = (_event: unknown, state: DesktopUpdaterState) => callback(state);
    ipcRenderer.on('updater:state', listener);
    return () => ipcRenderer.removeListener('updater:state', listener);
  },
});
