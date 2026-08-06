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

  tray.setToolTip('Claude Conduit');

  function setStatus(status) {
    try {
      tray.setImage(iconForStatus(status.status));
      const label =
        status.status === 'running'
          ? `Running${status.pid ? ` — pid ${status.pid}` : ''}`
          : status.status === 'not-installed'
            ? 'Not configured'
            : status.status[0].toUpperCase() + status.status.slice(1);
      tray.setToolTip(`Claude Conduit — ${label}`);

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
        { label: 'Quit Claude Conduit (stops the proxy)', click: () => opts.quit() },
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

/**
 * Builds the tray's Start/Stop/Restart callbacks, wired through the shared
 * proxy mutex — the same primitive registerIpcHandlers() decorates the IPC
 * handlers with (ipc.js) and engine-context.js's regenerateStaleConfig()
 * restart uses via `runProxyOperation`. Without this, a tray click can
 * interleave with a background proxy-affecting operation: tray.js only
 * enables Stop/Restart while status === 'running', which is exactly the
 * precondition the background stale-config restart's up-to-60s health-check
 * window holds the lock under (NCOW-31 fix pass 2, reviewer finding B1).
 *
 * This used to be written inline at index.js's createTray({...}) call site,
 * which meant the only way to check it was a source-text regex over
 * index.js — one that could not distinguish a genuinely shared mutex set
 * from a mutation that shadows `mutexes` in a nested scope right around the
 * call, giving the tray its own private, unshared lock (review pass 2's
 * finding, NCOW-35). Pulling it out here — mirroring menu.js's
 * `buildMenuTemplate(actions, platform)`, extracted for the same reason —
 * makes the wiring an independently constructible, dependency-injected unit
 * a test can drive directly with a real mutex set and prove shares the SAME
 * instance ipc.js/engine-context.js use (see test/main/tray-actions.test.js).
 *
 * NCOW-53: onStop specifically also guards against a wedged
 * handlers.proxy.stop() (PM2_STOP_TIMEOUT and friends, bounded by NCOW-52)
 * vanishing with zero diagnostic trail. Unlike the IPC channel
 * (registerIpcHandlers() in ipc.js wraps every handler in its own
 * try/catch and turns a throw into a returned `{ok:false, error}`), a tray
 * menu item's `click` callback has no caller that inspects its return value
 * at all — Electron fires it and moves on. mutex.js's withLock() ALSO
 * doesn't swallow the promise it hands back to its caller (only the
 * internal `chain` it uses to sequence future acquisitions) — see mutex.js's
 * own `chain = run.catch(() => {})` comment — so the rejection here is real,
 * it just has nowhere to go. `.catch()` right here, at the call site, is the
 * fix: it needs no changes to the shared mutex primitive every other domain
 * depends on, so it can't touch mutex.js's FIFO-chain guarantee for
 * multi-lock domains like `uninstall` (see NCOW-53's dispatch notes for why
 * a mutex.js-level swallow-removal was considered and rejected — it produces
 * unhandled rejections on any throwing multi-lock call and permanently wedges
 * that lock for every later caller).
 *
 * @param {{mutexes: {proxy: {run: (fn: () => any) => Promise<any>}}, handlers: {proxy: {start: () => any, stop: () => any, restart: () => any}}}} deps
 * @returns {{onStart: () => Promise<any>, onStop: () => Promise<any>, onRestart: () => Promise<any>}} onStop
 *   never rejects (NCOW-53): its `.catch()` swallows a wedged/failed
 *   handlers.proxy.stop() after logging it via console.error, so it always
 *   resolves — to `undefined` on that failure path, or to whatever
 *   handlers.proxy.stop() resolved with otherwise.
 */
function createTrayActions({ mutexes, handlers }) {
  return {
    onStart: () => mutexes.proxy.run(() => handlers.proxy.start()),
    onStop: () =>
      mutexes.proxy.run(() => handlers.proxy.stop()).catch((err) => {
        console.error('[tray] Stop failed:', err?.code ?? '', err?.message ?? err);
      }),
    onRestart: () => mutexes.proxy.run(() => handlers.proxy.restart()),
  };
}

module.exports = { createTray, createTrayActions, ICON_COLOR_BY_STATUS };
