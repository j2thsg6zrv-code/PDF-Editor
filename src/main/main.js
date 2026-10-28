const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const isMac = process.platform === 'darwin';
let mainWindow = null;
let rendererReady = false;
let closeConfirmed = false;
let quitting = false;
// Files the OS asked us to open before the page was ready to receive them (macOS "Open With", double-click).
const pendingFiles = [];

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    title: 'Redline PDF Editor',
    backgroundColor: '#2b2d31',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Links inside PDFs open in the default browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Let the page ask about unsaved changes before the window goes away.
  mainWindow.on('close', (event) => {
    if (closeConfirmed || !rendererReady) return;
    event.preventDefault();
    mainWindow.webContents.send('app:request-close');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
    closeConfirmed = false;
  });
}

async function readPdf(filePath) {
  const data = await fs.readFile(filePath);
  return { path: filePath, name: path.basename(filePath), data: new Uint8Array(data) };
}

async function sendFileToRenderer(filePath) {
  if (!mainWindow || !rendererReady) {
    pendingFiles.push(filePath);
    return;
  }
  try {
    const file = await readPdf(filePath);
    mainWindow.webContents.send('file:opened', file);
    app.addRecentDocument(filePath);
  } catch (err) {
    dialog.showErrorBox('Could not open file', `${filePath}\n\n${err.message}`);
  }
}

async function showOpenDialog() {
  if (!mainWindow) return;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open PDF',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
  });
  if (!result.canceled) result.filePaths.forEach(sendFileToRenderer);
}

function sendCommand(command) {
  if (mainWindow) mainWindow.webContents.send('menu:command', command);
}

function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: showOpenDialog },
        { role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendCommand('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendCommand('save-as') },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => sendCommand('close-tab') },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => sendCommand('undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => sendCommand('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => sendCommand('find') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => sendCommand('zoom-in') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => sendCommand('zoom-out') },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => sendCommand('zoom-actual') },
        { label: 'Fit Width', accelerator: 'CmdOrCtrl+2', click: () => sendCommand('zoom-fit-width') },
        { label: 'Fit Page', accelerator: 'CmdOrCtrl+1', click: () => sendCommand('zoom-fit-page') },
        { type: 'separator' },
        { label: 'Toggle Thumbnails', accelerator: 'CmdOrCtrl+T', click: () => sendCommand('toggle-sidebar') },
        { label: 'Toggle Markups List', accelerator: 'CmdOrCtrl+L', click: () => sendCommand('toggle-markups-list') },
        { type: 'separator' },
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => sendCommand('next-tab') },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => sendCommand('prev-tab') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Pages',
      submenu: [
        { label: 'Rotate Clockwise', accelerator: 'CmdOrCtrl+R', click: () => sendCommand('rotate-cw') },
        { label: 'Rotate Counterclockwise', accelerator: 'CmdOrCtrl+Shift+R', click: () => sendCommand('rotate-ccw') },
        { type: 'separator' },
        { label: 'Insert Pages from File…', click: () => sendCommand('insert-pages') },
        { label: 'Extract Pages…', click: () => sendCommand('extract-pages') },
        { label: 'Delete Pages…', click: () => sendCommand('delete-pages') },
        { type: 'separator' },
        { label: 'Compare Documents…', click: () => sendCommand('compare') },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// The page tells us once its listeners are wired, then gets any files queued before that.
ipcMain.on('renderer:ready', () => {
  rendererReady = true;
  while (pendingFiles.length) sendFileToRenderer(pendingFiles.shift());
});
ipcMain.handle('dialog:open', showOpenDialog);
ipcMain.handle('app:user', () => {
  try {
    return os.userInfo().username;
  } catch {
    return '';
  }
});
ipcMain.handle('dialog:save-as', async (_event, defaultPath, kind = 'pdf') => {
  const filters = {
    pdf: [{ name: 'PDF Documents', extensions: ['pdf'] }],
    csv: [{ name: 'CSV (opens in Excel)', extensions: ['csv'] }],
  };
  const result = await dialog.showSaveDialog(mainWindow, {
    title: kind === 'csv' ? 'Export Markups' : 'Save PDF',
    defaultPath,
    filters: filters[kind] ?? filters.pdf,
  });
  return result.canceled ? null : result.filePath;
});
ipcMain.handle('dialog:unsaved', async (_event, name) => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    message: `Do you want to save the changes you made to "${name}"?`,
    detail: "Your changes will be lost if you don't save them.",
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
  });
  return ['save', 'discard', 'cancel'][response];
});
ipcMain.handle('dialog:error', (_event, title, message) => dialog.showErrorBox(title, message));
// Writes to a temporary file first so a failed save never leaves a half-written PDF.
ipcMain.handle('file:save', async (_event, filePath, data) => {
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, filePath);
  app.addRecentDocument(filePath);
});
ipcMain.on('app:close-confirmed', () => {
  closeConfirmed = true;
  if (quitting) app.quit();
  else if (mainWindow) mainWindow.close();
});
ipcMain.on('app:close-cancelled', () => {
  quitting = false;
});

app.on('before-quit', () => {
  quitting = true;
});
ipcMain.handle('file:read', (_event, filePath) => readPdf(filePath));
// Picks PDFs and hands their contents back without opening them in tabs (for inserting pages).
ipcMain.handle('dialog:pick-pdfs', async (_event, title) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title,
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
  });
  return result.canceled ? [] : Promise.all(result.filePaths.map(readPdf));
});
ipcMain.handle('dialog:confirm', async (_event, message, detail, confirmLabel) => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    message,
    detail,
    buttons: [confirmLabel, 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  });
  return response === 0;
});

// macOS delivers double-clicked / dragged-onto-dock files through this event.
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  sendFileToRenderer(filePath);
});

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  // Windows/Linux pass files on the command line.
  if (!isMac) {
    process.argv.slice(1).filter((a) => a.toLowerCase().endsWith('.pdf')).forEach(sendFileToRenderer);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      rendererReady = false;
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
