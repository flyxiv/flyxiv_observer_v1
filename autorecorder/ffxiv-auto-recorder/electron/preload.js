const { contextBridge, ipcRenderer } = require('electron');
const { pathToFileURL } = require('url');

// Expose a minimal, safe bridge for renderer to request a desktop capture source id.
contextBridge.exposeInMainWorld('ffxiv', {
  version: '0.1.0',
  async selectDesktopSource() {
    return ipcRenderer.invoke('ffxiv/select-desktop-source');
  },
  async selectPrimaryScreen() {
    return ipcRenderer.invoke('ffxiv/select-primary-screen');
  },
  async selectFfxivWindow() {
    return ipcRenderer.invoke('ffxiv/select-ffxiv-window');
  },
  async getSource() {
    return ipcRenderer.invoke('ffxiv/select-desktop-source');
  },
  async isFfxivForeground() {
    return ipcRenderer.invoke('ffxiv/is-ffxiv-foreground');
  },
  async saveRecording(buffer, suggestedName, extension) {
    // buffer should be an ArrayBuffer or Uint8Array
    return ipcRenderer.invoke('ffxiv/save-recording', { buffer, suggestedName, extension });
  },
  async listRecordings() {
    return ipcRenderer.invoke('ffxiv/list-recordings');
  },
  async readFileDataUrl(p) {
    return ipcRenderer.invoke('ffxiv/read-file-dataurl', { path: p });
  },
  async copyImageToClipboard(dataUrl) {
    return ipcRenderer.invoke('ffxiv/copy-image-to-clipboard', { dataUrl });
  },
  pathToFileUrl(p) {
    try { return pathToFileURL(p).href; } catch { return '' }
  }
});
