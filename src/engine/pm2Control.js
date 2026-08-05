'use strict';

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

const APP_NAME = 'litellm-nim';

/**
 * @param {string} [pm2Home]
 */
function resolvePm2Home(pm2Home) {
  return pm2Home || process.env.PM2_HOME || path.join(os.homedir(), '.pm2');
}

/**
 * Mirrors node_modules/pm2/paths.js exactly (NCOW-22 cause #1): on win32,
 * pm2 hardcodes a single static named pipe for its RPC transport regardless
 * of PM2_HOME — its own source has a `@todo` acknowledging this, and that
 * hardcoding wins even if PM2_DAEMON_RPC_PORT is also set (paths.js applies
 * the win32 override after the env-override loop). Everywhere else, pm2
 * honours a PM2_DAEMON_RPC_PORT env override on top of the plain
 * PM2_HOME-relative file path — mirror that here too, or a probe run under
 * an environment with that override set watches the wrong path forever.
 *
 * @param {string} [pm2Home]
 */
function resolveRpcSocketPath(pm2Home) {
  if (process.platform === 'win32') return '\\\\.\\pipe\\rpc.sock';
  if (process.env.PM2_DAEMON_RPC_PORT) return process.env.PM2_DAEMON_RPC_PORT;
  return path.join(resolvePm2Home(pm2Home), 'rpc.sock');
}

/**
 * Checks whether a pm2 daemon is already listening, WITHOUT going through
 * pm2's own Client/pingDaemon() machinery (NCOW-22). That matters because
 * pingDaemon() itself only ever calls back from axon's 'reconnect attempt'
 * or 'connect' socket events — on Windows, connecting to a named pipe with
 * nothing listening produces neither, so the callback simply never fires
 * and pm2.connect() hangs forever. A raw, independent connect probe lets us
 * decide up front whether a bootstrap is needed, before ever handing control
 * to pm2's own (unsafe, in this app) auto-launch-on-connect behaviour.
 *
 * @param {{pm2Home?: string, timeoutMs?: number}} [opts]
 * @returns {Promise<boolean>}
 */
function probeDaemonAlive(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 1500;
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.createConnection(resolveRpcSocketPath(opts.pm2Home));
    // Deliberately not unref'd: an unref'd timer is never guaranteed to fire
    // if it ends up the only thing keeping the event loop alive, which would
    // silently defeat the one job this timeout has.
    const timer = setTimeout(() => finish(false), timeoutMs);
    function finish(alive) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(alive);
    }
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

/**
 * Recreates the handful of files/folders pm2's own Client constructor
 * creates via initFileStructure() (node_modules/pm2/lib/Client.js) before it
 * ever pings or launches a daemon. Normal pm2 usage never needs this
 * duplicated: the Client half always runs first and lays this structure
 * down before the daemon is spawned. Here, spawnDaemon() below deliberately
 * runs *before* any pm2.connect() call (see probeDaemonAlive's doc comment),
 * so on a genuinely fresh machine PM2_HOME may not exist yet at all — this
 * recreates just enough of it that the daemon's own pub/rpc socket binds
 * (which are not forgiving of a missing parent directory) succeed.
 *
 * @param {string} pm2Home
 */
function ensurePm2HomeStructure(pm2Home) {
  for (const dir of [pm2Home, path.join(pm2Home, 'logs'), path.join(pm2Home, 'pids'), path.join(pm2Home, 'modules')]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // Best-effort, matching pm2's own initFileStructure(): a failure here
      // still lets the daemon attempt to start, and any real problem will
      // surface as a socket-bind failure below instead.
    }
  }
  const moduleConf = path.join(pm2Home, 'module_conf.json');
  try {
    if (!fs.existsSync(moduleConf)) fs.writeFileSync(moduleConf, '{}');
  } catch {
    // Best-effort; see above.
  }
}

// NCOW-24: Electron needs a handful of small companion files sitting next to
// its own executable to boot at all, even in ELECTRON_RUN_AS_NODE mode —
// empirically confirmed live on Windows: a bare copy of the executable alone
// crashes on launch with "Invalid file descriptor to ICU data received"
// before a single line of Daemon.js ever runs. `icudtl.dat` fixes that; the
// V8 snapshot files come along for the same reason (both are also required
// for a clean, zero-stderr launch in the same live test).
//
// `libffmpeg.so` is the Linux-only member of this list (review pass, NCOW-24
// fix pass #2): Electron's Linux binary has `DT_NEEDED: libffmpeg.so` with
// `RPATH=$ORIGIN`, i.e. the dynamic linker requires it sitting right next to
// the executable, exactly like the files above. Without it, `ld.so` refuses
// to load the relocated copy at all — confirmed live in a real x86_64 Ubuntu
// 22.04 container against a genuine `electron-v43.2.0-linux-x64` build: a
// copy missing `libffmpeg.so` fails with "error while loading shared
// libraries: libffmpeg.so: cannot open shared object file" and exit code
// 127 before any JS runs, exactly the failure mode that made spawnDaemon()
// reject with "pm2 daemon process exited during bootstrap"; adding it to
// this list and re-running the identical copy fixed it (`node -e
// '1+1'` under ELECTRON_RUN_AS_NODE printed `2`, exit code 0). It does not
// exist on win32 or inside a `node` interpreter, so the existsSync guard
// below makes it a no-op there, same as the files above.
//
// Copying is best-effort *per source file's existence* (see the
// `fs.existsSync` guard below) — a missing companion file that never existed
// in the source (e.g. a plain, non-Electron `node` binary, which has none of
// these) must never block the copy of the interpreter itself. But once a
// companion file DOES exist in the source, its copy is no longer optional:
// see resolveDaemonInterpreter()'s doc comment on why a partial copy must
// never be left in place as if it were complete (NCOW-24 review finding 3).
const DAEMON_INTERPRETER_COMPANION_FILES = ['icudtl.dat', 'snapshot_blob.bin', 'v8_context_snapshot.bin', 'libffmpeg.so'];

