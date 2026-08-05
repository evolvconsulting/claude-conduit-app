'use strict';

/**
 * Auto-update orchestration (NCOW-10.1). See docs/auto-update.md for the full
 * mechanism decision and per-platform support matrix — the summary that
 * matters for this module:
 *
 *  - Windows (NSIS) and Linux (AppImage) get a real electron-updater path:
 *    checkForUpdates() downloads silently in the background and the user
 *    explicitly confirms installing it (installUpdateAndRestart()).
 *  - macOS is notify-only until real code-signing certificates exist.
 *    Squirrel.Mac verifies a downloaded update's code signature before
 *    installing it, so handing an ad-hoc-signed build to electron-updater's
 *    Mac path would just fail downstream. Instead this checks the GitHub
 *    Releases API directly (src/engine/updateCheck.js) purely to answer "is
 *    there a newer tag", and surfaces a link to the release page — it never
 *    downloads or installs anything on macOS.
 *  - Any check failure (offline, rate-limited, GitHub error, no release
 *    published yet) degrades to an `error`/`not-available`-shaped status,
 *    never a throw — see checkForUpdates()'s doc comment.
 *
 * Written as a factory over injected dependencies (electron-updater's
 * `autoUpdater`, the engine's version-check module, the platform, and the
 * app's existing proxy-shutdown primitives) so this is unit-testable without
 * a real Electron process or a live GitHub Releases feed, matching every
 * other module under src/main/ and src/engine/.
 */

const { describeThrownValue, safeStringify, safeReadProperty } = require('../engine/configGen');

const DEFAULT_REPO = 'evolvconsulting/claude-conduit';

/**
 * @param {{
 *   autoUpdater: {
 *     autoDownload?: boolean,
 *     autoInstallOnAppQuit?: boolean,
 *     on: (event: string, listener: (...args: any[]) => void) => void,
 *     checkForUpdates: () => Promise<any>,
 *     quitAndInstall: () => void,
 *   },
 *   platform: NodeJS.Platform,
 *   currentVersion: string,
 *   isPackaged: boolean,
 *   updateCheck: {checkLatestRelease: (opts: object) => Promise<any>},
 *   broadcast: (status: object) => void,
 *   stopProxyForShutdown: () => Promise<any>,
 *   stopStatusPoller?: () => void,
 *   markShuttingDown: () => void,
 *   repo?: string,
 *   log?: (msg: string) => void,
 * }} deps
 */
