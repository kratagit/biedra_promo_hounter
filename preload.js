const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  startSearch: (keyword, discordEnabled) =>
    ipcRenderer.invoke('start-search', { keyword, discordEnabled }),
  stopSearch: () => ipcRenderer.invoke('stop-search'),
  onSearchEvent: (callback) =>
    ipcRenderer.on('search-event', (_event, data) => callback(data)),
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
});