/**
 * NCOW-24: spawnDaemon() below hands pm2's Daemon.js `process.execPath`
 * itself as its interpreter — on win32/linux that is a single, flat
 * executable file, which is this app's own *installed* binary. Because the
 * daemon it becomes is detached and long-lived by design (pm2's whole
 * model), that file stays open for as long as the daemon runs, which is
 * indefinitely.
 *
 * **Corrected characterization (review pass, NCOW-24 fix pass #2) — do not
 * restate the original claim that this "blocks" a Windows update.** Verified
 * live against a real packaged NSIS install with a process still executing
 * off the installed binary:
 * - **Update: NOT blocked.** A silent NSIS reinstall (electron-updater's
 *   Windows update mechanism) *succeeds*: NSIS renames the running,
 *   locked image aside into `%TEMP%\ns*.tmp\old-install\` (Windows permits
 *   renaming a running image even though it refuses an in-place
 *   overwrite/delete) and queues its removal via
 *   `PendingFileRenameOperations`, then installs the new binary at the
 *   original path. The original "unchanged `LastWriteTime`" evidence for
 *   "blocked" was confounded: an unlocked, zero-process, same-version
 *   reinstall shows the identical unchanged mtime, because NSIS preserves
 *   archive timestamps regardless of locking — that observation carries no
 *   information about locking at all.
 * - **Uninstall: blocked, intermittently.** A silent uninstall exits 0,
 *   deregisters the Programs-and-Features entry, and deletes every *other*
 *   installed file, but leaves the locked multi-hundred-MB binary behind,
 *   still running, with no UI path left to discover or stop it. This is
 *   intermittent: if a preceding update already moved the original binary
 *   aside (per the update mechanism above), a subsequent uninstall
 *   completes cleanly instead.
 *
 * The fix below is still worth keeping even though the update half of the
 * original motivation was wrong: it directly fixes the real, reproduced
 * uninstall-blocking case. The fix: hand the daemon a private copy of the
 * interpreter instead of the installed binary itself, living under
 * `pm2Home` — a directory nothing an installer or updater ever touches — so
 * the installed binary is never the thing held open. Falls back to
 * `execPath` unchanged on any failure (a copy error, a missing source
 * file, …): this is a hardening improvement on top of a working bootstrap,
 * never a new way for bootstrap to fail.
 *
 * Not attempted on darwin: the installed binary there is one file deep
 * inside a multi-file `.app` bundle (its `Contents/Frameworks/Electron
 * Framework.framework/...` is where the bulk of it actually lives), so
 * "copy the executable and its companions" isn't the same small, flat
 * operation it is on win32/linux and hasn't been verified to even produce a
 * bootable copy. It also isn't the same bug there: unlike win32, macOS does
 * not block replacing or deleting a running executable's file in the first
 * place (an open file keeps its old inode until the process exits, exactly
 * as NCOW-22's wave-6 review observed — the daemon lingers and `lsof` still
 * shows it holding the framework binary, but nothing ever reported an actual
 * update/uninstall *failure* on macOS from it). See README.md/DESIGN.md for
 * how that side of NCOW-24 is handled instead — accurate documentation of
 * what persists and why, not a code change.
 *
 * **Integrity (review pass, NCOW-24 fix pass #2, finding 3):** a copy is only
 * ever considered valid once the executable AND every companion file that
 * exists in the source have landed at the destination — a size-matched exe
 * next to a missing/partial companion file (e.g. a crash mid-copy, a
 * disk-full condition, or an AV quarantine snatching one file) used to be
 * silently reused forever, and a broken copy like that fails to boot at all
 * (live-verified: deleting `icudtl.dat` from an already-created copy dies
 * instantly with an ICU data error and is never repaired). The copy itself
 * is now staged into a temp directory under `pm2Home` and atomically
 * `rename()`d into place only once every file has copied successfully, so a
 * crash mid-copy can never leave a "looks complete enough" directory behind
 * — either the rename lands a fully-populated directory, or the previous
 * (possibly still-good) directory is left completely untouched and the
 * incomplete temp directory is cleaned up.
 *
 * Note: the exe-size comparison this integrity check builds on is a
 * redundant-copy-avoidance heuristic, not a true staleness guarantee — two
 * different builds of this app can produce an exe of the exact same byte
 * size (this app's own code lives in `app.asar`, not the exe), so a stale
 * same-size copy can be reused across an upgrade. That's benign today: same
 * Electron version means the copy remains a functionally valid interpreter
 * for pm2's `Daemon.js` either way.
 *
 * @param {string} execPath
 * @param {string} pm2Home
 * @param {{platform?: string}} [opts] `platform` is a test-only override.
 * @returns {string} the path to actually spawn as the daemon's interpreter.
 */
