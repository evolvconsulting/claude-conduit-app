'use strict';

const path = require('node:path');
const { BrowserWindow, shell } = require('electron');
const { getAppIcon } = require('./app-icon');

let mainWindow = null;
let quitting = false;

function getMainWindow() {
  return mainWindow;
}

/** Called from the tray/menu's real Quit action — lets the next 'close' event through. */
function prepareToQuit() {
  quitting = true;
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    show: false,
    // Windows/Linux take the window + taskbar icon from here. macOS ignores it
    // (it uses the bundle's .icns), which is handled in index.js for dev runs.
    ...(getAppIcon() ? { icon: getAppIcon() } : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      // Electron's sandboxed-preload require() only resolves a small
      // built-in-module allowlist (electron, events, timers, url, ...) — it
      // cannot load local project files at all, even same-directory ones.
      // That's incompatible with a multi-file, no-bundler preload/engine
      // architecture. contextIsolation:true + nodeIntegration:false remain
      // the actual boundary preventing the renderer from touching Node or
      // Electron internals directly; sandbox:true would add OS-level
      // process sandboxing on top, but isn't compatible with this layout.
      sandbox: false,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      spellcheck: false,
      // Chromium throttles (and can effectively suspend) a renderer whose
      // window is occluded or backgrounded. For this app that's not cosmetic:
      // it stalls the live log viewer and the status pill, and — observed
      // repeatedly in driver runs — it stops <dialog> "close" events from
      // being dispatched at all, so a confirm dialog's promise never settles
      // and the confirmed action silently never runs until the window is
      // brought forward again. A proxy manager is *expected* to sit behind
      // other windows, so opt out.
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Surface preload load failures in the main-process console instead of
  // failing silently — a broken preload otherwise just looks like a renderer
  // with a missing window.nimProxy, which is hard to diagnose blind.
  mainWindow.webContents.on('preload-error', (_e, preloadPath, error) => {
    console.error('[preload-error]', preloadPath, error);
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.on('console-message', (event) => {
      console.log('[renderer]', event.message ?? event);
    });
  }

  // Deny window.open outright — external links are handled via the
  // allowlisted app:open-external IPC channel instead.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Only ever navigate within the app's own bundled pages.
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    const target = new URL(targetUrl);
    if (target.protocol !== 'file:') {
      event.preventDefault();
      shell.openExternal(targetUrl);
    }
  });

  // The pm2-supervised proxy outlives this Electron app by design (same as
  // pm2's own daemon model) — closing the window hides it rather than
  // quitting, so the tray remains the way to actually exit.
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  return mainWindow;
}

function showMainWindow(route) {
  const win = createMainWindow();
  if (route) win.webContents.send('app:navigate', route);
  win.show();
  win.focus();
}

module.exports = { createMainWindow, getMainWindow, showMainWindow, prepareToQuit };