function createAutoUpdate(deps) {
  const log = deps.log ?? ((msg) => console.log(`[auto-update] ${msg}`));
  const repo = deps.repo ?? DEFAULT_REPO;
  const releasesUrl = `https://github.com/${repo}/releases/latest`;

  let installInProgress = false;
  let eventsWired = false;

  // Last status broadcast, and the in-flight check promise (if any). Together
  // these make checkForUpdates() safe to call more than once — see its own
  // doc comment for why that matters (NCOW-10.1 fix pass: the renderer calls
  // this again right after it subscribes to update:status-changed, to
  // recover from the startup check's broadcast racing ahead of that
  // subscription).
  let lastStatus = null;
  let hasChecked = false;
  let pendingCheck = null;

  function emit(status) {
    lastStatus = { currentVersion: deps.currentVersion, ...status };
    deps.broadcast(lastStatus);
  }

  // Only ever attached on the Windows/Linux (electron-updater) path — macOS
  // never touches deps.autoUpdater at all, see checkForUpdates() below.
  function wireAutoUpdaterEvents() {
    if (eventsWired) return;
    eventsWired = true;
    const au = deps.autoUpdater;

    au.autoDownload = true;
    // Deliberately false: silently installing on a normal quit would take
    // the proxy down through a path that never runs shutdown.js's stop
    // first (see installUpdateAndRestart's header). Requiring an explicit
    // "Restart to install" is what keeps proxy shutdown ordering exact
    // instead of racing electron-updater's own internal quit handling.
    au.autoInstallOnAppQuit = false;

    au.on('checking-for-update', () => emit({ state: 'checking' }));
    au.on('update-available', (info) => emit({ state: 'downloading', latestVersion: info?.version, releaseUrl: releasesUrl }));
    au.on('update-not-available', (info) => emit({ state: 'not-available', latestVersion: info?.version }));
    au.on('download-progress', (progress) => emit({ state: 'downloading', percent: progress?.percent }));
    au.on('update-downloaded', (info) => emit({ state: 'downloaded', latestVersion: info?.version, releaseUrl: releasesUrl }));
    au.on('error', (err) => {
      // electron-updater's own error event — e.g. no publish config resolved
      // (an unpackaged/dev checkout), a bad network, or a corrupt download.
      // Same contract as every other failure mode: log it, tell the
      // renderer, never throw. NCOW-37: `err?.message ?? String(err)` is
      // exactly the unguarded pattern NCOW-36 hardened configGen.js away
      // from — a thrown/emitted Object.create(null) makes bare String()
      // itself throw, and a throwing `.message` getter breaks even the
      // optional-chaining read, either of which would make this "never
      // throw" handler throw. Reuse configGen.js's describeThrownValue()
      // (identical safe-stringification contract: prefer a real `.message`,
      // coerced safely, else fall back to safely stringifying the whole
      // value) instead of re-deriving the same guard here.
      const message = describeThrownValue(err);
      log(`electron-updater error, degrading gracefully: ${message}`);
      emit({ state: 'error', message });
    });
  }

  /**
   * Does the actual platform-specific check. Always resolves — every failure
   * mode (offline, rate-limited, GitHub error, no release published, a
   * dev/unpackaged build with nothing to compare against) degrades to a
   * status broadcast rather than a rejection, so a caller can fire this from
   * app startup without an enclosing try/catch and without ever delaying the
   * window from showing. Not exported directly — see checkForUpdates below,
   * which wraps this with caching/coalescing.
   */
  async function performCheck() {
    // --dev / unpackaged runs have no installed artifact for electron-updater
    // to diff against or install over, and no `latest*.yml`/app-update.yml
    // is even packed outside a real build. Every `npm run dev` hitting the
    // GitHub API and logging noise about it would be pure distraction.
    if (!deps.isPackaged) {
      emit({ state: 'skipped', message: 'Update checks are disabled in unpackaged/dev builds.' });
      return { ok: true, skipped: true };
    }

    if (deps.platform === 'darwin') {
      emit({ state: 'checking' });
      const result = await deps.updateCheck.checkLatestRelease({ currentVersion: deps.currentVersion, repo });
      if (!result.ok) {
        // NCOW-40: result.error here is updateCheck.js's own RETURNED failure
        // object, not a thrown value — but it is exactly as exposed to a
        // hostile/malformed shape as pm2Control's equivalent RETURNED failure
        // object is (configGen.js's regenerateStaleConfig() 'restart-failed'
        // branch, NCOW-37): a throwing `.code`/`.message` getter, or a field
        // whose bare String() itself throws (e.g. Object.create(null)), or
        // `result.error` itself being null/undefined. Read and stringify both
        // fields through the same safe guards rather than interpolating them
        // raw, so this line — and this function's own "Always resolves" doc
        // comment above — can't be falsified by a hostile check result.
        const errorCode = safeStringify(safeReadProperty(result.error, 'code'));
        const errorMessage = safeStringify(safeReadProperty(result.error, 'message'));
        log(`update check failed, degrading gracefully: ${errorCode} ${errorMessage}`);
        emit({ state: 'error', message: errorMessage });
        return result;
      }
      emit(
        result.updateAvailable
          ? { state: 'notify-only', latestVersion: result.latestVersion, releaseUrl: result.releaseUrl }
          : { state: 'not-available', latestVersion: result.latestVersion },
      );
      return result;
    }

    // Windows/Linux: electron-updater reads app-update.yml (generated by
    // electron-builder from the same repository metadata that already
    // produces latest.yml/latest-linux.yml — see NCOW-9/docs/distribution.md)
    // and can silently download and verify an update with no certificate.
    wireAutoUpdaterEvents();
    try {
      await deps.autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (err) {
      // checkForUpdates() rejecting outright (offline, DNS failure, no
      // publish config resolvable, GitHub down, ...) must degrade exactly
      // like every other failure mode here — never throw out of this
      // function. NCOW-40: this used to interpolate `err.message` raw, which
      // is exactly the unguarded pattern the au.on('error', ...) handler
      // above was already hardened away from (NCOW-37) — a thrown
      // Object.create(null) makes bare `.message` access moot but a plain
      // `null`/`undefined` thrown value makes `err.message` itself throw
      // (Cannot read properties of null/undefined), which would make this
      // "Always resolves" function's own catch block reject in its place.
      // Reuse describeThrownValue() exactly as that handler does.
      const message = describeThrownValue(err);
      log(`checkForUpdates() rejected, degrading gracefully: ${message}`);
      emit({ state: 'error', message });
      return { ok: false, error: { code: 'CHECK_FAILED', message } };
    }
  }

  /**
   * Public entry point. Wraps performCheck() with caching/coalescing so it is
   * safe to call more than once — which matters for a specific race
   * (NCOW-10.1 fix pass): the startup check in main/index.js fires on the
   * very next microtask after whenReady, while the renderer doesn't
   * subscribe to update:status-changed until after three awaited IPC round
   * trips (including proxy.getStatus, which can take 1s+ to connect to a
   * cold pm2 daemon). The GitHub Releases check itself typically finishes in
   * ~150ms, so the startup broadcast is very likely sent — and silently
   * dropped — before anyone is listening, with nothing to recover it. The
   * renderer's fix is to call this again immediately after it subscribes;
   * this wrapper is what makes that safe and cheap:
   *
   *  - a call that lands while a check is already in flight joins that same
   *    promise instead of starting a second one;
   *  - a call that lands after the last check has already finished just
   *    replays its cached status instead of hitting the network (or
   *    electron-updater) again.
   *
   * That second case isn't just politeness: calling electron-updater's
   * checkForUpdates() a second time while a download from the first call is
   * still in flight can start a second concurrent download against the same
   * pending-update cache directory (electron-updater clears that directory
   * at the start of each new download), corrupting whichever download loses
   * the race. Replaying the cached status instead avoids that entirely.
   *
   * The "has a check already completed" gate is `hasChecked`, not merely
   * `lastStatus` being non-null: on the Windows/Linux path, `lastStatus` is
   * only ever populated by an `au.on(...)` event actually firing (see
   * wireAutoUpdaterEvents above), not directly by performCheck() itself —
   * in real electron-updater that always happens ('checking-for-update' is
   * the first thing it emits), but nothing here should *require* it in
   * order to avoid re-triggering a real check.
   */
  async function checkForUpdates() {
    if (pendingCheck) return pendingCheck;
    if (hasChecked) {
      if (lastStatus) deps.broadcast(lastStatus);
      return { ok: true, replayed: true };
    }
    pendingCheck = performCheck();
    try {
      return await pendingCheck;
    } finally {
      hasChecked = true;
      pendingCheck = null;
    }
  }

  /**
   * Installs a downloaded update and restarts into it. Only meaningful after
   * an 'update-downloaded' event (Windows/Linux only — macOS never downloads
   * anything, see checkForUpdates above) and only ever triggered by an
   * explicit user action (the renderer's "Restart to install" control), not
   * automatically on quit — see the autoInstallOnAppQuit note above.
   *
   * Proxy-restart behaviour (this task's AC#5): reuses shutdown.js's
   * stopProxyForShutdown exactly as main/index.js's own 'before-quit' handler
   * does — no second way of stopping litellm-nim is invented here. After the
   * proxy is down, `markShuttingDown()` flips the same `shuttingDown` latch
   * that handler checks, so if quitAndInstall() triggers Electron's own
   * 'before-quit' internally, that handler's stop-then-requit dance steps
   * aside instead of trying to stop an already-stopped proxy a second time.
   */
  async function installUpdateAndRestart() {
    if (installInProgress) return { ok: false, error: { code: 'ALREADY_INSTALLING', message: 'An install is already in progress.' } };
    installInProgress = true;
    try {
      deps.stopStatusPoller?.();
      await deps.stopProxyForShutdown();
      deps.markShuttingDown();
      deps.autoUpdater.quitAndInstall();
      return { ok: true };
    } finally {
      installInProgress = false;
    }
  }

  return { checkForUpdates, installUpdateAndRestart, releasesUrl, repo };
}

module.exports = { createAutoUpdate, DEFAULT_REPO };
