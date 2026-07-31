'use strict';

const { app, safeStorage } = require('electron');
const { createMainWindow, getMainWindow, showMainWindow, prepareToQuit } = require('./windows');
const { installApplicationMenu } = require('./menu');
const { registerIpcHandlers } = require('./ipc');
const { createEngineContext } = require('./engine-context');
const { startStatusPoller } = require('./status-poller');
const { createTray } = require('./tray');
const { getAppIcon } = require('./app-icon');

// Two instances writing ~/.config/claude-nim-proxy/ or ~/.claude/settings.json
// concurrently is unsafe — refuse a second launch and focus the existing window.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());

  app.whenReady().then(() => {
    installApplicationMenu();

    // An unpackaged macOS run (npm run dev) has no bundle .icns, so the dock
    // would otherwise show Electron's own logo. Packaged builds get the real
    // icon from build/icon.icns and don't need this.
    if (process.platform === 'darwin' && !app.isPackaged) {
      const icon = getAppIcon();
      if (icon) app.dock?.setIcon(icon);
    }

    // safeStorage must only be called after app.whenReady() — Linux backend
    // detection happens then.
    const { handlers, pm2Control } = createEngineContext({
      safeStorage,
      userDataDir: app.getPath('userData'),
      broadcast: (channel, payload) => getMainWindow()?.webContents.send(channel, payload),
    });

    registerIpcHandlers(handlers);
    createMainWindow();

    const tray = createTray({
      showDashboard: () => showMainWindow('dashboard'),
      showDiagnostics: () => showMainWindow('diagnostics'),
      quit: () => {
        prepareToQuit();
        app.quit();
      },
      onStart: () => handlers.proxy.start(),
      onStop: () => handlers.proxy.stop(),
      onRestart: () => handlers.proxy.restart(),
    });

    startStatusPoller({
      pm2Control,
      onStatus: (status) => {
        tray.setStatus(status);
        getMainWindow()?.webContents.send('proxy:status-changed', status);
      },
    });

    app.on('activate', () => showMainWindow());
  });

  app.on('before-quit', () => prepareToQuit());

  // The tray is the real way to exit — closing the last window just hides
  // it (see windows.js), so this only fires on an explicit quit.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
