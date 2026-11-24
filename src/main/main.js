const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const path = require('path');
const { RecentFiles } = require('./recent-files');

const isMac = process.platform === 'darwin';
let mainWindow = null;
let rendererReady = false;
let closeConfirmed = false;
let quitting = false;
// Files the OS asked us to open before the page was ready to receive them (macOS "Open With", double-click).
const pendingFiles = [];
let recentFiles = null; // created once the app is ready and knows its user-data folder

// ---------- Shutdown ----------
// On Windows the app has been seen lingering in the background after its window
// closed, holding its install files open. Quitting therefore never waits on
// anything open-ended: once quitting starts, a watchdog forces the process to
// exit after a few seconds whatever is still running, and each step is logged
// so a hang that does happen shows how far shutdown got.
const QUIT_TIMEOUT_MS = 4000;
let quitWatchdog = null;

function logShutdown(step) {
  try {
    const file = path.join(app.getPath('userData'), 'shutdown.log');
    let previous = '';
    try {
      previous = fsSync.readFileSync(file, 'utf8').split('\n').slice(-200).join('\n'); // keep it small
    } catch {
      // first run: no log yet
    }
    fsSync.writeFileSync(file, `${previous}${new Date().toISOString()} [${process.pid}] ${step}\n`);
  } catch {
    // Logging must never get in the way of quitting.
  }
}

function startQuitWatchdog(reason) {
  if (quitWatchdog) return;
  logShutdown(`quit started (${reason})`);
  quitWatchdog = setTimeout(() => {
    logShutdown('quit timed out, forcing exit');
    app.exit(0);
    // app.exit should end the process; if even that stalls, end it from Node.
    setTimeout(() => process.exit(0), 1000);
  }, QUIT_TIMEOUT_MS);
}

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

  let pageUnresponsive = false;
  // Let the page ask about unsaved changes before the window goes away. If the page has
  // crashed or stopped responding it can't answer, so the window closes rather than staying stuck.
  mainWindow.on('close', (event) => {
    if (closeConfirmed || !rendererReady || pageUnresponsive) return;
    event.preventDefault();
    mainWindow.webContents.send('app:request-close');
  });

  mainWindow.on('unresponsive', () => (pageUnresponsive = true));
  mainWindow.on('responsive', () => (pageUnresponsive = false));
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logShutdown(`page process gone (${details.reason})`);
    rendererReady = false;
  });

  mainWindow.on('closed', () => {
    logShutdown('window closed');
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
    rememberRecent(filePath);
  } catch (err) {
    // A file that has been moved or deleted drops off the Open Recent list.
    if (err.code === 'ENOENT' && recentFiles) {
      recentFiles.remove(filePath);
      buildMenu();
    }
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

function rememberRecent(filePath) {
  app.addRecentDocument(filePath); // Dock menu on macOS, jump list on Windows
  if (recentFiles && recentFiles.add(filePath)) buildMenu();
}

function recentFilesMenu() {
  const files = recentFiles ? recentFiles.list() : [];
  const items = files.map((filePath) => ({
    label: path.basename(filePath),
    sublabel: path.dirname(filePath), // shown on Windows; macOS ignores it
    toolTip: filePath,
    click: () => sendFileToRenderer(filePath),
  }));
  if (!items.length) items.push({ label: 'No Recent Files', enabled: false });
  items.push(
    { type: 'separator' },
    {
      label: 'Clear Menu',
      enabled: files.length > 0,
      click: () => {
        recentFiles.clear();
        app.clearRecentDocuments();
        buildMenu();
      },
    },
  );
  return items;
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
        { label: 'Open Recent', submenu: recentFilesMenu() },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendCommand('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendCommand('save-as') },
        { type: 'separator' },
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => sendCommand('print') },
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
// Opens the system print dialog for the page, which by now holds only the sheets to print.
ipcMain.handle('app:print', (event) => {
  return new Promise((resolve) => {
    event.sender.print({ silent: false, printBackground: true, margins: { marginType: 'none' } }, (success, reason) => {
      if (!success && reason && reason !== 'cancelled' && reason !== 'Print job canceled') {
        dialog.showErrorBox('Could not print', reason);
      }
      resolve(success);
    });
  });
});
ipcMain.handle('dialog:error', (_event, title, message) => dialog.showErrorBox(title, message));
// Writes to a temporary file first so a failed save never leaves a half-written PDF.
// On Windows a virus scanner often has the fresh temporary file open for a moment, which
// makes the rename fail with EPERM/EBUSY, so it is retried briefly. The temporary file is
// removed if the save fails, so nothing is left behind holding the folder.
ipcMain.handle('file:save', async (_event, filePath, data) => {
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  try {
    await fs.writeFile(tmp, data);
    await renameWithRetry(tmp, filePath);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  rememberRecent(filePath);
});

async function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.rename(from, to);
    } catch (err) {
      if (attempt >= 10 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

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
// Past this point every window has closed and nothing can stop the quit.
app.on('will-quit', () => startQuitWatchdog('will-quit'));
app.on('quit', (_event, exitCode) => logShutdown(`quit (exit code ${exitCode})`));
ipcMain.handle('file:read', (_event, filePath) => readPdf(filePath));
// Files dropped onto the window open through the same path as File > Open, so they are remembered too.
ipcMain.on('file:open-path', (_event, filePath) => sendFileToRenderer(filePath));
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

// Windows and Linux start a second copy of the app when a PDF is double-clicked
// while it is already open; hand that file to the open window instead. The second
// copy exits at once: app.quit() here would still let it reach 'ready' and open
// a window of its own, leaving an extra process behind.
const isSecondCopy = !isMac && !app.requestSingleInstanceLock();
if (isSecondCopy) {
  app.exit(0);
} else {
  app.on('second-instance', (_event, argv) => {
    argv.slice(1).filter((a) => a.toLowerCase().endsWith('.pdf')).forEach(sendFileToRenderer);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

if (!isSecondCopy) app.whenReady().then(() => {
  recentFiles = new RecentFiles(path.join(app.getPath('userData'), 'recent-files.json'));
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
  if (isMac) return;
  startQuitWatchdog('last window closed');
  app.quit();
});
