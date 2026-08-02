'use strict';

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const paths = require('../engine/paths');
const prereqs = require('../engine/prereqs');
const nvidiaKey = require('../engine/nvidiaKey');
const { createSecretStore } = require('../engine/secretStore');
const modelCatalog = require('../engine/modelCatalog');
const configGen = require('../engine/configGen');
const { createPm2Control, probeDaemonAlive, spawnDaemon } = require('../engine/pm2Control');
const claudeCodeConfig = require('../engine/claudeCodeConfig');
const claudeDesktopConfig = require('../engine/claudeDesktopConfig');
const diagnostics = require('../engine/diagnostics');
const { uninstall: runUninstall } = require('../engine/uninstall');
const manifestStore = require('../engine/manifest');
const { migrateLegacyConfigDir } = require('../engine/configDirMigration');
const { migrateLegacyKeyFile, LEGACY_PRODUCT_NAME } = require('../engine/userDataMigration');

const DEFAULT_PORT = 4000;

/**
 * SAFETY MECHANISM — dev/manual-testing only, never used in a real install:
 * every path this app touches (~/.config/claude-conduit, ~/.claude, the
 * Claude Desktop configLibrary) is derived from a single `homedir`, which
 * defaults to the real os.homedir(). When launched with --dev AND
 * NIM_PROXY_TEST_HOME set, that env var's directory is used instead — so
 * every button in the app, including the ones that write to Claude Code's
 * settings.json or Claude Desktop's config, can be clicked for real during
 * development without touching this machine's actual configuration.
 *
 * NCOW-12: Electron's userData/appData directories (the encrypted-key store,
 * and the legacy-userData migration above) are NOT derived from this
 * function — they come from `deps.userDataDir`/`deps.appDataDir`, which
 * main/index.js's own resolveUserDataPaths() redirects under
 * NIM_PROXY_TEST_HOME the same way, using the identical --dev + env-var
 * guard. Both halves have to agree for a --dev test-home run to be fully
 * isolated from this machine's real Electron userData.
 */
function resolveHomedir() {
  const isDev = process.argv.includes('--dev');
  if (isDev && process.env.NIM_PROXY_TEST_HOME) return process.env.NIM_PROXY_TEST_HOME;
  return os.homedir();
}

/**
 * @param {{safeStorage: import('electron').safeStorage, userDataDir: string, appDataDir: string, broadcast: (channel: string, payload: any) => void}} deps
 */
