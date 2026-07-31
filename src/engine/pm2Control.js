'use strict';

const fs = require('node:fs');
const readline = require('node:readline');

const APP_NAME = 'litellm-nim';

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
 */
function createPm2Control(pm2) {
  let connected = null;

  function ensureConnected() {
    if (!connected) {
      connected = new Promise((resolve, reject) => {
        pm2.connect((err) => (err ? reject(err) : resolve()));
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

module.exports = { createPm2Control, APP_NAME };
