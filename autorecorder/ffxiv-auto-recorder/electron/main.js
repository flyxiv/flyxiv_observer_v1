const { app, BrowserWindow, session, ipcMain, desktopCapturer, screen, shell, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const isDev = require('electron-is-dev');
const { execFile } = require('child_process');
// Mute noisy dev-only Electron security warnings (CSP/eval in Next dev)
if (isDev) {
  try { process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'; } catch (_) {}
}

// Allow screen capture from non-https dev origin (Chromium flags)
try {
  app.commandLine.appendSwitch('allow-http-screen-capture');
  app.commandLine.appendSwitch('enable-usermedia-screen-capturing');
  // Encourage GPU in Chromium/Electron
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-unsafe-webgpu');
  // Reduce background throttling that can limit capture FPS
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  // Allow loading local file:// media from renderer
  app.commandLine.appendSwitch('allow-file-access-from-files');
} catch (_) {}

let win;
let recordingsDir;
const isWindows = process.platform === 'win32';

// Lightweight foreground window checker for Windows via PowerShell (no native deps)
let _fgCache = { ts: 0, val: true };
async function isFfxivForeground() {
  const now = Date.now();
  if (now - _fgCache.ts < 500) return _fgCache.val; // small debounce/cache
  if (!isWindows) {
    _fgCache = { ts: now, val: true }; // allow on non-Windows (no check)
    return _fgCache.val;
  }
  const psScript = `
$signature = @"
using System;
using System.Runtime.InteropServices;
public class U {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@;
Add-Type $signature | Out-Null;
$h=[U]::GetForegroundWindow();
$len=[U]::GetWindowTextLength($h);
$sb=New-Object System.Text.StringBuilder ($len+1);
[U]::GetWindowText($h,$sb,$sb.Capacity) | Out-Null;
$pid=0; [U]::GetWindowThreadProcessId($h,[ref]$pid) | Out-Null;
try { $p=Get-Process -Id $pid -ErrorAction Stop; $n=$p.ProcessName } catch { $n="" }
$title=$sb.ToString();
Write-Output ($title + "|" + $n);
`.trim();
  const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded];
  const out = await new Promise((resolve) => {
    execFile('powershell.exe', args, { windowsHide: true }, (err, stdout) => {
      if (err) return resolve('');
      resolve(String(stdout || '').trim());
    });
  });
  let val = true;
  try {
    const [title, proc] = (out || '').split('|');
    const s = ((title || '') + ' ' + (proc || '')).toLowerCase();
    // Known FFXIV cues: process names ffxiv_dx11.exe / ffxiv.exe, title often contains FINAL FANTASY XIV
    val = s.includes('ffxiv') || s.includes('final fantasy xiv');
  } catch {
    val = true;
  }
  _fgCache = { ts: now, val };
  return val;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      // In dev, relax webSecurity to ensure file:// videos load in <video>
      webSecurity: !isDev ? true : false
    },
    backgroundColor: '#0b0b0b',
    show: false
  });

  win.once('ready-to-show', () => win.show());

  const startUrl = process.env.ELECTRON_START_URL || 'http://localhost:3000';
  win.loadURL(startUrl);

  if (isDev && process.env.OPEN_DEVTOOLS === '1') {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  win.on('closed', () => {
    win = null;
  });
}

app.whenReady().then(() => {
  // Prepare a persistent recordings directory
  try {
    const base = app.getPath('videos') || app.getPath('userData');
    recordingsDir = path.join(base, 'FFXIV Auto Recorder');
    fs.mkdirSync(recordingsDir, { recursive: true });
  } catch (_) {}
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

  // IPC: find the FFXIV game window (capture just that window)
  ipcMain.handle('ffxiv/select-ffxiv-window', async () => {
    const sources = await desktopCapturer.getSources({ types: ['window'] });
    // Common matches for FFXIV window
    const match = sources.find(s => /final\s*fantasy\s*xiv/i.test(s.name))
      || sources.find(s => /ffxiv/i.test(s.name));
    if (!match) throw new Error('FFXIV window not found');
    return { id: match.id, name: match.name };
  });

  // IPC: tell renderer if FFXIV is the foreground window (Windows only)
  ipcMain.handle('ffxiv/is-ffxiv-foreground', async () => {
    try { return await isFfxivForeground(); } catch { return true; }
  });

  // IPC: save recording buffer to disk and return file path
  ipcMain.handle('ffxiv/save-recording', async (_evt, payload) => {
    if (!payload || !payload.buffer) throw new Error('No buffer provided');
    const buf = Buffer.isBuffer(payload.buffer) ? payload.buffer : Buffer.from(payload.buffer);
    const ext = typeof payload.extension === 'string' && payload.extension.trim() ? payload.extension.trim() : 'webm';
    const safeBase = (payload.suggestedName || 'Pull')
      .toString()
      .replace(/[^a-zA-Z0-9-_\. ]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'Pull';
    const ts = new Date();
    const y = ts.getFullYear();
    const m = String(ts.getMonth() + 1).padStart(2, '0');
    const d = String(ts.getDate()).padStart(2, '0');
    const hh = String(ts.getHours()).padStart(2, '0');
    const mm = String(ts.getMinutes()).padStart(2, '0');
    const ss = String(ts.getSeconds()).padStart(2, '0');
    const filename = `${y}${m}${d}_${hh}${mm}${ss}_${safeBase}.${ext}`;
    const outPath = path.join(recordingsDir || app.getPath('userData'), filename);
    await fsp.writeFile(outPath, buf);
    return { path: outPath, filename };
  });

  // IPC: list existing recordings from disk
  ipcMain.handle('ffxiv/list-recordings', async () => {
    const dir = recordingsDir || app.getPath('userData');
    try {
      const files = await fsp.readdir(dir, { withFileTypes: true });
      const vids = files.filter((d) => d.isFile() && /\.(webm|mp4|mkv|mov|m4v)$/i.test(d.name));
      const out = [];
      for (const v of vids) {
        const p = path.join(dir, v.name);
        try {
          const st = await fsp.stat(p);
          out.push({
            id: v.name,
            name: v.name,
            path: p,
            mtimeMs: st.mtimeMs,
            size: st.size,
          });
        } catch {}
      }
      out.sort((a, b) => b.mtimeMs - a.mtimeMs);
      return out;
    } catch (e) {
      return [];
    }
  });

  // IPC: read a file and return a data URL for fallback playback
  ipcMain.handle('ffxiv/read-file-dataurl', async (_evt, { path: inPath }) => {
    if (!inPath) throw new Error('No path');
    const buf = await fsp.readFile(String(inPath));
    const ext = String(inPath).toLowerCase().split('.').pop() || '';
    const mime = ext === 'mp4' ? 'video/mp4' : ext === 'mkv' ? 'video/x-matroska' : ext === 'mov' ? 'video/quicktime' : 'video/webm';
    const b64 = buf.toString('base64');
    return `data:${mime};base64,${b64}`;
  });

  // IPC: copy image to clipboard
  ipcMain.handle('ffxiv/copy-image-to-clipboard', async (_evt, { dataUrl }) => {
    try {
      if (!dataUrl) throw new Error('No data URL provided');
      const img = nativeImage.createFromDataURL(dataUrl);
      clipboard.writeImage(img);
      return { success: true };
    } catch (err) {
      console.error('Clipboard write failed:', err);
      return { success: false, error: err.message };
    }
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
