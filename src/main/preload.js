const { contextBridge, ipcRenderer, webUtils } = require('electron');

// The only bridge between the page and the operating system.
contextBridge.exposeInMainWorld('desktop', {
  openDialog: () => ipcRenderer.invoke('dialog:open'),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  pathForFile: (file) => webUtils.getPathForFile(file),
  ready: () => ipcRenderer.send('renderer:ready'),
  onFileOpened: (callback) => ipcRenderer.on('file:opened', (_event, file) => callback(file)),
  onMenuCommand: (callback) => ipcRenderer.on('menu:command', (_event, command) => callback(command)),
});
