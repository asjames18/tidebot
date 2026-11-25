const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tidebotGitReview', {
  choose: () => ipcRenderer.invoke('tidebot:git-choose'),
  refresh: () => ipcRenderer.invoke('tidebot:git-refresh'),
  diff: (name) => ipcRenderer.invoke('tidebot:git-diff', name),
  reveal: () => ipcRenderer.invoke('tidebot:git-reveal'),
  newWorktree: () => ipcRenderer.invoke('tidebot:git-new-worktree'),
});