function createEngineContext(deps) {
  const homedir = resolveHomedir();
  const configDir = paths.resolveConfigDir({ homedir });

  // NCOW-12: migrate a pre-rename config directory (~/.config/claude-nim-proxy)
  // to its new name before anything else touches configDir — see
  // configDirMigration.js for why this needs no separate consent prompt.
  // Cheap and safe to run on every startup: a no-op once already migrated.
  migrateLegacyConfigDir({ legacyConfigDir: paths.resolveLegacyConfigDir({ homedir }), newConfigDir: configDir });

  const files = paths.getFilePaths(configDir);
  const claudeCodeSettingsPath = paths.resolveClaudeCodeSettingsPath({ homedir });
  const claudeDesktopConfigLibraryDir = paths.resolveClaudeDesktopConfigLibraryDir({ homedir });

  // NCOW-12: best-effort carry-forward of the encrypted NVIDIA key across the
  // userData directory move that renaming productName causes (Electron
  // derives userData from it) — see userDataMigration.js for the honest
  // caveat about macOS Keychain scoping.
  migrateLegacyKeyFile({
    legacyUserDataDir: path.join(deps.appDataDir, LEGACY_PRODUCT_NAME),
    newUserDataDir: deps.userDataDir,
  });

  const secretStore = createSecretStore(deps.safeStorage, path.join(deps.userDataDir, 'nim-key.enc'));
  // NCOW-22: probeDaemonAlive/spawnDaemon let ensureConnected() bootstrap a
  // missing pm2 daemon itself on a genuinely fresh machine, instead of
  // relying on pm2's own connect-time auto-launch (which hangs forever on
  // Windows, and elsewhere spawns a second copy of this app's own Electron
  // binary rather than the daemon — see pm2Control.js for the full trace).
  const pm2Control = createPm2Control(require('pm2'), { probeDaemonAlive, spawnDaemon });

  let logTailUnsubscribe = null;
  // NCOW-17 AC#3: tracks the AbortController for whichever diagnostics run
  // is currently in flight, so diagnostics.cancel (below) has something to
  // abort. null when no run is in progress — cancel() is then a harmless
  // no-op rather than an error, since the renderer can't always know for
  // certain a run is still active when the user clicks Cancel.
  let diagnosticsAbortController = null;

  function getManifest() {
    return manifestStore.readManifest(files.manifestJson);
  }
  function saveManifest(patch) {
    return manifestStore.writeManifest(files.manifestJson, patch);
  }
  function getMasterKey() {
    return configGen.resolveMasterKey(files.litellmEnv);
  }
  function port() {
    return getManifest()?.port ?? DEFAULT_PORT;
  }

  const handlers = {
    app: {
      openLogsFolder: async () => {
        const { shell } = require('electron');
        fs.mkdirSync(files.logsDir, { recursive: true });
        await shell.openPath(files.logsDir);
        return { ok: true };
      },
    },

    prereqs: {
      check: async () => {
        const results = await prereqs.runAllPrereqChecks({ port: port() });
        return { ok: true, data: { results } };
      },
      installLitellm: async () => {
        const result = await prereqs.installLitellm({
          onOutput: (chunk) => deps.broadcast('prereqs:install-progress', chunk),
        });
        return result.ok ? { ok: true, data: result } : { ok: false, error: result.error };
      },
    },

    apiKey: {
      validateAndSave: async (key) => {
        const result = await nvidiaKey.validateApiKey({ apiKey: key });
        if (!result.ok) return result;
        secretStore.save(key);
        return { ok: true, data: { maskedKey: result.data.maskedKey, models: result.data.models } };
      },
      getMasked: async () => {
        const key = secretStore.load();
        return { ok: true, data: { maskedKey: key ? nvidiaKey.maskKey(key) : null } };
      },
      clear: async () => {
        secretStore.clear();
        return { ok: true };
      },
    },

    catalog: {
      fetch: async () => {
        const apiKey = secretStore.load();
        if (!apiKey) return { ok: false, error: { code: 'NO_KEY', message: 'Set an NVIDIA API key first.' } };
        const nimBaseUrl = getManifest()?.nim_base_url ?? undefined;
        const result = await modelCatalog.fetchCatalog({ apiKey, nimBaseUrl });
        if (!result.ok) return result;
        return {
          ok: true,
          data: {
            models: result.data.models,
            recommendedPrimary: modelCatalog.intersectWithLive(modelCatalog.RECOMMENDED_PRIMARY, result.data.models),
            recommendedSmall: modelCatalog.intersectWithLive(modelCatalog.RECOMMENDED_SMALL, result.data.models),
          },
        };
      },
    },

    config: {
      generate: async ({ primaryModel, smallModel, port: requestedPort, nimBaseUrl }) => {
        const apiKey = secretStore.load();
        if (!apiKey) return { ok: false, error: { code: 'NO_KEY', message: 'Set an NVIDIA API key first.' } };
        const litellmCheck = prereqs.checkLitellmOnPath();
        if (!litellmCheck.ok) return { ok: false, error: { code: 'LITELLM_MISSING', message: 'litellm is not installed.' } };

        const usedPort = requestedPort ?? DEFAULT_PORT;
        const { masterKey } = configGen.generateAll({
          files,
          primaryModelId: primaryModel,
          smallModelId: smallModel,
          nimBaseUrl,
          port: usedPort,
          litellmAbsPath: litellmCheck.path,
          nvidiaApiKey: apiKey,
        });

        const existing = getManifest();
        const manifest = saveManifest({
          port: usedPort,
          primary_model: primaryModel,
          small_model: smallModel,
          nim_base_url: nimBaseUrl ?? null,
          litellm_path: litellmCheck.path,
          pm2_app: pm2Control.APP_NAME,
          cli_configured: existing?.cli_configured ?? false,
          secret_store_backend: 'electron-safeStorage',
        });
        return { ok: true, data: { manifest, masterKey } };
      },
      getManifest: async () => ({ ok: true, data: getManifest() }),
    },

    proxy: {
      start: async () => {
        const manifest = getManifest();
        if (!manifest) return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Run setup first.' } };
        const result = await pm2Control.startOrRestart({
          ecosystemConfigPath: files.ecosystemConfig,
          port: manifest.port,
          outLog: files.outLog,
          errLog: files.errLog,
        });
        deps.broadcast('proxy:status-changed', await pm2Control.getStatus());
        return result.ok ? { ok: true } : { ok: false, error: result.error, data: { outTail: result.outTail, errTail: result.errTail } };
      },
      stop: async () => {
        await pm2Control.stop();
        deps.broadcast('proxy:status-changed', await pm2Control.getStatus());
        return { ok: true };
      },
      restart: async () => handlers.proxy.start(),
      getStatus: async () => ({ ok: true, data: await pm2Control.getStatus() }),
      testConnection: async () => {
        const manifest = getManifest();
        const apiKey = secretStore.load();
        if (!manifest || !apiKey) return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Run setup first.' } };
        const result = await diagnostics.runQuickValidation({
          apiKey,
          nimBaseUrl: manifest.nim_base_url ?? undefined,
          port: manifest.port,
          masterKey: getMasterKey(),
          primaryModelId: manifest.primary_model,
          smallModelId: manifest.small_model,
        });
        return { ok: true, data: result };
      },
      startLogTail: async () => {
        if (logTailUnsubscribe) return { ok: true };
        logTailUnsubscribe = await pm2Control.startLogTail((entry) => deps.broadcast('proxy:log-line', entry));
        return { ok: true };
      },
      stopLogTail: async () => {
        logTailUnsubscribe?.();
        logTailUnsubscribe = null;
        return { ok: true };
      },
      // pm2's log bus only streams output produced after it attaches, so a
      // healthy but idle proxy would leave the log viewer permanently blank
      // even with a full startup log already on disk. Seed from the files.
      getRecentLogs: async ({ lineCount = 200 } = {}) => {
        const [out, err] = await Promise.all([
          pm2Control.tailLastLines(files.outLog, lineCount),
          pm2Control.tailLastLines(files.errLog, lineCount),
        ]);
        return { ok: true, data: { out, err } };
      },
    },

    claudeDesktop: {
      applyGatewayConfig: async ({ consent } = {}) => {
        const manifest = getManifest();
        if (!manifest) return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Run setup first.' } };
        try {
          const result = claudeDesktopConfig.applyGatewayConfig({
            configLibraryDir: claudeDesktopConfigLibraryDir,
            port: manifest.port,
            masterKey: getMasterKey(),
            manifest,
            consent: consent === true,
          });
          saveManifest({
            desktop_config_entry_id: result.entryId,
            desktop_config_backup: result.backupPath,
          });
          return { ok: true, data: result };
        } catch (err) {
          return { ok: false, error: { code: err.code || 'UNEXPECTED', message: err.message } };
        }
      },
      revertToDefault: async () => {
        try {
          const result = claudeDesktopConfig.revertToDefault({ configLibraryDir: claudeDesktopConfigLibraryDir });
          return { ok: true, data: result };
        } catch (err) {
          return { ok: false, error: { code: err.code || 'UNEXPECTED', message: err.message } };
        }
      },
      getDetectedStatus: async () => {
        const manifest = getManifest();
        const status = await claudeDesktopConfig.detectStatus({
          configLibraryDir: claudeDesktopConfigLibraryDir,
          port: manifest?.port ?? DEFAULT_PORT,
          masterKey: getMasterKey(),
          entryId: manifest?.desktop_config_entry_id,
        });
        return { ok: true, data: status };
      },
      getManualInstructions: async () => {
        const manifest = getManifest();
        if (!manifest) return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Run setup first.' } };
        return { ok: true, data: { markdown: claudeDesktopConfig.desktopSetupMarkdown({ port: manifest.port, masterKey: getMasterKey() }) } };
      },
    },

    claudeCode: {
      configure: async () => {
        const manifest = getManifest();
        if (!manifest) return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Run setup first.' } };
        try {
          const result = claudeCodeConfig.mergeClaudeCodeSettings(claudeCodeSettingsPath, {
            port: manifest.port,
            masterKey: getMasterKey(),
          });
          saveManifest({
            cli_configured: true,
            settings_file: result.settingsPath,
            settings_backup: result.backupPath,
            env_keys_set: result.keysSet,
          });
          return { ok: true, data: result };
        } catch (err) {
          return { ok: false, error: { code: err.code || 'UNEXPECTED', message: err.message } };
        }
      },
      remove: async () => {
        const manifest = getManifest();
        const result = claudeCodeConfig.removeClaudeCodeSettings(claudeCodeSettingsPath, manifest?.env_keys_set ?? claudeCodeConfig.ENV_KEYS);
        saveManifest({ cli_configured: false });
        return { ok: true, data: result };
      },
      getStatus: async () => {
        const manifest = getManifest();
        return {
          ok: true,
          data: {
            configured: manifest?.cli_configured ?? false,
            settingsPath: claudeCodeSettingsPath,
            backupPath: manifest?.settings_backup ?? null,
            envKeys: claudeCodeConfig.ENV_KEYS,
          },
        };
      },
    },

    diagnostics: {
      run: async () => {
        const manifest = getManifest();
        const apiKey = secretStore.load();
        if (!manifest || !apiKey) return { ok: false, error: { code: 'NOT_CONFIGURED', message: 'Run setup first.' } };
        // NCOW-17 AC#3: a fresh AbortController per run — diagnostics:run
        // isn't mutex-guarded (see ipc.js: only proxy/config/claudeDesktop/
        // claudeCode have a domain mutex), so overlapping runs aren't
        // actually prevented at this layer; the renderer's own button
        // disable-while-running is what stops that in practice. Clearing
        // the controller in `finally` (rather than leaving a stale one
        // around) means a cancel() call after the run has already finished
        // is a no-op instead of accidentally aborting a *later* run.
        diagnosticsAbortController = new AbortController();
        try {
          const result = await diagnostics.runDiagnostics({
            port: manifest.port,
            masterKey: getMasterKey(),
            apiKey,
            nimBaseUrl: manifest.nim_base_url ?? undefined,
            primaryModelId: manifest.primary_model,
            smallModelId: manifest.small_model,
            manifest,
            settingsPath: claudeCodeSettingsPath,
            signal: diagnosticsAbortController.signal,
          });
          return { ok: true, data: result };
        } finally {
          diagnosticsAbortController = null;
        }
      },
      cancel: async () => {
        diagnosticsAbortController?.abort();
        return { ok: true };
      },
    },

    uninstall: {
      run: async ({ purge } = {}) => {
        const manifest = getManifest();
        const result = await runUninstall({ configDir, manifest, pm2Control, purge: purge === true });
        return { ok: true, data: result };
      },
    },
  };

  return { handlers, pm2Control, files, configDir, homedir };
}

module.exports = { createEngineContext, DEFAULT_PORT };
