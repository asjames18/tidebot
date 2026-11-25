const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tidebotConnection', {
  settings: () => ipcRenderer.invoke('tidebot:connection-settings'),
  connect: (address) => ipcRenderer.invoke('tidebot:connect-server', address),
});
