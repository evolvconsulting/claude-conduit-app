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
 * NCOW-53: onStop specifically also guarded against a wedged
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
 * NCOW-55: NCOW-53's fix only covered onStop, and even there console.error
 * is invisible to an end user in a packaged build — stderr goes nowhere
 * nobody reads. onStart/onRestart had no `.catch()` at all (a wedge there
 * would have been an actual unhandled rejection in the main process, not
 * just a silent one — worse than onStop's pre-NCOW-53 silence). All three
 * now route through the same `runAction()` helper below, which keeps the
 * console.error trail (still useful for a dev console / log file) AND shows
 * a native OS notification via Electron's `Notification` API, so a wedged
 * click surfaces to the actual user, not just to whoever happens to be
 * reading stderr.
 *
 * Mechanism choice (the ACs allow either a native notification or an
 * IPC-broadcast the renderer turns into a toast): a native notification was
 * picked over IPC-broadcast specifically because it needs NO new dependency
 * threaded through index.js's createTray({...}) call site — this function's
 * first argument stays exactly `{ mutexes, handlers }`, which is a hard
 * requirement here, not a style preference: engine-context-config-regen.test.js
 * (NCOW-35/38/39/41) has two static checks that regex-match that exact call
 * site text (`.../createTrayActions\(\{\s*mutexes,\s*handlers\s*\}\)/`) to
 * prove `mutexes`/`handlers` are the real, shared, unshadowed bindings —
 * adding a third property to that object literal (e.g. `broadcast`) breaks
 * both checks' pattern, and per this task's own AC#6 those pre-existing
 * tests must keep passing UNMODIFIED. The IPC-broadcast route was tried
 * first and hit exactly that conflict — the second (`deps`) parameter added
 * below sidesteps it entirely, since it's new and nothing pre-existing
 * regexes on it. Notification itself is obtained the same lazy,
 * defensively-required way `electron` already is at the top of this module
 * (so this file still loads under plain `node --test`), and `deps.Notification`
 * lets tests inject a fake without needing a real Electron process — mirroring
 * createTray()'s own `deps` (Tray/Menu/nativeImage) pattern immediately above.
 * `Notification.isSupported()` is checked before construction per Electron's
 * own guidance; a platform/session where it's unsupported just falls back to
 * the console.error trail alone, same as before this task.
 *
 * @param {{mutexes: {proxy: {run: (fn: () => any) => Promise<any>}}, handlers: {proxy: {start: () => any, stop: () => any, restart: () => any}}}} deps
 * @param {{Notification?: Function}} [notifyDeps] injection point for
 *   Electron's Notification class — defaults to the real one when running
 *   inside Electron, undefined (skipped) otherwise.
 * @returns {{onStart: () => Promise<any>, onStop: () => Promise<any>, onRestart: () => Promise<any>}}
 *   none of the three ever reject (NCOW-53/NCOW-55): each `.catch()`
 *   swallows a wedged/failed handlers.proxy.*() call after logging it via
 *   console.error and (when supported) showing a native notification, so
 *   each always resolves — to `undefined` on that failure path, or to
 *   whatever the underlying handler resolved with otherwise.
 */
function createTrayActions({ mutexes, handlers }, notifyDeps = {}) {
  const Notification = notifyDeps.Notification ?? electron?.Notification;

  function notifyFailure(label, err) {
    if (!Notification || typeof Notification.isSupported !== 'function' || !Notification.isSupported()) return;
    try {
      new Notification({
        title: 'Claude Conduit',
        body: `${label} failed: ${err?.message ?? err}`,
      }).show();
    } catch (notifyErr) {
      // Notification plumbing itself breaking must not take the tray action
      // down with it — the console.error trail above already ran.
      console.warn('[tray] failed to show error notification:', notifyErr?.message ?? notifyErr);
    }
  }

  function runAction(label, fn) {
    return mutexes.proxy.run(fn).catch((err) => {
      console.error(`[tray] ${label} failed:`, err?.code ?? '', err?.message ?? err);
      notifyFailure(label, err);
    });
  }

  return {
    onStart: () => runAction('Start', () => handlers.proxy.start()),
    onStop: () => runAction('Stop', () => handlers.proxy.stop()),
    onRestart: () => runAction('Restart', () => handlers.proxy.restart()),
  };
}

module.exports = { createTray, createTrayActions, ICON_COLOR_BY_STATUS };
