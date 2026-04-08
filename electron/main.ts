import { app, BrowserWindow, ipcMain } from 'electron';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PREFERRED_PORT = Number(process.env.PORT || 3000);

type UpdaterStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';

interface UpdaterState {
  status: UpdaterStatus;
  currentVersion: string;
  availableVersion: string | null;
  progress: number;
  message: string;
  lastCheckedAt: string | null;
}

const updaterState: UpdaterState = {
  status: 'idle',
  currentVersion: app.getVersion(),
  availableVersion: null,
  progress: 0,
  message: 'Ready.',
  lastCheckedAt: null,
};

let serverReadyPromise: Promise<string> | null = null;
let updaterInitialized = false;

function ensureSafeCwd() {
  try {
    process.cwd();
    return;
  } catch {
    const fallbackDir = app.getPath('userData');
    fs.mkdirSync(fallbackDir, { recursive: true });
    process.chdir(fallbackDir);
  }
}

function broadcastUpdaterState() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('updater:state', updaterState);
    }
  }
}

function setUpdaterState(patch: Partial<UpdaterState>) {
  Object.assign(updaterState, patch);
  broadcastUpdaterState();
}

function isUpdaterSupported(): boolean {
  return app.isPackaged;
}

function setupAutoUpdater() {
  if (updaterInitialized || !isUpdaterSupported()) return;
  updaterInitialized = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    setUpdaterState({
      status: 'checking',
      message: 'Checking for updates...',
      lastCheckedAt: new Date().toISOString(),
      progress: 0,
    });
  });

  autoUpdater.on('update-available', (info) => {
    setUpdaterState({
      status: 'available',
      availableVersion: info.version || null,
      message: `Update ${info.version || ''} is available.`,
      progress: 0,
    });
  });

  autoUpdater.on('update-not-available', () => {
    setUpdaterState({
      status: 'idle',
      availableVersion: null,
      message: 'You are up to date.',
      progress: 0,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    setUpdaterState({
      status: 'downloading',
      progress: Math.max(0, Math.min(100, progress.percent || 0)),
      message: `Downloading update... ${Math.round(progress.percent || 0)}%`,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    setUpdaterState({
      status: 'downloaded',
      availableVersion: info.version || updaterState.availableVersion,
      progress: 100,
      message: 'Update downloaded. Restart app to install.',
    });
  });

  autoUpdater.on('error', (error) => {
    setUpdaterState({
      status: 'error',
      message: error?.message || String(error),
      progress: 0,
    });
  });
}

function getFreeLocalPort(preferredPort: number): Promise<number> {
  const tryPort = (port: number) =>
    new Promise<number>((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.on('error', () => reject(new Error('in-use')));
      server.listen({ host: '127.0.0.1', port }, () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          server.close(() => reject(new Error('invalid-address')));
          return;
        }
        const freePort = address.port;
        server.close((closeErr) => {
          if (closeErr) reject(closeErr);
          else resolve(freePort);
        });
      });
    });

  return tryPort(preferredPort).catch(() => tryPort(0));
}

function waitForHealthCheck(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          resolve();
          return;
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for embedded server at ${url}`));
          return;
        }
        setTimeout(check, 500);
      });

      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for embedded server at ${url}`));
          return;
        }
        setTimeout(check, 500);
      });
    };

    check();
  });
}

async function startEmbeddedServer(): Promise<string> {
  if (!serverReadyPromise) {
    serverReadyPromise = (async () => {
      process.env.NODE_ENV = 'production';
      process.env.HOST = '127.0.0.1';
      ensureSafeCwd();
      const freePort = await getFreeLocalPort(Number.isFinite(PREFERRED_PORT) ? PREFERRED_PORT : 3000);
      process.env.PORT = String(freePort);

      const serverEntry = path.join(app.getAppPath(), 'dist-server', 'server.js');
      await import(pathToFileURL(serverEntry).href);

      const baseUrl = `http://127.0.0.1:${freePort}`;
      await waitForHealthCheck(`${baseUrl}/api/health`);
      return baseUrl;
    })();
  }

  return serverReadyPromise;
}

async function createWindow() {
  const bundledPreload = path.join(__dirname, 'preload.js');
  const fallbackPreload = path.join(__dirname, 'preload.ts');
  const preloadPath = fs.existsSync(bundledPreload) ? bundledPreload : fallbackPreload;

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Azat Studio',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    await mainWindow.loadURL(`http://localhost:${PREFERRED_PORT}`);
    mainWindow.webContents.openDevTools();
  } else {
    const baseUrl = await startEmbeddedServer();
    await mainWindow.loadURL(baseUrl);
  }

  if (isUpdaterSupported()) {
    setupAutoUpdater();
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((error) => {
        setUpdaterState({ status: 'error', message: String(error) });
      });
    }, 1200);
  }
}

ipcMain.handle('updater:get-state', async () => {
  return updaterState;
});

ipcMain.handle('updater:check', async () => {
  if (!isUpdaterSupported()) {
    return { ok: false, message: 'Updater is available only in packaged desktop builds.', state: updaterState };
  }

  try {
    setupAutoUpdater();
    await autoUpdater.checkForUpdates();
    return { ok: true, state: updaterState };
  } catch (error) {
    setUpdaterState({ status: 'error', message: String(error) });
    return { ok: false, message: String(error), state: updaterState };
  }
});

ipcMain.handle('updater:download', async () => {
  if (!isUpdaterSupported()) {
    return { ok: false, message: 'Updater is available only in packaged desktop builds.', state: updaterState };
  }

  try {
    setupAutoUpdater();
    await autoUpdater.downloadUpdate();
    return { ok: true, state: updaterState };
  } catch (error) {
    setUpdaterState({ status: 'error', message: String(error) });
    return { ok: false, message: String(error), state: updaterState };
  }
});

ipcMain.handle('updater:install', async () => {
  if (!isUpdaterSupported()) {
    return { ok: false, message: 'Updater is available only in packaged desktop builds.', state: updaterState };
  }

  if (updaterState.status !== 'downloaded') {
    return { ok: false, message: 'No downloaded update is ready to install.', state: updaterState };
  }

  setTimeout(() => {
    autoUpdater.quitAndInstall();
  }, 250);

  return { ok: true, state: updaterState };
});

app.whenReady().then(() => {
  createWindow().catch((error) => {
    console.error('Failed to create app window:', error);
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error) => {
        console.error('Failed to recreate app window:', error);
      });
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
