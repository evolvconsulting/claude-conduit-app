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
        // NCOW-56 (AC#2): Start's `enabled` here is NOT gated on whether a
        // manifest exists, unlike the dashboard's `#start-btn`
        // (dashboard-view.js: `disabled = status === 'running' || !manifest`).
        // Investigated rather than assumed: `setStatus()` only ever receives
        // a `{status, pid?, uptime?, restarts?}`-shaped object —
        // `pm2Control.getStatus()`'s own return, status-poller.js's
        // synthesized `{status:'errored'}` on a rejected poll (status-poller.js's
        // `tick()` catch block), or tray.js's own initial `{status:'stopped'}`
        // passed to `setStatus()` at construction (below) — with nothing
        // about the manifest in any of them (see index.js's
        // `startStatusPoller({ pm2Control, onStatus: ... tray.setStatus(status)
        // })`). The `not-installed` status this label renders as "Not
        // configured" (above) is verified to mean something different from
        // "no manifest": pm2Control.js's `getStatus()` reports it purely from
        // `findApp()` returning nothing — i.e. pm2 currently has no app
        // registered under that name — which is orthogonal to whether
        // `manifest.json` exists. A completed setup can still be
        // `not-installed` with a manifest already on disk (e.g. `proxy.start()`
        // failing at the pm2 level before pm2 ever registers the app — the
        // ordinary case right after Setup finishes is actually `running`,
        // since the wizard's models step wires straight into
        // `generateAndStart()` in setup-view.js, which writes the manifest
        // and then immediately awaits `proxy.start()`, per DESIGN.md's "Step
        // 5 — start under pm2"); conversely nothing here rules out
        // `stopped`/`errored`/`running` with no manifest either (e.g. a
        // manifest deleted out-of-band after the proxy was once started). So
        // gating `enabled` on manifest presence would need
        // `setStatus()` to receive manifest state too —
        // threading that through means changing this call's
        // shape at its one EXTERNAL call site (index.js), which is out of
        // scope for this task (index.js belongs to a sibling task, NCOW-57;
        // note status-poller.js's own `onStatus(status)` callback (status-
        // poller.js:14) is layer-correctly ignorant of manifests and would
        // need no change — index.js alone could enrich the call itself,
        // since it already has `handlers` in scope and
        // `handlers.config.getManifest` exists). Given that, the chosen fix is the
        // alternative the task explicitly allows: leave Start always enabled
        // while not running, and make a click that resolves `{ok:false,
        // error:{code:'NOT_CONFIGURED', ...}}` (the real, verified shape
        // engine-context.js's `proxy.start` returns when `getManifest()` is
        // null) surface a clear, immediate native notification — see
        // `createTrayActions()`'s NCOW-56 doc comment above and its
        // `runAction()`. Trade-off accepted: a click on an unconfigured
        // install still round-trips through the mutex/IPC-style handler
        // before the user learns anything, instead of the button being inert
        // from the start — but it is no longer silent, which is what this
        // task exists to fix, and it needs no change outside this file.
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
 * first and hit exactly that conflict — the second (`notifyDeps`) parameter
 * added below sidesteps it entirely, since it's new and nothing pre-existing
 * regexes on it. Notification itself is obtained the same lazy,
 * defensively-required way `electron` already is at the top of this module
 * (so this file still loads under plain `node --test`), and
 * `notifyDeps.Notification` lets tests inject a fake without needing a real
 * Electron process — mirroring createTray()'s own `deps` (Tray/Menu/
 * nativeImage) pattern immediately above.
 * `Notification.isSupported()` is checked before construction per Electron's
 * own guidance; a platform/session where it's unsupported just falls back to
 * the console.error trail alone, same as before this task.
 *
 * NCOW-57 correction: the claim immediately above is narrower in practice
 * than it reads. `Notification.isSupported()` reports whether the platform
 * has a notification API at all — it does NOT detect every condition that
 * can leave a toast never actually visible to the user. Four gaps (wave-16
 * cleanup, F4: the previous wording overstated what Electron's docs
 * themselves say — quoting from docs/tutorial/notifications.md, tag
 * v43.2.0, below; see appUserModelId.js and electron-builder.yml's
 * `win.target` comment for the Windows one in more detail):
 * (1) on Windows, `isSupported()` does not check whether this process has a
 * usable AppUserModelID/Start-Menu-shortcut pairing bound to it (see
 * appUserModelId.js's citation trail) — the doc (lines 135-141) does not name
 * that condition; it describes the userland `windows-notification-state`
 * module only in general terms, as letting a caller "detect whether or not
 * you're allowed to send a notification" / "determine ahead of time whether
 * or not Windows will silently throw the notification away"; (2) on macOS,
 * `isSupported()` likewise does not check notification-permission or
 * Do-Not-Disturb state — the same doc (lines 155-160) points at the userland
 * `macos-notification-state` module for that (not independently re-verified
 * live in this task — this is Electron's documented direction, unchanged by
 * this task's fix); (3) also on
 * macOS, the same doc (lines 145-148) states plainly: "your application will
 * need to be code-signed in order for notification events to emit correctly
 * ... Unsigned binaries will emit a `failed` event when notification APIs
 * are called." This app's macOS builds are ad-hoc signed, not signed with a
 * full Apple Developer ID (electron-builder.yml's `mac.identity: "-"` — see
 * CLAUDE.md's hard constraints) — whether that ad-hoc signature is enough to
 * avoid the doc's "unsigned" failure mode is not something this comment
 * resolves, and `isSupported()` does not detect this condition either way;
 * (4) on Windows, `isSupported()` also does not check toast *activation*
 * (clicking a toast) separately from mere toast *display* — activation
 * additionally depends on `app.setToastActivatorCLSID(id)` (Electron
 * docs/api/app.md, same v43.2.0 tag, lines 1148-1159), which this app does
 * not call, so Electron generates a random CLSID once per run instead.
 * CCA-61 investigated fixing this (a hardcoded CLSID plus a matching
 * shortcut stamp) and found no remedy currently reachable: the installed
 * app-builder-lib (26.15.3) has no support for stamping a
 * ToastActivatorCLSID onto either Windows target's shortcut at all (zero
 * hits for `grep -rn "ToastActivator\|CLSID" node_modules/app-builder-lib/`,
 * repo-wide, not just its nsis templates) — see electron-builder.yml's
 * `win:` block comment for the full citation trail and reasoning. This is a
 * real, open, deliberately-accepted-and-documented gap, not one this
 * comment implies is unfixable in principle or unworthy of a future fix if
 * app-builder-lib ever adds that support.
 * What WAS live-verified on winvm/linuxvm as part of NCOW-57:
 * `createTrayActions()`'s real onStart() failure path, invoked in real
 * running processes (a silently-installed `nsis` build, the standalone
 * `portable` exe, and — both on the original pass and again on the NCOW-57
 * fix pass — a source `--dev` run), reaches the real OS notification
 * pipeline in every Windows configuration tried — `nsis`/`portable` don't
 * exist as Linux targets, so Linux's evidence is the separate dbus capture
 * described two paragraphs below, not this list.
 *
 * Windows recap (fix pass): the original pass's finding that Windows
 * "accepted and recorded the call identically for both packaged
 * configurations" was correct as far as it went, but left out that the
 * AUMID both configurations recorded under (`electron.app.Claude Conduit`,
 * Electron's own generated default) did NOT match the AUMID
 * electron-builder's NSIS installer had already stamped onto the real Start
 * Menu shortcut (`com.evolvconsulting.claudeconduit`) — see
 * appUserModelId.js and electron-builder.yml's `win.target` comment for the
 * full before/after. The fix pass's unconditional
 * `app.setAppUserModelId(...)` call closes that specific mismatch: re-run
 * live on winvm, all three configurations (`nsis`, `portable`, and a genuine
 * unpackaged `--dev` source run) now record the notification under the
 * shortcut's own AUMID instead.
 *
 * Linux recap: a `dbus-monitor` capture (re-run and preserved on-disk during
 * the NCOW-57 fix pass, since the original pass's tree — and so its capture
 * — no longer existed for the reviewer to check) showed the real
 * `org.freedesktop.Notifications.Notify` call reaching gnome-shell (PID
 * confirmed via `org.freedesktop.DBus.GetConnectionUnixProcessID`) with the
 * expected title/body, satisfying this task's evidence standard for a
 * Wayland/GNOME session where pixel-level screenshot proof is not obtainable
 * (GNOME denies the Shell Screenshot API here).
 *
 * Pixel-level "a human would see a banner" could not be confirmed on winvm
 * despite repeated attempts in the original pass (see electron-builder.yml's
 * comment; not re-attempted in the fix pass, since what changed was AUMID
 * correctness, not display capability) or on linuxvm (GNOME denies the Shell
 * screenshot API entirely) — the dbus/registry/AUMID evidence above is what
 * NCOW-57's record relies on instead. The console.error trail below remains
 * the one fallback that is NOT contingent on any of this.
 *
 * NCOW-56: NCOW-55 above only covers a THROWN/REJECTED handlers.proxy.*()
 * call (a genuine pm2-level wedge, e.g. PM2_START_TIMEOUT/PM2_STOP_TIMEOUT).
 * The wave-14 integration review found a second, actually more common
 * failure mode it left completely uncovered: engine-context.js's
 * proxy.start/stop/restart handlers can RESOLVE with
 * `{ok:false, error:{code, message}}` instead of throwing — confirmed in
 * source (engine-context.js): `start` returns
 * `{ok:false, error:{code:'NOT_CONFIGURED', message:'Run setup first.'}}`
 * when `getManifest()` is null (i.e. setup was never run), and
 * `{ok:false, error:result.error, ...}` — carrying pm2Control.js's
 * `startOrRestart()`'s own `{code:'HEALTH_CHECK_TIMEOUT', message:'litellm
 * did not become healthy in time.'}` — when pm2 starts the process but
 * litellm never reports healthy inside its window. `restart` is
 * `async () => handlers.proxy.start()`, so it inherits both. `stop`, by
 * contrast, is verified to never itself resolve `{ok:false}` in production
 * today (`pm2Control.stop()` can reject on a timeout, on pm2's own callback
 * error, or from a failed `ensureConnected()` — or resolve with nothing to
 * report as an error) — `runAction()` below still checks every
 * action generically, both because that costs nothing and because it is the
 * honest, non-brittle contract for a shared helper (a future change to
 * `stop` that starts returning `{ok:false}` — e.g. to surface a
 * `pm2Control.getStatus()` failure after stopping — is covered for free
 * rather than silently falling back through the old gap again). Before this
 * fix, this whole class resolved in total silence: no console.error, no
 * notification, nothing — the exact "invisible to the user" gap NCOW-55 was
 * filed to close, just for the resolve path instead of the reject path. The
 * fix reuses NCOW-55's own `notifyFailure()` unchanged: `runAction()` now
 * inspects the resolved value before handing it back, and — for a resolved
 * `{ok:false}` — logs and notifies exactly the way the `.catch()` branch
 * below already does for a thrown one, then still returns that `{ok:false,
 * error}` value to the caller unchanged (unlike the reject path, which has
 * always resolved to `undefined` — there is no meaningful value to invent
 * for a genuine exception, but a resolved `{ok:false}` result already IS a
 * meaningful value, so it is passed through rather than discarded).
 *
 * @param {{mutexes: {proxy: {run: (fn: () => any) => Promise<any>}}, handlers: {proxy: {start: () => any, stop: () => any, restart: () => any}}}} deps
 * @param {{Notification?: Function}} [notifyDeps] injection point for
 *   Electron's Notification class — defaults to the real one when running
 *   inside Electron, undefined (skipped) otherwise.
 * @returns {{onStart: () => Promise<any>, onStop: () => Promise<any>, onRestart: () => Promise<any>}}
 *   none of the three ever reject (NCOW-53/NCOW-55): each `.catch()`
 *   swallows a wedged/failed handlers.proxy.*() call after logging it via
 *   console.error and (when supported) showing a native notification, so
 *   each always resolves — to `undefined` on that (thrown/rejected) failure
 *   path, or to whatever the underlying handler resolved with otherwise
 *   (including a resolved `{ok:false, error}` — NCOW-56 — which is now
 *   logged/notified the same way but still handed back to the caller as-is).
 */
function createTrayActions({ mutexes, handlers }, notifyDeps = {}) {
  const Notification = notifyDeps.Notification ?? electron?.Notification;

  function notifyFailure(label, err) {
    try {
      if (!Notification || typeof Notification.isSupported !== 'function' || !Notification.isSupported()) return;
      // wave-15 integration review (finding F6): `err` here can be an
      // `{ok:false}` result's `.error` field, coerced to `{}` when that field
      // is absent (see runAction()'s `const err = result.error ?? {};`
      // below). Falling all the way back to stringifying `err` itself (the
      // pre-fix behavior) rendered the user-visible "[object Object]" for
      // that case. No handler shipped today omits `error`, but the comment
      // right above runAction() explicitly keeps this check generic for
      // handlers that don't exist yet — exactly the case that would hit
      // this — so fall back through `.code`, then a fixed string, instead.
      new Notification({
        title: 'Claude Conduit',
        body: `${label} failed: ${err?.message ?? err?.code ?? 'unknown error'}`,
      }).show();
    } catch (notifyErr) {
      // Notification plumbing itself breaking must not take the tray action
      // down with it — the console.error trail above already ran.
      console.warn('[tray] failed to show error notification:', notifyErr?.message ?? notifyErr);
    }
  }

  function runAction(label, fn) {
    return mutexes.proxy
      .run(fn)
      .then((result) => {
        // NCOW-56: a resolved `{ok:false}` is a reported failure, not an
        // exception — mutexes.proxy.run()'s promise still fulfills, so the
        // `.catch()` below never sees it. Surface it through the exact same
        // notifyFailure() the reject path uses, then hand the result back
        // unchanged so callers (currently none inspect it, but nothing
        // should have to change if one starts) keep seeing the real value.
        if (result && result.ok === false) {
          const err = result.error ?? {};
          console.error(`[tray] ${label} failed:`, err.code ?? '', err.message ?? '');
          notifyFailure(label, err);
        }
        return result;
      })
      .catch((err) => {
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
