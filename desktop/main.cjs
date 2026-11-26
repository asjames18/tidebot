const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { autoUpdater } = require('electron-updater');
const { openGitReview } = require('./git-review.cjs');
const { checkServer, serverOrigin } = require('./connection.cjs');

const RELEASES_URL = 'https://github.com/asjames18/tidebot/releases';

let mainWindow = null;
let connectionWindow = null;
let connectionError = '';
let switchingServer = false;
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
  const window = connectionWindow || mainWindow;
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
});

function settingsPath() {
  return path.join(app.getPath('userData'), 'desktop-settings.json');
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    const port = Number.isInteger(parsed.port) && parsed.port >= 1024 && parsed.port <= 65535 ? parsed.port : undefined;
    let remoteOrigin;
    try { if (parsed.remoteOrigin) remoteOrigin = serverOrigin(parsed.remoteOrigin); } catch { /* ignore old invalid addresses */ }
    return { devUpdates: parsed.devUpdates !== false, port, remoteOrigin };
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

function findFreePort(preferredPort = 0) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(preferredPort, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 8787;
      srv.close(() => resolve(port));
    });
  });
}

async function chooseServerPort(preferredPort) {
  try {
    return await findFreePort(preferredPort);
  } catch (error) {
    if (!preferredPort || !['EADDRINUSE', 'EACCES'].includes(error.code)) throw error;
    return findFreePort();
  }
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

async function waitForHealth(port, child, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://127.0.0.1:${port}/api/health`;
  while (Date.now() < deadline) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
      throw new Error('The local TideBot server stopped before it was ready.');
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      // still starting
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Timed out waiting for TideBot server to start');
}

async function startServer() {
  if (serverProc?.pid && !serverProc.killed && serverProc.exitCode === null && serverProc.signalCode === null && serverPort) {
    const port = serverPort;
    await waitForHealth(port, serverProc);
    return `http://127.0.0.1:${port}`;
  }
  const port = await chooseServerPort(settings.port);
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
    TIDEBOT_DESKTOP_VERSION: app.getVersion(),
    HOST: '127.0.0.1',
    PORT: String(port),
    DB_PATH: path.join(dataDir, 'grokbot.db'),
    ENV_PATH: path.join(userData, '.env'),
    WEB_DIST_DIR: webDistDir,
    APP_URL: baseUrl,
    SERVER_URL: baseUrl,
    TIDEBOT_DESKTOP_SIGNUP_ORIGIN: baseUrl,
    DEV_LOGIN: process.env.DEV_LOGIN ?? '0',
  };

  let stderrTail = '';
  let ready = false;
  serverProc = spawn(process.execPath, [serverEntry], {
    cwd: serverCwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const child = serverProc;
  child.on('error', (err) => {
    console.error('[desktop] could not start local server:', err.message);
  });
  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[server] ${chunk}`);
  });
  child.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + String(chunk)).slice(-4000);
    process.stderr.write(`[server] ${chunk}`);
  });
  child.on('close', (code) => {
    if (serverProc === child) {
      serverProc = null;
      serverPort = null;
    }
    if (!quitting && ready && code !== 0) {
      dialog.showErrorBox(
        'TideBot Server Stopped',
        `The local TideBot server exited unexpectedly (code ${code}).\n\n${stderrTail}`,
      );
    }
  });

  await waitForHealth(port, child);
  ready = true;
  if (settings.port !== port) {
    settings = { ...settings, port };
    saveSettings(settings);
  }
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

  let canAutoInstall = true;
  if (process.platform === 'darwin') {
    const signature = spawnSync('/usr/bin/codesign', ['-d', '--verbose=2', process.execPath], {
      encoding: 'utf8',
      timeout: 2000,
    });
    canAutoInstall = signature.status === 0 && /^Authority=Developer ID Application:/m.test(signature.stderr);
  }
  autoUpdater.autoDownload = canAutoInstall;
  autoUpdater.autoInstallOnAppQuit = canAutoInstall;
  autoUpdater.allowPrerelease = settings.devUpdates;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on('update-available', async (info) => {
    if (canAutoInstall || !manualCheck) return;
    manualCheck = false;
    const res = await dialog.showMessageBox(mainWindow || undefined, {
      type: 'info',
      title: 'TideBot Update Available',
      message: `TideBot v${info.version} is available.`,
      detail: 'This Mac build needs a manual update. Download the Mac installer from GitHub Releases.',
      buttons: ['Open GitHub Releases', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (res.response === 0) void shell.openExternal(RELEASES_URL);
  });

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
    if (!canAutoInstall) return;
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
      // Keep the local server running until Electron actually quits for the update.
      manualCheck = true;
      try {
        autoUpdater.quitAndInstall();
      } catch (error) {
        autoUpdater.emit('error', error);
      }
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

  if (!canAutoInstall) return;
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
  const result = await autoUpdater.checkForUpdates().catch(() => undefined); // Failures are reported through the error event.
  if (result !== null || !manualCheck) return;

  // An inactive updater returns null without emitting an event.
  manualCheck = false;
  const res = await dialog.showMessageBox(mainWindow || undefined, {
    type: 'info',
    title: 'Manual Update Required',
    message: 'This TideBot installation needs manual updates.',
    detail: 'Download the installer for your system from GitHub Releases.',
    buttons: ['Open GitHub Releases', 'Close'],
    defaultId: 0,
    cancelId: 1,
  });
  if (res.response === 0) await shell.openExternal(RELEASES_URL);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const updateItems = [
    {
      label: 'Git Review…',
      click: openGitReview,
    },
    {
      label: 'Change Server…',
      accelerator: 'CmdOrCtrl+Shift+K',
      click: () => showConnectionWindow(),
    },
    { type: 'separator' },
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

const connectionPage = pathToFileURL(path.join(__dirname, 'connection.html')).href;

function showConnectionWindow(error = '') {
  if (connectionWindow) {
    connectionWindow.focus();
    return;
  }
  connectionError = error;
  const window = new BrowserWindow({
    width: 510,
    height: 480,
    minWidth: 390,
    minHeight: 400,
    title: 'Choose a TideBot server',
    backgroundColor: '#101620',
    parent: mainWindow || undefined,
    modal: !!mainWindow,
    webPreferences: {
      preload: path.join(__dirname, 'connection-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  connectionWindow = window;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.on('closed', () => { connectionWindow = null; });
  void window.loadURL(connectionPage);
}

async function openWorkspace(origin, local) {
  const iconPath = path.join(__dirname, 'build', 'icon.png');
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 390,
    minHeight: 600,
    title: 'TideBot',
    show: false,
    backgroundColor: '#0b0e14',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      ...(local ? { preload: path.join(__dirname, 'preload.cjs') }
        : { partition: 'persist:tidebot-server-' + createHash('sha256').update(origin).digest('hex') }),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const isSameOrigin = (target) => {
    try { return new URL(target).origin === origin; } catch { return false; }
  };
  const openLink = (target) => {
    try {
      const url = new URL(target);
      if (['https:', 'http:', 'mailto:'].includes(url.protocol)) {
        void shell.openExternal(url.href).catch((error) => console.error('[desktop] could not open link:', error.message));
      }
    } catch { /* Ignore invalid links. */ }
  };
  const keepNavigationOnServer = (event, target) => {
    if (isSameOrigin(target)) return;
    event.preventDefault();
    if (mainWindow === window) openLink(target);
  };
  if (!local) {
    // Remote sites never inherit the desktop bridge or unrestricted browser permissions.
    const session = window.webContents.session;
    session.setPermissionCheckHandler((_contents, permission, requester, details) =>
      isSameOrigin(requester) && (permission === 'clipboard-sanitized-write' ||
        (permission === 'media' && details.mediaType === 'audio')));
    session.setPermissionRequestHandler((_contents, permission, callback, details) =>
      callback(isSameOrigin(details.requestingUrl) && (permission === 'clipboard-sanitized-write' ||
        (permission === 'media' && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio'))));
  }
  window.webContents.on('will-navigate', keepNavigationOnServer);
  window.webContents.on('will-redirect', keepNavigationOnServer);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (local && isSameOrigin(url)) return { action: 'allow' };
    openLink(url);
    return { action: 'deny' };
  });
  window.on('closed', () => { if (mainWindow === window) mainWindow = null; });

  try {
    await window.loadURL(origin);
  } catch {
    window.destroy();
    throw new Error('TideBot could not load the selected server.');
  }
  const previous = mainWindow;
  mainWindow = window;
  connectionWindow?.close();
  previous?.close();
  window.show();
}

function fromConnectionWindow(event) {
  return connectionWindow && event.sender === connectionWindow.webContents &&
    event.senderFrame === connectionWindow.webContents.mainFrame && event.senderFrame.url === connectionPage;
}

ipcMain.handle('tidebot:connection-settings', (event) => {
  if (!fromConnectionWindow(event)) throw new Error('Unexpected window.');
  return { origin: settings.remoteOrigin, error: connectionError };
});
ipcMain.handle('tidebot:connect-server', async (event, address) => {
  if (!fromConnectionWindow(event)) throw new Error('Unexpected window.');
  if (switchingServer) return { error: 'TideBot is already connecting.' };
  switchingServer = true;
  try {
    const local = address === null;
    const origin = local ? await startServer() : await checkServer(address);
    await openWorkspace(origin, local);
    settings = { ...settings, remoteOrigin: local ? undefined : origin };
    saveSettings(settings);
    return {};
  } catch (err) {
    return { error: err.message };
  } finally {
    switchingServer = false;
  }
});

function fromLocalWorkspace(event) {
  return mainWindow && !settings.remoteOrigin && event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame &&
    new URL(event.senderFrame.url).origin === `http://127.0.0.1:${serverPort}`;
}

ipcMain.handle('tidebot:open-git-review', (event) => {
  if (fromLocalWorkspace(event)) openGitReview();
});

ipcMain.handle('tidebot:check-updates', (event) => {
  if (fromLocalWorkspace(event)) return triggerUpdateCheck();
});
ipcMain.handle('tidebot:get-version', (event) => {
  if (fromLocalWorkspace(event)) return app.getVersion();
});

async function restoreWorkspace() {
  if (switchingServer) return;
  switchingServer = true;
  try {
    if (settings.remoteOrigin) await openWorkspace(await checkServer(settings.remoteOrigin), false);
    else if (settings.port) await openWorkspace(await startServer(), true);
    else showConnectionWindow();
  } catch (err) {
    showConnectionWindow(err.message);
  } finally {
    switchingServer = false;
  }
}

app.whenReady().then(() => {
  settings = loadSettings();
  buildMenu();
  setupAutoUpdater();
  void restoreWorkspace();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void restoreWorkspace();
});

app.on('before-quit', () => {
  quitting = true;
  if (updateTimer) clearInterval(updateTimer);
  stopServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !switchingServer) app.quit();
});
