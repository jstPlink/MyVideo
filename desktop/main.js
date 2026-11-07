// App desktop di MyVideo: finestra Electron che mostra l'interfaccia web del tuo server.
const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const cfgFile = () => path.join(app.getPath('userData'), 'config.json');

function readCfg() {
  try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch { return {}; }
}
function writeCfg(patch) {
  const next = { ...readCfg(), ...patch };
  fs.mkdirSync(path.dirname(cfgFile()), { recursive: true });
  fs.writeFileSync(cfgFile(), JSON.stringify(next));
  return next;
}

let win = null;

function serverOrigin() {
  try { return new URL(readCfg().server).origin; } catch { return null; }
}

function showSetup() {
  win.loadFile(path.join(__dirname, 'pages', 'setup.html'));
}

function loadApp() {
  const server = readCfg().server;
  if (!server) return showSetup();
  win.loadURL(server);
}

function createWindow() {
  const cfg = readCfg();
  const b = cfg.bounds || { width: 1280, height: 800 };
  win = new BrowserWindow({
    ...b,
    minWidth: 480,
    minHeight: 400,
    backgroundColor: '#141414',
    title: 'MyVideo',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  if (cfg.maximized) win.maximize();

  win.on('close', () => {
    if (win.isDestroyed()) return;
    writeCfg({ bounds: win.isMaximized() ? readCfg().bounds : win.getBounds(), maximized: win.isMaximized() });
  });
  win.on('page-title-updated', (e) => e.preventDefault()); // il titolo resta "MyVideo"

  // Link esterni (e schemi come vlc://) si aprono fuori dall'app; la navigazione resta sul tuo server.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^vlc:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file:')) return;
    const origin = serverOrigin();
    let target = null;
    try { target = new URL(url).origin; } catch { /* ignora */ }
    if (!origin || target !== origin) {
      e.preventDefault();
      if (/^https?:|^vlc:/i.test(url)) shell.openExternal(url);
    }
  });

  win.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || url.startsWith('file:')) return; // -3 = annullato
    win.loadFile(path.join(__dirname, 'pages', 'offline.html'), { query: { server: readCfg().server || '', error: desc } });
  });

  loadApp();
}

// ------------------------------------------------------------------ VLC

function findVlc() {
  const candidates = {
    win32: [
      path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'VideoLAN', 'VLC', 'vlc.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'VideoLAN', 'VLC', 'vlc.exe'),
      path.join(process.env['LOCALAPPDATA'] || '', 'Programs', 'VideoLAN', 'VLC', 'vlc.exe'),
    ],
    darwin: ['/Applications/VLC.app/Contents/MacOS/VLC'],
    linux: ['/usr/bin/vlc', '/usr/local/bin/vlc', '/snap/bin/vlc', '/var/lib/flatpak/exports/bin/org.videolan.VLC'],
  }[process.platform] || [];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

ipcMain.handle('open-in-vlc', (e, url) => {
  const origin = serverOrigin();
  let ok = false;
  try { ok = !!origin && new URL(url).origin === origin; } catch { /* ignora */ }
  if (!ok) return { ok: false, error: 'Indirizzo non valido' };
  const vlc = findVlc();
  if (!vlc) return { ok: false, error: 'VLC non trovato: installalo da videolan.org' };
  try {
    spawn(vlc, [url], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ------------------------------------------------------------------ configurazione server

ipcMain.handle('get-server', () => readCfg().server || '');
ipcMain.handle('save-server', (e, url) => {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error('protocollo');
    writeCfg({ server: u.origin });
    loadApp();
    return { ok: true };
  } catch {
    return { ok: false, error: 'Indirizzo non valido' };
  }
});
ipcMain.handle('change-server', () => showSetup());
ipcMain.handle('retry', () => loadApp());

// ------------------------------------------------------------------ menu

function buildMenu() {
  const t = [
    {
      label: 'File',
      submenu: [
        { label: 'Cambia server…', accelerator: 'CmdOrCtrl+Shift+S', click: () => showSetup() },
        { label: 'Ricarica', accelerator: 'F5', click: () => win.webContents.reload() },
        { type: 'separator' },
        { role: 'quit', label: 'Esci' },
      ],
    },
    {
      label: 'Vista',
      submenu: [
        { label: 'Indietro', accelerator: 'Alt+Left', click: () => win.webContents.navigationHistory.canGoBack() && win.webContents.navigationHistory.goBack() },
        { label: 'Avanti', accelerator: 'Alt+Right', click: () => win.webContents.navigationHistory.canGoForward() && win.webContents.navigationHistory.goForward() },
        { type: 'separator' },
        { label: 'Schermo intero', accelerator: 'F11', click: () => win.setFullScreen(!win.isFullScreen()) },
        { role: 'zoomIn', label: 'Ingrandisci' },
        { role: 'zoomOut', label: 'Riduci' },
        { role: 'resetZoom', label: 'Zoom predefinito' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Strumenti sviluppatore' },
      ],
    },
    {
      label: 'Aiuto',
      submenu: [
        {
          label: 'Informazioni su MyVideo',
          click: () => dialog.showMessageBox(win, {
            type: 'info',
            title: 'MyVideo',
            message: `MyVideo ${app.getVersion()}`,
            detail: `Server: ${readCfg().server || 'non configurato'}\nElectron ${process.versions.electron}`,
          }),
        },
        { label: 'Repository GitHub', click: () => shell.openExternal('https://github.com/jstPlink/MyVideo') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(t));
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
