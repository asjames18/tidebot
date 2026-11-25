const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tidebotDesktop', {
  platform: process.platform,
  checkForUpdates: () => ipcRenderer.invoke('tidebot:check-updates'),
  openGitReview: () => ipcRenderer.invoke('tidebot:open-git-review'),
  getVersion: () => ipcRenderer.invoke('tidebot:get-version'),
});
