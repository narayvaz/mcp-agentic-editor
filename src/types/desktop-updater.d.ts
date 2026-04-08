export type DesktopUpdaterStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';

export interface DesktopUpdaterState {
  status: DesktopUpdaterStatus;
  currentVersion: string;
  availableVersion: string | null;
  progress: number;
  message: string;
  lastCheckedAt: string | null;
}

export interface DesktopUpdaterResult {
  ok: boolean;
  message?: string;
  state: DesktopUpdaterState;
}

export interface DesktopUpdaterAPI {
  getState: () => Promise<DesktopUpdaterState>;
  check: () => Promise<DesktopUpdaterResult>;
  download: () => Promise<DesktopUpdaterResult>;
  install: () => Promise<DesktopUpdaterResult>;
  onState: (callback: (state: DesktopUpdaterState) => void) => () => void;
}

declare global {
  interface Window {
    desktopUpdater?: DesktopUpdaterAPI;
  }
}

export {};
