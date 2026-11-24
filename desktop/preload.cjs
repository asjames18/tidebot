const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tidebotDesktop', {
  platform: process.platform,
  checkForUpdates: () => ipcRenderer.invoke('tidebot:check-updates'),
  getVersion: () => ipcRenderer.invoke('tidebot:get-version'),
});
