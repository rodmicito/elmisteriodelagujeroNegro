const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow () {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    fullscreen: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    useContentSize: true,
    resizable: true,
    autoHideMenuBar: true
  });

  win.setMenuBarVisibility(false);

  // Guante (ESP32): Electron no muestra la ventana para elegir puerto serie,
  // así que se elige solo la placa ESP32 (fabricante 0x303A) y se da permiso.
  const ses = win.webContents.session;
  ses.on('select-serial-port', (event, portList, _webContents, callback) => {
    event.preventDefault();
    const esp = portList.find((p) => (p.vendorId || '').toLowerCase() === '303a');
    callback(esp ? esp.portId : '');
  });
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'serial');
  ses.setDevicePermissionHandler((details) => details.deviceType === 'serial');
  win.loadFile(path.join(__dirname, '../dist/index.html'));
}

app.whenReady().then(() => {
  createWindow();

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
