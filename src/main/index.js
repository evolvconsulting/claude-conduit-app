'use strict';

const path = require('node:path');
const { app, safeStorage } = require('electron');
const { createMainWindow, getMainWindow, showMainWindow, prepareToQuit } = require('./windows');
const { installApplicationMenu } = require('./menu');
const { registerIpcHandlers } = require('./ipc');
const { createEngineContext } = require('./engine-context');
const { startStatusPoller } = require('./status-poller');
const { createTray } = require('./tray');
const { getAppIcon } = require('./app-icon');
const { createProxyShutdown } = require('./shutdown');
const { createAutoUpdate } = require('./autoUpdate');
const paths = require('../engine/paths');
const updateCheck = require('../engine/updateCheck');

/**
 * NCOW-12 safety net: Electron's userData directory (which holds the
 * encrypted NVIDIA key — see secretStore.js/userDataMigration.js) is derived
 * from app.name/productName, NOT from anything NIM_PROXY_TEST_HOME already
 * redirects (engine-context.js's resolveHomedir only covers configDir,
 * ~/.claude, and Claude Desktop's configLibrary). Without this, a --dev run
 * with NIM_PROXY_TEST_HOME set would still read/write this machine's REAL
 * Electron userData directory — exactly the live, real-API-key state this
 * project's safe-testing story exists to keep dev runs away from. Mirrors
 * Electron's own appData/userData convention (paths.resolveElectronAppDataDir),
 * just rooted under the fake home instead of the real one.
 *
 * NCOW-23: resolveElectronAppDataDir falls back to process.env.APPDATA before
 * ever consulting homedir on win32, and APPDATA is always set on a real
 * Windows machine — so passing homedir alone here (as this function used to)
 * left NIM_PROXY_TEST_HOME silently ignored on Windows, same as the
 * configDir bug. paths.resolveWindowsAppDataOverrides derives the matching
 * appData override from the same fake home so it wins instead.
 */
function resolveUserDataPaths() {
  const isDev = process.argv.includes('--dev');
  if (isDev && process.env.NIM_PROXY_TEST_HOME) {
    const homedir = process.env.NIM_PROXY_TEST_HOME;
    const appDataDir = paths.resolveElectronAppDataDir({ homedir, ...paths.resolveWindowsAppDataOverrides(homedir) });
    return { appDataDir, userDataDir: path.join(appDataDir, app.name) };
  }
  return { appDataDir: app.getPath('appData'), userDataDir: app.getPath('userData') };
}

// Set once the engine exists. Until then there is nothing to shut down, and
// before-quit must not stall an early exit waiting for it.
let stopProxyForShutdown = null;
let stopStatusPoller = null;
let shuttingDown = false;

// Two instances writing ~/.config/claude-conduit/ or ~/.claude/settings.json
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
    const { userDataDir, appDataDir } = resolveUserDataPaths();
    const { handlers, pm2Control, configRegeneration, mutexes } = createEngineContext({
      safeStorage,
      userDataDir,
      appDataDir,
      broadcast: (channel, payload) => getMainWindow()?.webContents.send(channel, payload),
      // NCOW-30: lets createEngineContext detect a generated config
      // (ecosystem.config.cjs/run.js/manifest.json) that's stale relative to
      // this launch and regenerate it — see engine-context.js.
      appVersion: app.getVersion(),
    });

    // Fire-and-forget, same as the auto-update check below: engine-context.js
    // already resolves this to {regenerated:false, reason:'error', error}
    // rather than rejecting, so nothing here can delay or fail startup — this
    // exists purely so a failed regeneration/restart leaves a diagnostic
    // trail instead of vanishing silently (the promise's only other consumer
    // would otherwise be nothing at all).
    configRegeneration
      .then((result) => {
        if (result?.reason === 'error') {
          console.warn('[config-regen] stale-config regeneration failed:', result.error?.message);
        }
      })
      .catch((err) => console.warn('[config-regen] stale-config regeneration failed unexpectedly:', err.message));

    // Created before registerIpcHandlers (and before autoUpdate below) so
    // both the sidebar Quit path and the update-install path can reuse the
    // exact same proxy-stop primitive shutdown.js's 'before-quit' handler
    // uses further down — see NCOW-10.1 and docs/auto-update.md.
    stopProxyForShutdown = createProxyShutdown({ pm2Control });

    // NCOW-10.1: electron-updater's `autoUpdater` singleton touches
    // electron.app at module-load time (AppUpdater's constructor calls
    // app.getVersion()), so it can only ever be required here, after
    // app.whenReady() — requiring it at module scope breaks every test that
    // imports anything from this file under plain `node --test`, matching
    // why `pm2` and `electron` itself are required lazily elsewhere in this
    // codebase. autoUpdate.js never requires it itself for the same reason;
    // it only accepts it as an injected dependency.
    const { autoUpdater } = require('electron-updater');
    const autoUpdate = createAutoUpdate({
      autoUpdater,
      platform: process.platform,
      currentVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      updateCheck,
      broadcast: (status) => getMainWindow()?.webContents.send('update:status-changed', status),
      // Read through wrapper functions rather than passed by value: these
      // `let`s below (stopStatusPoller) and the `shuttingDown` latch are not
      // assigned/flipped until later in this same whenReady() callback, so
      // autoUpdate must see their *current* value whenever it actually calls
      // them, not whatever they held at construction time.
      stopProxyForShutdown: () => stopProxyForShutdown(),
      stopStatusPoller: () => stopStatusPoller?.(),
      markShuttingDown: () => {
        shuttingDown = true;
      },
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
      update: {
        check: () => autoUpdate.checkForUpdates(),
        install: () => autoUpdate.installUpdateAndRestart(),
      },
    }, {
      // NCOW-31: the very locks createEngineContext already used for its own
      // launch-time stale-config restart. Passing them — rather than letting
      // registerIpcHandlers build its own private set — is the entire reason a
      // user-clicked Stop can't interleave with that background restart.
      mutexes,
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

    stopStatusPoller = startStatusPoller({
      pm2Control,
      onStatus: (status) => {
        tray.setStatus(status);
        getMainWindow()?.webContents.send('proxy:status-changed', status);
      },
    });

    app.on('activate', () => showMainWindow());

    // Fire-and-forget: never awaited, so it can never delay the window
    // showing or anything else in this startup sequence (AC#4). Every
    // failure mode checkForUpdates() can hit already resolves to a status
    // broadcast rather than a rejection (see autoUpdate.js/updateCheck.js) —
    // this catch is only a backstop against a genuinely unexpected
    // synchronous throw.
    Promise.resolve()
      .then(() => autoUpdate.checkForUpdates())
      .catch((err) => console.warn('[auto-update] startup check failed unexpectedly:', err.message));
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
