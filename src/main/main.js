const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const fs = require('fs/promises');
const path = require('path');

const isMac = process.platform === 'darwin';
let mainWindow = null;
let rendererReady = false;
// Files the OS asked us to open before the page was ready to receive them (macOS "Open With", double-click).
const pendingFiles = [];

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    title: 'PDF Editor',
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

  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
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
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => sendCommand('close-tab') },
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'copy' },
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
        { type: 'separator' },
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: () => sendCommand('next-tab') },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: () => sendCommand('prev-tab') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
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
ipcMain.handle('file:read', (_event, filePath) => readPdf(filePath));

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