function resolveDaemonInterpreter(execPath, pm2Home, opts = {}) {
  const platform = opts.platform ?? process.platform;
  if (platform === 'darwin') return execPath;

  const targetDir = path.join(pm2Home, 'daemon-interpreter');
  const targetExec = path.join(targetDir, path.basename(execPath));

  try {
    const srcStat = fs.statSync(execPath);
    const srcDir = path.dirname(execPath);
    const expectedCompanions = DAEMON_INTERPRETER_COMPANION_FILES.filter((name) =>
      fs.existsSync(path.join(srcDir, name))
    );

    const isCopyComplete =
      fs.existsSync(targetExec) &&
      fs.statSync(targetExec).size === srcStat.size &&
      expectedCompanions.every((name) => fs.existsSync(path.join(targetDir, name)));

    if (!isCopyComplete) {
      fs.mkdirSync(pm2Home, { recursive: true });
      // Stage the whole copy in a fresh temp directory first, then swap it
      // into place with a single rename — never write directly into
      // targetDir, or a crash/kill partway through leaves exactly the
      // "looks complete enough but actually broken" state this exists to
      // prevent.
      const tmpDir = fs.mkdtempSync(path.join(pm2Home, 'daemon-interpreter.tmp-'));
      try {
        fs.copyFileSync(execPath, path.join(tmpDir, path.basename(execPath)));
        for (const name of expectedCompanions) {
          fs.copyFileSync(path.join(srcDir, name), path.join(tmpDir, name));
        }
        // rmSync+rename rather than a direct overwrite: fs.renameSync onto
        // an existing non-empty directory fails on both win32 and POSIX.
        fs.rmSync(targetDir, { recursive: true, force: true });
        fs.renameSync(tmpDir, targetDir);
      } catch (err) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        throw err;
      }
    }
    return targetExec;
  } catch {
    // Best-effort overall: any failure here (permissions, disk full, a
    // source file that vanished mid-copy) must fall back to today's
    // behaviour rather than block the daemon from starting at all. A
    // failure here never leaves a partial copy in targetDir — see the
    // temp-dir staging above — so the next call gets a clean retry rather
    // than reusing a broken one.
    return execPath;
  }
}

/**
 * Spawns the pm2 daemon ourselves rather than trusting pm2's own
 * launchDaemon() (NCOW-22 cause #2): that spawns `process.execPath`, which
 * inside this app is the Electron binary itself, not a Node binary — its
 * child boots as a second GUI instance of this very app instead of running
 * Daemon.js at all. ELECTRON_RUN_AS_NODE makes the same binary behave as a
 * plain Node interpreter instead. For a packaged build, electron-builder.yml
 * additionally has to unpack pm2's own files from app.asar (cause #3): pm2
 * spawns Daemon.js by real script path, and a path inside app.asar can be
 * read but not executed as a child process. Electron's asar fs shim stays
 * active in this ELECTRON_RUN_AS_NODE child, so require()s of pm2's hoisted
 * deps (e.g. `debug`) that stay inside app.asar still resolve fine — only
 * pm2's own tree needs unpacking, not the whole node_modules closure.
 *
 * Reuses pm2's own lib/Daemon.js unmodified — it already self-daemonizes
 * and posts an IPC 'message' once its rpc/pub sockets are bound and ready,
 * exactly what pm2's own launchDaemon() itself waits for.
 *
 * On timeout specifically (NCOW-26), a merely-slow-but-healthy daemon —
 * one whose sockets end up bound after timeoutMs on a cold, contended, or
 * antivirus-scanned machine — is adopted via a fresh probeDaemonAlive()
 * check rather than killed outright: killing a daemon that would have come
 * up fine given a bit longer means every retry restarts from zero, so a
 * machine that consistently needs longer than timeoutMs never converges.
 * onError and onExit are genuine failures and are always killed, preserving
 * NCOW-22's leak fix.
 *
 * @param {{pm2Home?: string, timeoutMs?: number, spawn?: typeof spawn, execPath?: string, platform?: string}} [opts]
 *   `spawn` is a test-only override (NCOW-26) letting pm2Control.test.js
 *   drive the timeout/kill/adopt state machine below with a fully-controlled
 *   fake child; every real caller leaves it unset and gets the genuine
 *   node:child_process spawn — and, since resolveDaemonInterpreter()'s real
 *   filesystem copy would be pure overhead against a fake child that ignores
 *   its arguments anyway, a real `spawn` override also skips straight to the
 *   real `execPath` without attempting it. `execPath`/`platform` are
 *   test-only overrides for resolveDaemonInterpreter() (NCOW-24); every real
 *   caller leaves both unset and gets the genuine `process.execPath`/
 *   `process.platform`.
 * @returns {Promise<{pid: number}>}
 */
