const { contextBridge, ipcRenderer } = require('electron');

// API minima esposta alle pagine: la web UI la usa per aprire i video in VLC;
// le pagine locali (setup/offline) per configurare il server.
contextBridge.exposeInMainWorld('myvideoDesktop', {
  isDesktop: true,
  platform: process.platform,
  openInVlc: (url) => ipcRenderer.invoke('open-in-vlc', url),
  getServer: () => ipcRenderer.invoke('get-server'),
  saveServer: (url) => ipcRenderer.invoke('save-server', url),
  changeServer: () => ipcRenderer.invoke('change-server'),
  retry: () => ipcRenderer.invoke('retry'),
});
