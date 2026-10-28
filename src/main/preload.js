const { contextBridge, ipcRenderer, webUtils } = require('electron');

// The only bridge between the page and the operating system.
contextBridge.exposeInMainWorld('desktop', {
  openDialog: () => ipcRenderer.invoke('dialog:open'),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  pathForFile: (file) => webUtils.getPathForFile(file),
  ready: () => ipcRenderer.send('renderer:ready'),
  userName: () => ipcRenderer.invoke('app:user'),
  saveAsDialog: (defaultPath, kind) => ipcRenderer.invoke('dialog:save-as', defaultPath, kind),
  askUnsaved: (name) => ipcRenderer.invoke('dialog:unsaved', name),
  showError: (title, message) => ipcRenderer.invoke('dialog:error', title, message),
  saveFile: (filePath, data) => ipcRenderer.invoke('file:save', filePath, data),
  confirmClose: () => ipcRenderer.send('app:close-confirmed'),
  cancelClose: () => ipcRenderer.send('app:close-cancelled'),
  onRequestClose: (callback) => ipcRenderer.on('app:request-close', () => callback()),
  onFileOpened: (callback) => ipcRenderer.on('file:opened', (_event, file) => callback(file)),
  onMenuCommand: (callback) => ipcRenderer.on('menu:command', (_event, command) => callback(command)),
});