function spawnDaemon(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const pm2Home = resolvePm2Home(opts.pm2Home);
  ensurePm2HomeStructure(pm2Home);
  const usingRealSpawn = typeof opts.spawn !== 'function';
  const spawnFn = usingRealSpawn ? spawn : opts.spawn;
  const execPath = opts.execPath ?? process.execPath;
  const interpreter = usingRealSpawn ? resolveDaemonInterpreter(execPath, pm2Home, opts) : execPath;

  return new Promise((resolve, reject) => {
    const daemonScript = path.join(path.dirname(require.resolve('pm2/package.json')), 'lib', 'Daemon.js');
    const child = spawnFn(interpreter, [daemonScript], {
      detached: true,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1', PM2_HOME: pm2Home }),
    });

    let settled = false;
    // Deliberately not unref'd — see probeDaemonAlive's identical comment.
    const timer = setTimeout(onTimeout, timeoutMs);

    function finish(fn, arg) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('error', onError);
      child.removeListener('message', onMessage);
      child.removeListener('exit', onExit);
      if (fn === reject) {
        // onError, onExit, and a timeout with no daemon actually alive are
        // genuine failures: never leave a live, detached/unref'd daemon
        // behind. Without this, a persistent bootstrap failure leaks one
        // orphan pm2 daemon per retry, since AC#3's memo-clearing makes
        // every subsequent proxy:* call retry and status-poller.js polls
        // every 5s (NCOW-22 review finding). A timeout that finds the
        // daemon actually alive never reaches here — see onTimeout (NCOW-26).
        try {
          child.kill();
        } catch {
          // Best-effort — the child may already be gone.
        }
      }
      fn(arg);
    }
    function onError(err) {
      finish(reject, err);
    }
    function onMessage(msg) {
      try {
        child.disconnect();
      } catch {
        // Already disconnected/exited; nothing to do.
      }
      child.unref();
      finish(resolve, { pid: msg?.pid ?? child.pid });
    }
    function onExit(code) {
      finish(reject, new Error(`pm2 daemon process exited during bootstrap (code ${code})`));
    }
    async function onTimeout() {
      if (settled) return;
      // NCOW-26 mitigation: probe for real aliveness before giving up. A
      // "yes" here means the daemon bound its rpc/pub sockets later than
      // timeoutMs but is genuinely healthy — adopt it exactly like onMessage
      // does, instead of killing a process that would otherwise have been
      // found and reused by the next status-poller tick anyway.
      const alive = await probeDaemonAlive({ pm2Home }).catch(() => false);
      // onError/onMessage/onExit may have already settled this while the
      // probe above was in flight.
      if (settled) return;
      if (alive) {
        try {
          child.disconnect();
        } catch {
          // Already disconnected/exited; nothing to do.
        }
        child.unref();
        // No IPC 'message' ever arrived on this path, so unlike onMessage's
        // `msg?.pid ?? child.pid` there is no daemon-reported pid to prefer
        // — this is only the pid of the process we spawned, which can
        // differ from pm2's own self-daemonized pid. Inert today (the only
        // caller discards the resolved value); worth revisiting if a future
        // caller starts relying on the returned pid.
        finish(resolve, { pid: child.pid });
      } else {
        finish(reject, new Error(`pm2 daemon did not report ready within ${timeoutMs}ms`));
      }
    }

    child.once('error', onError);
    child.once('message', onMessage);
    child.once('exit', onExit);
    child.unref();
  });
}

/**
 * pm2 is bundled as a normal package.json dependency (not a detected
 * system prerequisite) and driven through its programmatic API rather than
 * a CLI subprocess. Its daemon (PM2_HOME, default ~/.pm2) is identified by
 * that directory regardless of which copy of the pm2 package connects to
 * it, so a separately-installed global pm2 CLI and this bundled copy see
 * the same running app list — `pm2 save`/daemon-restart-resurrect behavior
 * is unchanged. Because that daemon is shared, this module must never kill
 * it: quitting the app stops the litellm-nim *app* only (see main/shutdown.js),
 * leaving anything else the user supervises with pm2 untouched.
 *
 * @param {import('pm2')} pm2 — injected so this module stays plain-Node
 *   and mockable in tests without touching a real pm2 daemon.
 * @param {{probeDaemonAlive?: () => Promise<boolean>, spawnDaemon?: () => Promise<any>, ensureConnectedTimeoutMs?: number, pm2CallTimeoutMs?: number}} [deps]
 *   probeDaemonAlive/spawnDaemon are optional (NCOW-22): when supplied (see
 *   engine-context.js for the real wiring), ensureConnected() bootstraps a
 *   missing daemon itself before ever calling pm2.connect(). When omitted —
 *   as every pre-existing test in pm2Control.test.js does — ensureConnected()
 *   falls back to the simpler pre-NCOW-22 behaviour of calling pm2.connect()
 *   directly, still bounded by ensureConnectedTimeoutMs. pm2CallTimeoutMs
 *   (NCOW-48) bounds listApps()'s pm2.list call, deleteAppIfPresent()'s
 *   pm2.delete call, and save()'s pm2.dump call — reachable from
 *   uninstall.run(), from proxy:start/proxy:restart (via startOrRestart()),
 *   and from the 5-second status poll (via getStatus() -> findApp() ->
 *   listApps()) — see withTimeout below for why those three specifically
 *   needed it.
 */
