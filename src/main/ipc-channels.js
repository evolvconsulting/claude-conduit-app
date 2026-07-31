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
    },
    events: {
      navigate: 'app:navigate',
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
};

module.exports = { CHANNELS };
