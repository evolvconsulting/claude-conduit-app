'use strict';

/**
 * Single source of truth for the IPC surface between the sandboxed renderer
 * and the privileged main process. preload/index.js builds window.nimProxy
 * from this list; main/ipc.js registers an ipcMain.handle for each `invoke`
 * entry and main code emits each `events` entry via webContents.send.
 *
 * Every invoke handler resolves to { ok, data?, error? } — never a thrown
 * rejection for expected failure modes — so renderer call sites don't need
 * try/catch sprawl. Actual promise rejection is reserved for programmer
 * errors (bad IPC args), not domain failures (bad key, port busy, etc).
 */

const CHANNELS = {
  app: {
    invoke: {
      getVersion: 'app:get-version',
      getPlatform: 'app:get-platform',
      openExternal: 'app:open-external',
      openLogsFolder: 'app:open-logs-folder',
      getLicenses: 'app:get-licenses',
      quit: 'app:quit',
    },
    events: {
      navigate: 'app:navigate',
      showAbout: 'app:show-about',
      showLicenses: 'app:show-licenses',
    },
  },
  prereqs: {
    invoke: {
      check: 'prereqs:check',
      installLitellm: 'prereqs:install-litellm',
    },
    events: {
      installProgress: 'prereqs:install-progress',
    },
  },
  apiKey: {
    invoke: {
      validateAndSave: 'apikey:validate-and-save',
      getMasked: 'apikey:get-masked',
      clear: 'apikey:clear',
    },
  },
  catalog: {
    invoke: {
      fetch: 'catalog:fetch',
    },
  },
  config: {
    invoke: {
      generate: 'config:generate',
      getManifest: 'config:get-manifest',
    },
  },
  proxy: {
    invoke: {
      start: 'proxy:start',
      stop: 'proxy:stop',
      restart: 'proxy:restart',
      getStatus: 'proxy:get-status',
      testConnection: 'proxy:test-connection',
      startLogTail: 'proxy:start-log-tail',
      stopLogTail: 'proxy:stop-log-tail',
      getRecentLogs: 'proxy:get-recent-logs',
    },
    events: {
      statusChanged: 'proxy:status-changed',
      logLine: 'proxy:log-line',
    },
  },
  claudeDesktop: {
    invoke: {
      applyGatewayConfig: 'claude-desktop:apply-gateway-config',
      revertToDefault: 'claude-desktop:revert-to-default',
      getDetectedStatus: 'claude-desktop:get-detected-status',
      getManualInstructions: 'claude-desktop:get-manual-instructions',
    },
  },
  claudeCode: {
    invoke: {
      configure: 'claude-code:configure',
      remove: 'claude-code:remove',
      getStatus: 'claude-code:get-status',
    },
  },
  diagnostics: {
    invoke: {
      run: 'diagnostics:run',
      // NCOW-17 AC#3: diagnostics:run's worst-case wall time is ~7 minutes
      // (5x60s model-completion checks + check 10's 120s live CLI smoke).
      // cancel() aborts the AbortSignal threaded through the in-progress
      // run (see engine-context.js) so the renderer has a way to actually
      // stop a run rather than only being able to wait it out.
      cancel: 'diagnostics:cancel',
    },
    events: {
      progress: 'diagnostics:progress',
    },
  },
  uninstall: {
    invoke: {
      run: 'uninstall:run',
    },
  },
  update: {
    invoke: {
      // Manual re-check (e.g. a future "Check for Updates" menu/button); the
      // same check also runs once automatically shortly after launch — see
      // main/index.js and docs/auto-update.md.
      check: 'update:check',
      // Windows/Linux only, and only meaningful after a 'downloaded' status —
      // see src/main/autoUpdate.js. Always resolves { ok: false, ... } if
      // called with nothing downloaded rather than doing anything surprising.
      install: 'update:install',
    },
    events: {
      statusChanged: 'update:status-changed',
    },
  },
};

module.exports = { CHANNELS };
