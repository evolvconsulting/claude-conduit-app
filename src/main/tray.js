'use strict';

const { generateDotIconPng } = require('./tray-icon');

// Required lazily/defensively so this module can be unit-tested outside an
// Electron process (tests inject fakes via the `deps` argument).
let electron = null;
try {
  electron = require('electron');
} catch {
  electron = null;
}

const ICON_COLOR_BY_STATUS = {
  running: '#2ecc71',
  stopped: '#95a5a6',
  errored: '#e74c3c',
  'not-installed': '#95a5a6',
};

/**
 * A tray that does nothing. Returned whenever a real one can't be created —
 * the window must remain the complete, sufficient interface (DESIGN note:
 * Linux AppIndicator support is inconsistent, and a headless/kiosk session may
 * have no status area at all).
 */
function createNullTray(reason) {
  return { tray: null, setStatus: () => {}, available: false, reason };
}

/**
 * @param {{showDashboard: () => void, showDiagnostics: () => void, quit: () => void, onStart?: () => void, onStop?: () => void, onRestart?: () => void}} opts
 * @param {{Tray?: Function, Menu?: object, nativeImage?: object}} [deps]
 */
function createTray(opts, deps = {}) {
  const Tray = deps.Tray ?? electron?.Tray;
  const Menu = deps.Menu ?? electron?.Menu;
  const nativeImage = deps.nativeImage ?? electron?.nativeImage;

  if (!Tray || !Menu || !nativeImage) return createNullTray('electron tray APIs unavailable');

  const iconCache = new Map();
  function iconForStatus(status) {
    const color = ICON_COLOR_BY_STATUS[status] ?? ICON_COLOR_BY_STATUS.stopped;
    if (!iconCache.has(color)) {
      iconCache.set(color, nativeImage.createFromBuffer(generateDotIconPng(color)));
    }
    return iconCache.get(color);
  }

  let tray;
  try {
    tray = new Tray(iconForStatus('stopped'));
  } catch (err) {
    // Never fatal: on Linux `new Tray()` throws outright when no AppIndicator
    // / StatusNotifier host is running, and the app must still start and be
    // fully usable from its window alone.
    console.warn('[tray] unavailable, continuing without one:', err.message);
    return createNullTray(err.message);
  }

  tray.setToolTip('NIM Proxy Manager');

  function setStatus(status) {
    try {
      tray.setImage(iconForStatus(status.status));
      const label =
        status.status === 'running'
          ? `Running${status.pid ? ` — pid ${status.pid}` : ''}`
          : status.status === 'not-installed'
            ? 'Not configured'
            : status.status[0].toUpperCase() + status.status.slice(1);
      tray.setToolTip(`NIM Proxy Manager — ${label}`);

      const menu = Menu.buildFromTemplate([
        { label, enabled: false },
        { type: 'separator' },
        { label: 'Start', enabled: status.status !== 'running', click: () => opts.onStart?.() },
        { label: 'Stop', enabled: status.status === 'running', click: () => opts.onStop?.() },
        { label: 'Restart', enabled: status.status === 'running', click: () => opts.onRestart?.() },
        { type: 'separator' },
        { label: 'Open Dashboard', click: () => opts.showDashboard() },
        { label: 'Run Diagnostics', click: () => opts.showDiagnostics() },
        { type: 'separator' },
        // Quitting takes the proxy with it (NCOW-4), which also means Claude
        // Desktop and Claude Code stop routing through NIM — worth saying on
        // the item itself rather than leaving it to be discovered.
        { label: 'Quit NIM Proxy Manager (stops the proxy)', click: () => opts.quit() },
      ]);
      tray.setContextMenu(menu);
    } catch (err) {
      // A tray that breaks mid-session must not take the status poller with it.
      console.warn('[tray] status update failed:', err.message);
    }
  }

  setStatus({ status: 'stopped' });
  tray.on('click', () => opts.showDashboard());

  return { tray, setStatus, available: true };
}

module.exports = { createTray, ICON_COLOR_BY_STATUS };
