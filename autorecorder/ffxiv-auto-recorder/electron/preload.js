const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal, safe bridge for renderer to request a desktop capture source id.
contextBridge.exposeInMainWorld('ffxiv', {
  version: '0.1.0',
  async selectDesktopSource() {
    return ipcRenderer.invoke('ffxiv/select-desktop-source');
  },
  async selectPrimaryScreen() {
    return ipcRenderer.invoke('ffxiv/select-primary-screen');
  },
  async getSource() {
    return ipcRenderer.invoke('ffxiv/select-desktop-source');
  }
});