function createPm2Control(pm2, deps = {}) {
  let connected = null;
  const ensureConnectedTimeoutMs = deps.ensureConnectedTimeoutMs ?? 30_000;
  // NCOW-48: listApps()'s pm2.list callback, deleteAppIfPresent()'s pm2.delete
  // callback, and save()'s pm2.dump callback were the last three raw,
  // unbounded pm2 callbacks reachable from uninstall.run() — ensureConnected()
  // below was already bounded (NCOW-22), but a daemon that accepts the
  // connection and then never calls back to pm2.list/pm2.delete/pm2.dump
  // sailed straight past that bound and hung forever.
  //
  // Fix-pass correction: an earlier pass of this task bounded only pm2.delete
  // and pm2.dump, one call too late — deleteAppIfPresent() (and remove(),
  // which calls it) reaches findApp() -> listApps() -> pm2.list BEFORE it
  // ever reaches pm2.delete, so a daemon wedged at pm2.list sailed straight
  // past both of those bounds without either ever engaging. listApps()'s own
  // bound below closes that gap.
  //
  // Since NCOW-45/NCOW-47 widened uninstall's IPC alias to hold the
  // claudeCode, config, AND proxy locks for the whole call (see ipc.js's
  // DOMAIN_MUTEX_ALIASES), an unbounded wait anywhere in this chain freezes
  // Start/Stop/Restart, config generation, Claude Code configure/remove, and
  // apiKey:validateAndSave/apiKey:clear all at once.
  //
  // This bound is reachable well beyond uninstall.run(), on two more paths:
  // - startOrRestart() calls deleteAppIfPresent() before pm2.start() and
  //   save() after the health check succeeds, so proxy:start/proxy:restart
  //   can now also surface PM2_DELETE_TIMEOUT/PM2_SAVE_TIMEOUT. That widens
  //   what this bound touches but is a net improvement, not a new hazard —
  //   nothing outside ipc.js/engine-context.js reads error.code.
  // - getStatus() -> findApp() -> listApps() puts this same bound on
  //   status-poller.js's 5-second poll. Today (verified against
  //   src/main/status-poller.js), a wedged pm2.list silently accumulates one
  //   pending promise per tick forever: setInterval calls tick() again every
  //   5s regardless of whether the previous tick's `await
  //   pm2Control.getStatus()` ever settled, and nothing times that out. After
  //   this bound, getStatus() instead rejects once pm2CallTimeoutMs elapses,
  //   tick()'s existing `catch { onStatus({status:'errored'}) }` fires, and
  //   the status pill reports errored instead of silently freezing at its
  //   last value — and the per-tick promise accumulation stops.
  //
  // NCOW-52 closed the same gap for the three raw pm2 callbacks NCOW-48 named
  // as follow-up (found by NCOW-48's own integration review) but explicitly
  // left out of scope: stop()'s pm2.stop, startOrRestart()'s pm2.start, and
  // startLogTail()'s pm2.launchBus. Same lock hazard, one door down:
  // - stop()'s pm2.stop is now bound to PM2_STOP_TIMEOUT — reachable from the
  //   proxy:stop IPC channel (engine-context.js's `handlers.proxy.stop`,
  //   locked under mutexes.proxy) and from tray.js's Stop menu item (which
  //   runs the same handler under the same lock). It is ALSO reachable from
  //   main/shutdown.js's stopProxyForShutdown() on the quit path — but that
  //   caller reaches pm2Control directly, outside any IPC lock, and already
  //   wraps this same call in its own independent withTimeout() (default
  //   15s, matching pm2CallTimeoutMs's own default below) — see AC#8's
  //   reasoning on why stacking a second, inner bound underneath a
  //   pre-existing outer one changes nothing observable there.
  // - startOrRestart()'s pm2.start is now bound to PM2_START_TIMEOUT —
  //   reachable from everywhere startOrRestart() itself already was
  //   (proxy:start/proxy:restart, and configGen.js's launch-time stale-config
  //   background restart), for the same reason listApps()'s bound widened to
  //   cover those callers above.
  // - startLogTail()'s pm2.launchBus is now bound to PM2_LOG_TAIL_TIMEOUT —
  //   reachable from the proxy:start-log-tail IPC channel
  //   (engine-context.js's `handlers.proxy.startLogTail`), which ipc.js's
  //   UNSERIALIZED_METHODS comment keeps locked under mutexes.proxy because
  //   it mutates the single `logTailUnsubscribe` slot. Named after the public
  //   feature (starting the live log tail) rather than the raw pm2 API name,
  //   the same choice PM2_SAVE_TIMEOUT already made over "PM2_DUMP_TIMEOUT"
  //   above. Bounding this one needed an extra step the other five didn't:
  //   pm2.launchBus's callback hands back a live bus handle, not just a
  //   completion signal, so a callback that fires AFTER the bound has already
  //   given up must still close that bus, or it leaks an open pm2 pub-socket
  //   connection with no owner left to ever unsubscribe it — see
  //   startLogTail()'s own doc comment for how the fix avoids that leak.
  //
  // 15s matches main/shutdown.js's own bounded pm2.stop() precedent — long
  // enough that a slow-but-healthy daemon still completes normally (this is
  // the success path AC#5 requires to stay unchanged), short enough that a
  // genuinely wedged daemon can no longer hang the app indefinitely.
  const pm2CallTimeoutMs = deps.pm2CallTimeoutMs ?? 15_000;

  function withTimeout(promise, ms, message, code) {
    let timer;
    // Deliberately not unref'd: this timer is the only thing that will ever
    // settle the race if the connect attempt is genuinely wedged (NCOW-22
    // AC#3), so letting the loop exit past it is exactly the hang it exists
    // to prevent — same reasoning as main/shutdown.js's identical helper.
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(message);
        // NCOW-48 AC#2: a `code` lets a timeout here surface through
        // ipc.js's handler wrapper as a specific, actionable
        // {ok:false, error:{code, message}} — e.g. PM2_DELETE_TIMEOUT —
        // rather than falling through to that wrapper's generic
        // 'UNEXPECTED' fallback (ipc.js only substitutes that fallback when
        // `err.code` is falsy).
        if (code) err.code = code;
        reject(err);
      }, ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  function pm2ConnectOnce() {
    return new Promise((resolve, reject) => {
      pm2.connect((err) => (err ? reject(err) : resolve()));
    });
  }

  async function connectWithBootstrap() {
    if (typeof deps.probeDaemonAlive === 'function' && typeof deps.spawnDaemon === 'function') {
      const alive = await deps.probeDaemonAlive().catch(() => false);
      if (!alive) {
        // No daemon is listening yet: the cold-bootstrap case (NCOW-22).
        // Spawning it ourselves here means that by the time pm2.connect()
        // below runs, a real daemon is already up — so pm2's own
        // pingDaemon() takes its normal fast 'connect' path on every
        // platform, and its own (unsafe, in this app) auto-launch-on-connect
        // logic never has to run at all.
        await deps.spawnDaemon();
      }
    }
    await pm2ConnectOnce();
  }

  function ensureConnected() {
    if (!connected) {
      connected = withTimeout(
        connectWithBootstrap(),
        ensureConnectedTimeoutMs,
        `pm2 connect timed out after ${ensureConnectedTimeoutMs}ms`
      ).catch((err) => {
        // A wedged/failed attempt must never permanently poison every future
        // proxy:* IPC call for the rest of the app's lifetime (NCOW-22 AC#3):
        // clear the memo so the next caller gets a fresh attempt instead of
        // this same rejected promise forever.
        connected = null;
        throw err;
      });
    }
    return connected;
  }

  function disconnect() {
    if (connected) {
      pm2.disconnect();
      connected = null;
    }
  }

  async function listApps() {
    await ensureConnected();
    return withTimeout(
      new Promise((resolve, reject) => {
        pm2.list((err, list) => (err ? reject(err) : resolve(list)));
      }),
      pm2CallTimeoutMs,
      `pm2 list timed out after ${pm2CallTimeoutMs}ms`,
      'PM2_LIST_TIMEOUT'
    );
  }

  async function findApp() {
    const apps = await listApps();
    return apps.find((app) => app.name === APP_NAME) || null;
  }

  async function deleteAppIfPresent() {
    await ensureConnected();
    const existing = await findApp();
    if (!existing) return;
    await withTimeout(
      new Promise((resolve, reject) => {
        pm2.delete(APP_NAME, (err) => (err ? reject(err) : resolve()));
      }),
      pm2CallTimeoutMs,
      `pm2 delete timed out after ${pm2CallTimeoutMs}ms`,
      'PM2_DELETE_TIMEOUT'
    );
  }

  async function save() {
    await ensureConnected();
    return withTimeout(
      new Promise((resolve, reject) => {
        pm2.dump((err) => (err ? reject(err) : resolve()));
      }),
      pm2CallTimeoutMs,
      `pm2 dump timed out after ${pm2CallTimeoutMs}ms`,
      'PM2_SAVE_TIMEOUT'
    );
  }

  /**
   * @param {string} logPath
   * @param {number} lineCount
   */
  async function tailLastLines(logPath, lineCount) {
    try {
      const content = await fs.promises.readFile(logPath, 'utf8');
      return content.split('\n').filter(Boolean).slice(-lineCount);
    } catch {
      return [];
    }
  }

  /**
   * @param {number} port
   * @param {AbortSignal} [signal]
   */
  async function healthCheckOnce(port, signal) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/liveliness`, { signal });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * DESIGN.md section 7.2 start sequence: delete any existing litellm-nim
   * app first (idempotent re-setup), start from the ecosystem file, poll
   * health every 2s up to healthTimeoutMs, save on success, capture the
   * last 50 log lines on timeout.
   *
   * NCOW-52: the pm2.start callback below is bounded the same way
   * deleteAppIfPresent()/save() already are (NCOW-48) — a daemon that never
   * calls back leaves this raw callback the only unbounded step left in the
   * whole proxy:start/proxy:restart chain. Surfaces as PM2_START_TIMEOUT,
   * reachable from proxy:start, proxy:restart (which just calls start again),
   * and the launch-time background restart (configGen.js's
   * regenerateStaleConfig()), all of which hold mutexes.proxy for the call's
   * duration.
   *
   * @param {{ecosystemConfigPath: string, port: number, outLog: string, errLog: string, healthTimeoutMs?: number}} opts
   */
  async function startOrRestart(opts) {
    const healthTimeoutMs = opts.healthTimeoutMs ?? 60_000;

    await ensureConnected();
    await deleteAppIfPresent();

    await withTimeout(
      new Promise((resolve, reject) => {
        pm2.start(opts.ecosystemConfigPath, (err) => (err ? reject(err) : resolve()));
      }),
      pm2CallTimeoutMs,
      `pm2 start timed out after ${pm2CallTimeoutMs}ms`,
      'PM2_START_TIMEOUT'
    );

    const deadline = Date.now() + healthTimeoutMs;
    while (Date.now() < deadline) {
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), 2000);
      const healthy = await healthCheckOnce(opts.port, controller.signal);
      clearTimeout(abortTimer);
      if (healthy) {
        await save();
        return { ok: true };
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const [outTail, errTail] = await Promise.all([
      tailLastLines(opts.outLog, 50),
      tailLastLines(opts.errLog, 50),
    ]);
    return { ok: false, error: { code: 'HEALTH_CHECK_TIMEOUT', message: 'litellm did not become healthy in time.' }, outTail, errTail };
  }

  /**
   * NCOW-52: bounds the pm2.stop callback the same way NCOW-48 bounded
   * pm2.list/pm2.delete/pm2.dump — this was the last raw, unbounded pm2
   * callback on the proxy:stop path. Surfaces as PM2_STOP_TIMEOUT, reachable
   * from the proxy:stop IPC channel (engine-context.js's
   * `handlers.proxy.stop`, locked under mutexes.proxy) and from tray.js's
   * Stop menu item, which runs that same handler under the same lock.
   *
   * Also reachable from main/shutdown.js's stopProxyForShutdown() on the quit
   * path — but that caller already wraps this whole call in its own,
   * independent withTimeout() (see shutdown.js), reached directly and
   * deliberately outside any IPC lock so a wedged pm2 can never make the app
   * unquittable (CLAUDE.md). Adding this inner bound underneath that
   * pre-existing outer one changes nothing observable at the shutdown call
   * site (AC#8): a genuine hang was already capped by the outer bound before
   * this task, a genuine success was already far faster than either bound,
   * and shutdown.js's own catch-all around the call never inspected
   * `err.code`, so the newly-populated code is inert there.
   */
  async function stop() {
    await ensureConnected();
    return withTimeout(
      new Promise((resolve, reject) => {
        pm2.stop(APP_NAME, (err) => (err ? reject(err) : resolve()));
      }),
      pm2CallTimeoutMs,
      `pm2 stop timed out after ${pm2CallTimeoutMs}ms`,
      'PM2_STOP_TIMEOUT'
    );
  }

  async function remove() {
    await ensureConnected();
    await deleteAppIfPresent();
    await save();
  }

  /**
   * @returns {Promise<{status: 'running'|'stopped'|'errored'|'not-installed', pid?: number, uptime?: number, restarts?: number}>}
   */
  async function getStatus() {
    const app = await findApp();
    if (!app) return { status: 'not-installed' };
    const status = app.pm2_env?.status;
    return {
      status: status === 'online' ? 'running' : status === 'stopped' ? 'stopped' : 'errored',
      pid: app.pid,
      uptime: app.pm2_env?.pm_uptime,
      restarts: app.pm2_env?.restart_time,
    };
  }

  /**
   * Live log tail via pm2's own bus (works regardless of which process
   * started litellm-nim, matching the shared-daemon interop above).
   *
   * NCOW-52: pm2.launchBus's raw callback was the last unbounded pm2
   * callback in this file — a daemon that never calls back here hangs
   * proxy:start-log-tail forever, which (per ipc.js's UNSERIALIZED_METHODS
   * comment) holds mutexes.proxy for the whole call because startLogTail
   * mutates engine-context.js's single `logTailUnsubscribe` slot. Bounded to
   * PM2_LOG_TAIL_TIMEOUT, named after the public feature (the live log
   * viewer) rather than the raw pm2 API — the same choice save()'s
   * PM2_SAVE_TIMEOUT already made over the raw "pm2.dump" name.
   *
   * This one can't reuse the plain withTimeout() helper unchanged, unlike
   * every other bounded call in this file: pm2.launchBus's callback hands
   * back a live bus handle, not just a completion signal. withTimeout() only
   * races the promise — it never cancels the losing side — so if the bound
   * fires first and the daemon's callback still arrives later, a plain race
   * would silently attach `handler` to a bus nothing ever unsubscribes or
   * closes, leaking an open pm2 pub-socket connection with no owner left to
   * ever call the unsubscribe function this call was supposed to hand back
   * (stop/start/list/delete/dump have nothing comparable to leak on a late
   * callback — they either produce no handle at all, or a discarded value).
   * The manual timeout below keeps the same PM2_LOG_TAIL_TIMEOUT contract but
   * closes any bus that arrives after the bound already gave up, mirroring
   * spawnDaemon()'s own "never leave a live resource behind a timeout"
   * discipline elsewhere in this file.
   *
   * @param {(entry: {process: string, data: string, at: 'out'|'err'}) => void} onLine
   * @returns {Promise<() => void>} unsubscribe function
   */
  async function startLogTail(onLine) {
    await ensureConnected();
    return new Promise((resolve, reject) => {
      let settled = false;
      // Deliberately not unref'd — same reasoning as every other timer in
      // this file: it is the only thing that settles this promise if
      // pm2.launchBus never calls back at all.
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const err = new Error(`pm2 launchBus timed out after ${pm2CallTimeoutMs}ms`);
        err.code = 'PM2_LOG_TAIL_TIMEOUT';
        reject(err);
      }, pm2CallTimeoutMs);

      pm2.launchBus((err, bus) => {
        if (settled) {
          // The bound already fired and this call's caller has moved on —
          // close a late-arriving bus rather than leak it (see doc comment
          // above).
          if (!err && bus) {
            try {
              bus.close();
            } catch {
              // Best-effort; nothing left to report this to.
            }
          }
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (err) return reject(err);
        const handler = (packet) => {
          if (packet.process?.name !== APP_NAME) return;
          onLine({ process: packet.process.name, data: packet.data, at: packet.type === 'err' ? 'err' : 'out' });
        };
        bus.on('log:out', handler);
        bus.on('log:err', handler);
        resolve(() => {
          bus.off('log:out', handler);
          bus.off('log:err', handler);
          bus.close();
        });
      });
    });
  }

  /**
   * Print-only guidance — DESIGN.md section 7.2 step 5: the app must never
   * run sudo itself.
   *
   * NCOW-27 AC#3: `pm2 startup`/a scheduled `pm2 resurrect` persists this
   * app's own `interpreter: process.execPath` (see configGen.js's
   * renderEcosystemConfigCjs) into dump.pm2 under PM2_HOME. That's stable
   * for an installed .deb — the path never moves between launches — but NOT
   * for an AppImage run in place: AppImageKit self-mounts to a fresh,
   * per-launch FUSE temp path (e.g. /tmp/.mount_XXXXXX/...) and unmounts it
   * the instant that AppImage process exits, so a resurrect attempted after
   * THIS AppImage instance is gone would try to launch a path that no
   * longer exists. This app itself never calls `pm2 save`/`resurrect` in a
   * way that reads that stale state back (its own `save()` calls only ever
   * write the CURRENT, still-valid path, and it never resurrects), so
   * nothing in this app's own runtime is at risk — the one place this
   * risk is actually reachable is here, if a user follows this exact
   * guidance while running an unextracted AppImage. `env.APPIMAGE` is set
   * by the AppImage runtime itself (pointing at the stable .AppImage file,
   * not its ephemeral mount) and is how this function tells the two apart.
   *
   * @param {string} platform
   * @param {NodeJS.ProcessEnv} [env]
   */
  function getBootPersistenceGuidance(platform, env = process.env) {
    if (platform === 'win32') {
      return (
        'pm2 has no first-party boot service on Windows. To resume the proxy after a reboot, ' +
        'either install the community pm2-windows-startup package, or add a Windows Task ' +
        'Scheduler entry that runs "pm2 resurrect" at logon — this app will never do that setup ' +
        'or run that command for you.'
      );
    }
    const base = 'To survive a reboot (not just a pm2 daemon restart), run `pm2 startup` yourself and follow the sudo command it prints. This app will never run that command for you.';
    if (platform === 'linux' && env.APPIMAGE) {
      return (
        base +
        ' Note: this does NOT work when running as an AppImage in place — pm2 would persist ' +
        "this specific launch's temporary mount path, which stops existing the moment you close " +
        'this AppImage, so the resurrected process fails to start on next boot. Extract the ' +
        'AppImage or install the .deb build instead if you want the proxy to survive reboots.'
      );
    }
    return base;
  }

  return {
    APP_NAME,
    ensureConnected,
    disconnect,
    listApps,
    findApp,
    startOrRestart,
    stop,
    remove,
    getStatus,
    startLogTail,
    tailLastLines,
    getBootPersistenceGuidance,
    save,
  };
}

module.exports = {
  createPm2Control,
  APP_NAME,
  probeDaemonAlive,
  spawnDaemon,
  resolveRpcSocketPath,
  resolvePm2Home,
  resolveDaemonInterpreter,
};
