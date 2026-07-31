'use strict';

const { app, safeStorage } = require('electron');
const { createMainWindow, getMainWindow, showMainWindow, prepareToQuit } = require('./windows');
const { installApplicationMenu } = require('./menu');
const { registerIpcHandlers } = require('./ipc');
const { createEngineContext } = require('./engine-context');
const { startStatusPoller } = require('./status-poller');
const { createTray } = require('./tray');
const { getAppIcon } = require('./app-icon');
const { createProxyShutdown } = require('./shutdown');

// Set once the engine exists. Until then there is nothing to shut down, and
// before-quit must not stall an early exit waiting for it.
let stopProxyForShutdown = null;
let stopStatusPoller = null;
let shuttingDown = false;

// Two instances writing ~/.config/claude-nim-proxy/ or ~/.claude/settings.json
// concurrently is unsafe — refuse a second launch and focus the existing window.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());

  app.whenReady().then(() => {
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

    // Every exit route funnels into app.quit() so 'before-quit' below stays the
    // single place shutdown work happens. The renderer's Quit button gets its
    // own channel because the sidebar has no other way to reach the app object;
    // the quit is deferred past the IPC reply so the renderer's promise still
    // settles instead of dying with the process.
    registerIpcHandlers({
      ...handlers,
      app: {
        ...handlers.app,
        quit: async () => {
          setImmediate(() => app.quit());
          return { ok: true };
        },
      },
    });
    createMainWindow();

    // Installed after the window exists: both menu actions need somewhere to
    // land, and About has to be able to surface a hidden window before the
    // renderer can show anything.
    installApplicationMenu({
      showAbout: () => {
        showMainWindow();
        getMainWindow()?.webContents.send('app:show-about');
      },
      showLicenses: () => {
        showMainWindow();
        getMainWindow()?.webContents.send('app:show-licenses');
      },
      openLogsFolder: () => handlers.app.openLogsFolder(),
    });

    const tray = createTray({
      showDashboard: () => showMainWindow('dashboard'),
      showDiagnostics: () => showMainWindow('diagnostics'),
      quit: () => app.quit(),
      onStart: () => handlers.proxy.start(),
      onStop: () => handlers.proxy.stop(),
      onRestart: () => handlers.proxy.restart(),
    });

    stopProxyForShutdown = createProxyShutdown({ pm2Control });

    stopStatusPoller = startStatusPoller({
      pm2Control,
      onStatus: (status) => {
        tray.setStatus(status);
        getMainWindow()?.webContents.send('proxy:status-changed', status);
      },
    });

    app.on('activate', () => showMainWindow());
  });

  // The one shutdown choke point. Every exit route — the menu's Quit/Exit item,
  // Cmd+Q, the tray entry, the sidebar button, the macOS dock's own Quit, and a
  // logout — raises this, so anything that has to happen on the way out belongs
  // here rather than on any individual caller.
  //
  // Stopping the proxy is asynchronous, and before-quit is not, so the first
  // pass cancels the quit and re-issues it once the proxy is down. The
  // shuttingDown latch is what stops that second app.quit() being intercepted
  // again — without it this is an infinite loop and the app never exits.
  app.on('before-quit', (event) => {
    prepareToQuit();
    if (shuttingDown || !stopProxyForShutdown) return;

    shuttingDown = true;
    event.preventDefault();

    // Stop polling first: a tick landing mid-shutdown would repaint the tray
    // and window with a status that is about to be wrong anyway.
    stopStatusPoller?.();

    stopProxyForShutdown().finally(() => app.quit());
  });

  // Closing the last window just hides it (see windows.js), so this only fires
  // on an explicit quit.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
