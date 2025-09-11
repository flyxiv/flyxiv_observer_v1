const { app, BrowserWindow, session, ipcMain, desktopCapturer, screen } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');

// Allow screen capture from non-https dev origin (Chromium flags)
try {
  app.commandLine.appendSwitch('allow-http-screen-capture');
  app.commandLine.appendSwitch('enable-usermedia-screen-capturing');
  // Encourage GPU in Chromium/Electron
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-unsafe-webgpu');
} catch (_) {}

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    backgroundColor: '#0b0b0b',
    show: false
  });

  win.once('ready-to-show', () => win.show());

  const startUrl = process.env.ELECTRON_START_URL || 'http://localhost:3000';
  win.loadURL(startUrl);

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(() => {
  // Allow screen capture and media for getDisplayMedia in the renderer
  const sess = session.defaultSession;
  if (sess) {
    try {
      sess.setPermissionRequestHandler((webContents, permission, callback) => {
        if (permission === 'media' || permission === 'display-capture' || permission === 'fullscreen') {
          return callback(true);
        }
        return callback(false);
      });
      // Some Electron versions also query here before prompting
      if (sess.setPermissionCheckHandler) {
        sess.setPermissionCheckHandler((_wc, permission) => {
          return permission === 'media' || permission === 'display-capture' || permission === 'fullscreen';
        });
      }
    } catch (_) { /* noop */ }
  }

  createWindow();

  // IPC: provide screen source ids to renderer via preload bridge
  ipcMain.handle('ffxiv/select-desktop-source', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    // Choose the first non-aggregate screen-like source
    const first = sources.find(s => /Screen\s*\d+/i.test(s.name)) || sources[0];
    if (!first) throw new Error('No desktop sources available');
    return { id: first.id, name: first.name };
  });

  ipcMain.handle('ffxiv/select-primary-screen', async () => {
    const primary = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({ types: ['screen'] });
    const match = sources.find(s => s.display_id && String(s.display_id) === String(primary.id))
      || sources.find(s => /Screen\s*1/i.test(s.name))
      || sources[0];
    if (!match) throw new Error('No desktop sources available');
    return { id: match.id, name: match.name };
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
