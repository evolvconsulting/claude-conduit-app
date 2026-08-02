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
 * of PM2_HOME — its own source has a `@todo` acknowledging this. Everywhere
 * else the socket is a plain file under PM2_HOME.
 *
 * @param {string} [pm2Home]
 */
function resolveRpcSocketPath(pm2Home) {
  if (process.platform === 'win32') return '\\\\.\\pipe\\rpc.sock';
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

/**
 * Spawns the pm2 daemon ourselves rather than trusting pm2's own
 * launchDaemon() (NCOW-22 cause #2): that spawns `process.execPath`, which
 * inside this app is the Electron binary itself, not a Node binary — its
 * child boots as a second GUI instance of this very app instead of running
 * Daemon.js at all. ELECTRON_RUN_AS_NODE makes the same binary behave as a
 * plain Node interpreter instead. For a packaged build, electron-builder.yml
 * additionally has to keep pm2's *entire* dependency closure — not just
 * pm2's own files — unpacked from app.asar for this to work (cause #3): a
 * plain-Node child spawned from the asar-unpacked copy of pm2/lib/Daemon.js
 * cannot require() hoisted deps (e.g. `debug`) that stayed inside app.asar.
 *
 * Reuses pm2's own lib/Daemon.js unmodified — it already self-daemonizes
 * and posts an IPC 'message' once its rpc/pub sockets are bound and ready,
 * exactly what pm2's own launchDaemon() itself waits for.
 *
 * @param {{pm2Home?: string, timeoutMs?: number}} [opts]
 * @returns {Promise<{pid: number}>}
 */
function spawnDaemon(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const pm2Home = resolvePm2Home(opts.pm2Home);
  ensurePm2HomeStructure(pm2Home);

  return new Promise((resolve, reject) => {
    const daemonScript = path.join(path.dirname(require.resolve('pm2/package.json')), 'lib', 'Daemon.js');
    const child = spawn(process.execPath, [daemonScript], {
      detached: true,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1', PM2_HOME: pm2Home }),
    });

    let settled = false;
    // Deliberately not unref'd — see probeDaemonAlive's identical comment.
    const timer = setTimeout(
      () => finish(reject, new Error(`pm2 daemon did not report ready within ${timeoutMs}ms`)),
      timeoutMs
    );

    function finish(fn, arg) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('error', onError);
      child.removeListener('message', onMessage);
      child.removeListener('exit', onExit);
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
 * @param {{probeDaemonAlive?: () => Promise<boolean>, spawnDaemon?: () => Promise<any>, ensureConnectedTimeoutMs?: number}} [deps]
 *   probeDaemonAlive/spawnDaemon are optional (NCOW-22): when supplied (see
 *   engine-context.js for the real wiring), ensureConnected() bootstraps a
 *   missing daemon itself before ever calling pm2.connect(). When omitted —
 *   as every pre-existing test in pm2Control.test.js does — ensureConnected()
 *   falls back to the simpler pre-NCOW-22 behaviour of calling pm2.connect()
 *   directly, still bounded by ensureConnectedTimeoutMs.
 */
function createPm2Control(pm2, deps = {}) {
  let connected = null;
  const ensureConnectedTimeoutMs = deps.ensureConnectedTimeoutMs ?? 30_000;

  function withTimeout(promise, ms, message) {
    let timer;
    // Deliberately not unref'd: this timer is the only thing that will ever
    // settle the race if the connect attempt is genuinely wedged (NCOW-22
    // AC#3), so letting the loop exit past it is exactly the hang it exists
    // to prevent — same reasoning as main/shutdown.js's identical helper.
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
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
    return new Promise((resolve, reject) => {
      pm2.list((err, list) => (err ? reject(err) : resolve(list)));
    });
  }

  async function findApp() {
    const apps = await listApps();
    return apps.find((app) => app.name === APP_NAME) || null;
  }

  async function deleteAppIfPresent() {
    await ensureConnected();
    const existing = await findApp();
    if (!existing) return;
    await new Promise((resolve, reject) => {
      pm2.delete(APP_NAME, (err) => (err ? reject(err) : resolve()));
    });
  }

  async function save() {
    await ensureConnected();
    return new Promise((resolve, reject) => {
      pm2.dump((err) => (err ? reject(err) : resolve()));
    });
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
   * @param {{ecosystemConfigPath: string, port: number, outLog: string, errLog: string, healthTimeoutMs?: number}} opts
   */
  async function startOrRestart(opts) {
    const healthTimeoutMs = opts.healthTimeoutMs ?? 60_000;

    await ensureConnected();
    await deleteAppIfPresent();

    await new Promise((resolve, reject) => {
      pm2.start(opts.ecosystemConfigPath, (err) => (err ? reject(err) : resolve()));
    });

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

  async function stop() {
    await ensureConnected();
    return new Promise((resolve, reject) => {
      pm2.stop(APP_NAME, (err) => (err ? reject(err) : resolve()));
    });
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
   * @param {(entry: {process: string, data: string, at: 'out'|'err'}) => void} onLine
   * @returns {Promise<() => void>} unsubscribe function
   */
  async function startLogTail(onLine) {
    await ensureConnected();
    return new Promise((resolve, reject) => {
      pm2.launchBus((err, bus) => {
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
   * @param {string} platform
   */
  function getBootPersistenceGuidance(platform) {
    if (platform === 'win32') {
      return (
        'pm2 has no first-party boot service on Windows. To resume the proxy after a reboot, ' +
        'either install the community pm2-windows-startup package, or add a Windows Task ' +
        'Scheduler entry that runs "pm2 resurrect" at logon — this app will never do that setup ' +
        'or run that command for you.'
      );
    }
    return 'To survive a reboot (not just a pm2 daemon restart), run `pm2 startup` yourself and follow the sudo command it prints. This app will never run that command for you.';
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

module.exports = { createPm2Control, APP_NAME, probeDaemonAlive, spawnDaemon, resolveRpcSocketPath, resolvePm2Home };
