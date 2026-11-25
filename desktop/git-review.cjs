const { BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const git = require('./git-repository.cjs');

const reviewPage = pathToFileURL(path.join(__dirname, 'git-review.html')).href;
let window = null;
let repository = null;

function openGitReview() {
  if (window) {
    if (window.isMinimized()) window.restore();
    window.focus();
    return;
  }
  window = new BrowserWindow({
    width: 1050,
    height: 740,
    minWidth: 620,
    minHeight: 460,
    title: 'TideBot Git Review',
    backgroundColor: '#101620',
    webPreferences: {
      preload: path.join(__dirname, 'git-review-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.on('closed', () => { window = null; repository = null; });
  void window.loadURL(reviewPage);
}

function handle(channel, operation) {
  ipcMain.handle(`tidebot:git-${channel}`, async (event, ...args) => {
    if (!window || event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== reviewPage) {
      throw new Error('Unexpected window.');
    }
    try {
      return { value: await operation(...args) };
    } catch (error) {
      return { error: error.message };
    }
  });
}

async function pickFolder(title, buttonLabel) {
  const result = await dialog.showOpenDialog(window, { title, buttonLabel, properties: ['openDirectory'] });
  return result.canceled ? undefined : result.filePaths[0];
}

function selectedRepository() {
  if (!repository) throw new Error('Choose a Git repository first.');
  return repository;
}

async function snapshot() {
  const directory = selectedRepository();
  return { directory, ...await git.changes(directory) };
}

handle('choose', async () => {
  const folder = await pickFolder('Choose a Git repository', 'Open repository');
  if (!folder) return null;
  const directory = await git.openRepository(folder);
  const result = await git.changes(directory);
  repository = directory;
  return { directory, ...result };
});

handle('refresh', snapshot);
handle('diff', (name) => git.diff(selectedRepository(), name));
handle('reveal', async () => {
  const error = await shell.openPath(selectedRepository());
  if (error) throw new Error(error);
});
handle('new-worktree', async () => {
  const original = selectedRepository();
  const parent = await pickFolder('Choose where to create the new worktree', 'Create worktree here');
  if (!parent) return null;
  const directory = await git.createWorktree(original, parent);
  const result = await git.changes(directory);
  repository = directory;
  return { directory, ...result };
});

module.exports = { openGitReview };
