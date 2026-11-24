const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');

const RELEASES_URL = 'https://github.com/asjames18/tidebot/releases';

let mainWindow = null;
let serverProc = null;
let serverPort = null;
let quitting = false;
let manualCheck = false;
let updateTimer = null;

// Prevent multiple instances from fighting over the same SQLite database.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

function settingsPath() {
  return path.join(app.getPath('userData'), 'desktop-settings.json');
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return { devUpdates: parsed.devUpdates !== false };
  } catch {
    return { devUpdates: true };
  }
}

function saveSettings(next) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.error('[desktop] failed to save settings:', err);
  }
}

let settings = { devUpdates: true };

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 8787;
      srv.close(() => resolve(port));
    });
  });
}

function resolvePaths() {
  if (app.isPackaged) {
    return {
      serverEntry: path.join(process.resourcesPath, 'server', 'dist', 'index.js'),
      webDistDir: path.join(process.resourcesPath, 'web', 'dist'),
      serverCwd: process.resourcesPath,
    };
  }
  const repoRoot = path.resolve(__dirname, '..');
  return {
    serverEntry: path.join(repoRoot, 'server', 'dist', 'index.js'),
    webDistDir: path.join(repoRoot, 'web', 'dist'),
    serverCwd: repoRoot,
  };
}

async function waitForHealth(port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/api/health`;
  while (Date.now() < deadline) {
    if (serverProc && serverProc.exitCode !== null) {
      throw new Error(`TideBot server exited early with code ${serverProc.exitCode}`);
    }
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // still starting
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Timed out waiting for TideBot server to start');
}

async function startServer() {
  const port = await findFreePort();
  serverPort = port;
  const userData = app.getPath('userData');
  const dataDir = path.join(userData, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const { serverEntry, webDistDir, serverCwd } = resolvePaths();
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Missing compiled server at ${serverEntry}. Run "npm run build" first.`);
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    HOST: '127.0.0.1',
    PORT: String(port),
    DB_PATH: path.join(dataDir, 'grokbot.db'),
    ENV_PATH: path.join(userData, '.env'),
    WEB_DIST_DIR: webDistDir,
    APP_URL: baseUrl,
    SERVER_URL: baseUrl,
    DEV_LOGIN: process.env.DEV_LOGIN ?? '1',
  };

  let stderrTail = '';
  serverProc = spawn(process.execPath, [serverEntry], {
    cwd: serverCwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProc.stdout.on('data', (chunk) => {
    process.stdout.write(`[server] ${chunk}`);
  });
  serverProc.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + String(chunk)).slice(-4000);
    process.stderr.write(`[server] ${chunk}`);
  });
  serverProc.on('exit', (code) => {
    if (!quitting && code !== 0) {
      dialog.showErrorBox(
        'TideBot Server Stopped',
        `The local TideBot server exited unexpectedly (code ${code}).\n\n${stderrTail}`,
      );
    }
  });

  await waitForHealth(port);
  return baseUrl;
}

function stopServer() {
  if (!serverProc || serverProc.killed || serverProc.exitCode !== null) return;
  try {
    serverProc.kill('SIGTERM');
  } catch {
    // already stopped
  }
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = settings.devUpdates;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on('update-not-available', () => {
    if (!manualCheck) return;
    manualCheck = false;
    dialog.showMessageBox(mainWindow || undefined, {
      type: 'info',
      title: 'TideBot is Up to Date',
      message: `You are running the latest version (v${app.getVersion()}).`,
      detail: settings.devUpdates
        ? 'Development updates from GitHub main are enabled.'
        : 'Stable release updates are enabled.',
    });
  });

  autoUpdater.on('update-downloaded', async (info) => {
    manualCheck = false;
    const res = await dialog.showMessageBox(mainWindow || undefined, {
      type: 'info',
      title: 'TideBot Update Ready',
      message: `TideBot v${info.version} has been downloaded.`,
      detail: 'Restart TideBot now to apply the update, or it will install automatically when you quit.',
      buttons: ['Restart & Update', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (res.response === 0) {
      quitting = true;
      stopServer();
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on('error', async (err) => {
    console.error('[updater] error:', err?.message || err);
    if (!manualCheck) return;
    manualCheck = false;
    const res = await dialog.showMessageBox(mainWindow || undefined, {
      type: 'warning',
      title: 'Update Check Failed',
      message: 'Could not install update automatically.',
      detail: `${err?.message || String(err)}\n\nYou can always download the latest build directly from GitHub Releases.`,
      buttons: ['Open GitHub Releases', 'Close'],
      defaultId: 0,
      cancelId: 1,
    });
    if (res.response === 0) void shell.openExternal(RELEASES_URL);
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5_000);

  updateTimer = setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 2 * 60 * 60 * 1000);
}

async function triggerUpdateCheck() {
  if (!app.isPackaged) {
    const res = await dialog.showMessageBox(mainWindow || undefined, {
      type: 'info',
      title: 'Development Mode',
      message: `Running TideBot v${app.getVersion()} unpackaged.`,
      detail: 'Auto-updates run in packaged desktop installers from GitHub Releases.',
      buttons: ['Open GitHub Releases', 'OK'],
      defaultId: 1,
    });
    if (res.response === 0) void shell.openExternal(RELEASES_URL);
    return;
  }
  manualCheck = true;
  autoUpdater.allowPrerelease = settings.devUpdates;
  await autoUpdater.checkForUpdates();
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const updateItems = [
    {
      label: 'Check for Updates…',
      click: () => void triggerUpdateCheck(),
    },
    {
      label: 'Receive Development Updates (GitHub main)',
      type: 'checkbox',
      checked: settings.devUpdates,
      click: (item) => {
        settings = { ...settings, devUpdates: Boolean(item.checked) };
        saveSettings(settings);
        if (app.isPackaged) {
          autoUpdater.allowPrerelease = settings.devUpdates;
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Open Data Folder',
      click: () => void shell.openPath(app.getPath('userData')),
    },
    {
      label: 'Open GitHub Releases',
      click: () => void shell.openExternal(RELEASES_URL),
    },
  ];

  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            ...updateItems,
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: 'File',
      submenu: [
        ...(!isMac ? [...updateItems, { type: 'separator' }] : []),
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(url) {
  const iconPath = path.join(__dirname, 'build', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 390,
    minHeight: 600,
    title: 'TideBot',
    backgroundColor: '#0b0e14',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    try {
      const parsed = new URL(targetUrl);
      const isLocal = (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') && String(parsed.port) === String(serverPort);
      if (isLocal) return { action: 'allow' };
    } catch {
      // fall through to external
    }
    void shell.openExternal(targetUrl);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  void mainWindow.loadURL(url);
}

ipcMain.handle('tidebot:check-updates', () => triggerUpdateCheck());
ipcMain.handle('tidebot:get-version', () => app.getVersion());

app.whenReady().then(async () => {
  settings = loadSettings();
  buildMenu();
  try {
    const url = await startServer();
    createWindow(url);
    setupAutoUpdater();
  } catch (err) {
    dialog.showErrorBox('Failed to Start TideBot', String(err?.message || err));
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverPort) {
    createWindow(`http://127.0.0.1:${serverPort}`);
  }
});

app.on('before-quit', () => {
  quitting = true;
  if (updateTimer) clearInterval(updateTimer);
  stopServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
