'use strict';

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const paths = require('../engine/paths');
const prereqs = require('../engine/prereqs');
const { createSecretStore } = require('../engine/secretStore');
const providers = require('../engine/providers/registry');
const configGen = require('../engine/configGen');
const { createPm2Control, probeDaemonAlive, spawnDaemon } = require('../engine/pm2Control');
const claudeCodeConfig = require('../engine/claudeCodeConfig');
const claudeDesktopConfig = require('../engine/claudeDesktopConfig');
const diagnostics = require('../engine/diagnostics');
const { uninstall: runUninstall } = require('../engine/uninstall');
const manifestStore = require('../engine/manifest');
const { migrateLegacyConfigDir } = require('../engine/configDirMigration');
const { migrateLegacyKeyFile, LEGACY_PRODUCT_NAME } = require('../engine/userDataMigration');
// NCOW-31: deliberately NOT require('./ipc') — that pulls ipcMain/app/shell off
// `electron` at module scope and this file is required directly by plain
// `node --test` suites. mutex.js requires nothing at all, which is what lets
// both files share one set of locks. See mutex.js's header.
const { createDomainMutexes } = require('./mutex');

const DEFAULT_PORT = 4000;

// CCA-14.1: three providers are registered (registry.js — nvidia-nim,
// openrouter, and custom-local as of CCA-14.3), but nothing yet lets a user
// choose between them, so the active provider is a constant. CCA-15 (multiple
// saved connections) replaces this with a lookup keyed on whichever
// connection is active.
const activeProvider = providers.getProvider('nvidia-nim');

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
 * NCOW-23: paths.resolveConfigDir/resolveLegacyConfigDir/
 * resolveClaudeDesktopConfigLibraryDir all fall back to
 * process.env.APPDATA/LOCALAPPDATA on win32 *before* ever consulting an
 * injected homedir — and APPDATA is always set on a real Windows machine, so
 * passing homedir alone (as this file used to) left NIM_PROXY_TEST_HOME
 * silently ignored on Windows: the app kept resolving to the real
 * %APPDATA%\claude-conduit regardless of the fake home. Only substitutes an
 * override when resolveHomedir() actually substituted the fake home, so an
 * ordinary (non-test) Windows run still gets the real
 * %APPDATA%/%LOCALAPPDATA% — which can legitimately differ from
 * homedir/AppData/... under folder redirection or a roaming profile.
 */
function resolveWindowsTestOverrides() {
  const isDev = process.argv.includes('--dev');
  if (isDev && process.env.NIM_PROXY_TEST_HOME) {
    return paths.resolveWindowsAppDataOverrides(process.env.NIM_PROXY_TEST_HOME);
  }
  return {};
}

/**
 * @param {{safeStorage: import('electron').safeStorage, userDataDir: string, appDataDir: string, broadcast: (channel: string, payload: any) => void, appVersion?: string, pm2Control?: ReturnType<typeof createPm2Control>}} deps
 *   appVersion is the currently-running app's version (main/index.js passes
 *   app.getVersion()) — used only to detect a stale generated config (NCOW-30);
 *   omitting it disables that check entirely, which is what every pre-existing
 *   test that doesn't care about it relies on. pm2Control is an injectable
 *   override purely for tests (see test/main/engine-context-config-regen.test.js)
 *   so they can observe the NCOW-30 restart-on-regen wiring without a real pm2
 *   daemon — every real caller (main/index.js) leaves it unset and gets the
 *   genuine pm2-backed control created below.
 *
 *   NCOW-31: `mutexes` and `logger` are likewise test-only overrides. Real
 *   callers leave both unset, getting a fresh createDomainMutexes() (returned
 *   on the context for main/index.js to hand to registerIpcHandlers) and
 *   `console`. A test that injects `mutexes` can pre-load the proxy lock to
 *   observe contention; one that injects `logger` can assert on the
 *   success-vs-failure logging of a background restart without capturing
 *   process stdout.
 */
function createEngineContext(deps) {
  const homedir = resolveHomedir();
  const winTestOverrides = resolveWindowsTestOverrides();
  const configDir = paths.resolveConfigDir({ homedir, ...winTestOverrides });

  // NCOW-12: migrate a pre-rename config directory (~/.config/claude-nim-proxy)
  // to its new name before anything else touches configDir — see
  // configDirMigration.js for why this needs no separate consent prompt.
  // Cheap and safe to run on every startup: a no-op once already migrated.
  migrateLegacyConfigDir({
    legacyConfigDir: paths.resolveLegacyConfigDir({ homedir, ...winTestOverrides }),
    newConfigDir: configDir,
  });

  const files = paths.getFilePaths(configDir);
  const claudeCodeSettingsPath = paths.resolveClaudeCodeSettingsPath({ homedir });
  const claudeDesktopConfigLibraryDir = paths.resolveClaudeDesktopConfigLibraryDir({ homedir, ...winTestOverrides });

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
  const pm2Control = deps.pm2Control ?? createPm2Control(require('pm2'), { probeDaemonAlive, spawnDaemon });

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

  // NCOW-30: regenerate ecosystem.config.cjs/run.js/manifest.json whenever
  // they were last produced by a different app version than the one
  // currently running (or never stamped at all — every real pre-NCOW-30
  // install), so a fix living only in configGen.js's generated output (e.g.
  // NCOW-27, NCOW-28) actually reaches an install that completed setup
  // before that fix shipped, without the user re-running setup. Runs on
  // every launch; configGen.needsRegeneration() makes this a cheap read-only
  // no-op once the manifest is already current. Fire-and-forget: this must
  // never block or fail app startup, and any failure surfaces the same way
  // an ordinary failed restart would — via the next status poll or manual
  // Start click.
  //
  // Fix-pass regression: this manifest read happens synchronously, in the
  // argument list, outside the .catch() below — readManifest() does a bare
  // JSON.parse, so a truncated/corrupt manifest.json (exactly what a
  // non-atomic writeManifest() can leave behind after a crash, power loss,
  // or full disk — and every version upgrade is now a fresh writeManifest()
  // call, per this same task) threw straight out of createEngineContext(),
  // which app.whenReady().then(...) in index.js has no .catch() for. That
  // left a windowless zombie process with no route to Setup/Uninstall.
  // Treated the same as a missing manifest — needsRegeneration() already
  // treats "no manifest" as nothing to regenerate, the conservative choice,
  // since it just retries the read on the next launch instead of acting on
  // partial content.
  let manifestForRegenCheck;
  try {
    manifestForRegenCheck = getManifest();
  } catch (err) {
    manifestForRegenCheck = null;
  }

  // NCOW-31 AC#1: the single set of per-domain locks for this whole app
  // instance. Created here, handed back on the returned context, and passed
  // straight into registerIpcHandlers() by main/index.js — so the background
  // restart below and a user-clicked Start/Stop/Restart contend for the *same*
  // proxy lock. Two separately-constructed sets would look identical and
  // serialize nothing across the two paths. NCOW-32 later aliased the
  // `uninstall` and `update` IPC domains onto this same proxy lock too (see
  // DOMAIN_MUTEX_ALIASES in ipc.js), so an Uninstall click and an update
  // install now contend for it as well. As of NCOW-45, Uninstall's alias
  // was widened further: it now also contends for the `config` and
  // `claudeCode` locks, not just `proxy` — see DOMAIN_MUTEX_ALIASES's
  // `uninstall: ['claudeCode', 'config', 'proxy']`.
  //
  // Deliberately NOT covered: main/shutdown.js's before-quit proxy stop. It
  // reaches pm2Control directly and stays that way on purpose — CLAUDE.md's
  // standing constraint is that a wedged pm2 must never make the app
  // unquittable, and queueing the shutdown stop behind a lock a background
  // restart can hold for 60s+ is precisely how it would become
  // unquittable. That stop is bounded by its own timeout instead. So "quit
  // during a background restart" remains unserialized, by choice; a Stop or
  // Restart clicked from the window or tray, which is the recoverable-but-
  // confusing case NCOW-31 was filed for, is now serialized.
  //
  // The worst case this leaves is worse than "a Stop that doesn't stick"
  // (NCOW-31's own description of the pre-fix risk, written before this
  // exclusion existed): pm2Control.startOrRestart() (pm2Control.js) calls
  // deleteAppIfPresent() before pm2.start(). shutdown.js's stop() calls
  // getStatus() FIRST and only calls pm2Control.stop() when it reports
  // 'running' — so if shutdown's stop() lands in the gap after
  // deleteAppIfPresent() has removed the app but before pm2.start() has
  // re-added it, getStatus() reports 'not-installed' and stop() is skipped
  // entirely by its own precondition, not by an error being thrown and
  // swallowed: nothing errors, nothing gets caught. (A stop landing just
  // BEFORE deleteAppIfPresent() runs succeeds normally instead, since the app
  // is still 'running' at that point — but is then undone by the very next
  // pm2.start() in that same startOrRestart() call.) Either way,
  // startOrRestart()'s pm2.start() runs anyway, right after the app decided
  // to quit. The proxy can outlive the quit, which is the exact outcome
  // NCOW-4 ("closing hides, quitting stops the proxy") means to prevent.
  // This window is not millisecond-wide: it spans a full getStatus()+delete
  // round trip against the pm2 daemon, and autoUpdate.js's own comments note
  // that proxy.getStatus() can take 1s+ to connect to a cold pm2 daemon — so
  // it can run well over a second. Pre-existing on dev, and out of scope for
  // this task to close — see NCOW-31's review notes for the follow-up.
  const mutexes = deps.mutexes ?? createDomainMutexes();

  // CCA-14.5: resolve the regen path's provider-specific env var/litellm
  // prefix from the MANIFEST's own recorded `provider` field (this task's
  // AC#1), not from the `activeProvider` constant above. The two happen to
  // agree today (activeProvider is hard-pinned to 'nvidia-nim' until CCA-15),
  // but the manifest is the actual source of truth for which provider a
  // given install was configured with — reading activeProvider here instead
  // would silently stop being correct the moment CCA-15 makes that pin
  // per-connection, since a regen on an OLDER install could then pick up a
  // NEWER, unrelated active provider's env var name. Reading the manifest
  // back is also what makes AC#1's stamped field non-cosmetic rather than
  // write-only.
  //
  // A manifest with no `provider` at all (every real pre-CCA-14.5 install)
  // resolves to 'nvidia-nim' via manifestStore.resolveManifestProviderId,
  // since that was the only provider that could ever have been configured
  // before this field existed. An unrecognized id (e.g. a manifest written
  // by a newer app version, then downgraded) falls back to activeProvider's
  // values rather than throwing out of createEngineContext() —
  // regenerateStaleConfig's own no-existing-secrets/no-litellm-path guards
  // make an actually-wrong guess here safe: it just fails to find a matching
  // key under the wrong env var name and skips regeneration, same as any
  // other not-yet-regenerable state, instead of crashing app startup.
  let regenProvider;
  try {
    regenProvider = providers.getProvider(manifestStore.resolveManifestProviderId(manifestForRegenCheck));
  } catch {
    regenProvider = activeProvider;
  }

  const configRegeneration = configGen
    .regenerateStaleConfig({
      files,
      manifest: manifestForRegenCheck,
      currentVersion: deps.appVersion,
      saveManifest,
      getStatus: pm2Control.getStatus,
      startOrRestart: pm2Control.startOrRestart,
      runProxyOperation: (fn) => mutexes.proxy.run(fn),
      logger: deps.logger ?? console,
      provider: { id: regenProvider.id, apiKeyEnvVar: regenProvider.apiKeyEnvVar, litellmProvider: regenProvider.litellmProvider },
    })
    .catch((err) => ({ regenerated: false, reason: 'error', error: err }));

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
      // NCOW-50: nvidiaKey.validateApiKey() below is up to two sequential
      // 10s AbortController windows against NVIDIA's real network (see
      // nvidiaKey.js's fetchModels/probeCompletion) — and it must complete
      // BEFORE anything here touches the config lock. Before this fix,
      // ipc.js's automatic per-method wrapping held mutexes.config for this
      // entire method, network wait included: composed with NCOW-45's
      // uninstall alias (which reserves claudeCode+config+proxy
      // synchronously and holds all three until it settles), a slow or
      // offline NVIDIA endpoint turned one Validate-Key click into a ~20s
      // hold on ALL THREE of those locks the moment a user issued an
      // Uninstall afterward — freezing the window, the tray's Start/Stop/
      // Restart, proxy:testConnection, and every claudeCode:* method, with
      // no feedback. See this task's own description for the full
      // reproduction and measured timings.
      //
      // The fix: this method is now listed in ipc.js's UNSERIALIZED_METHODS
      // (apiKey.validateAndSave), so ipc.js no longer wraps it at all. The
      // lock is acquired HERE instead, directly against the exact same
      // `mutexes` object this file hands to registerIpcHandlers — mirroring
      // configGen.regenerateStaleConfig's injected runProxyOperation above,
      // the established precedent for an engine-side critical section — and
      // scoped to only the secretStore.save() call below: a synchronous,
      // local write with nothing network-bound in it. That preserves
      // NCOW-47's guarantee in full (this write still cannot interleave
      // with config.generate's secretStore.load(), which runs inside the
      // very same mutexes.config) while collapsing the hold from up to ~20s
      // to milliseconds — secretStore.save() calls safeStorage.encryptString
      // (a platform keychain/DPAPI/libsecret round trip) plus a synchronous
      // fs write, so it is not instant, but it is nowhere near the network
      // wait it replaces. `clear` needs no equivalent change — it has no
      // network component, so ipc.js's whole-handler lock (via
      // DOMAIN_MUTEX_ALIASES's apiKey->config alias) already scopes
      // correctly for it.
      validateAndSave: async (key) => {
        const result = await activeProvider.validateCredential({ apiKey: key });
        if (!result.ok) return result;
        // NCOW-29: secretStore.save() can fail (e.g. ok:false/
        // ENCRYPTION_UNAVAILABLE when the platform has no OS-native
        // encryption backend — observed on a headless Linux box with no
        // keyring). That failure must be surfaced to the caller instead of
        // discarded, or the renderer reports success while the key was
        // never actually persisted.
        //
        // NCOW-49: this self-acquisition only works because `validateAndSave`
        // is listed in ipc.js's UNSERIALIZED_METHODS, so no lock is already
        // held when this line runs. createDomainMutex() (mutex.js) is
        // non-reentrant: if IPC-level locking were ever re-added on top of
        // this call (e.g. removing `validateAndSave` from that array without
        // also removing this line), the outer acquisition's chain could only
        // resolve after this inner one does — and this inner one can't even
        // start until the outer one resolves, since they share the same
        // `mutexes.config` chain. That is a self-deadlock, not a slow path:
        // `mutexes.config` becomes permanently unacquirable, wedging every
        // other caller of it (including uninstall's claudeCode+config+proxy
        // via DOMAIN_MUTEX_ALIASES) forever, not just for ~20s. ipc.js's
        // SELF_ACQUIRING_HANDLERS registry and its module-load
        // assertUnserializedMethodsCoverSelfAcquirers() call now guard
        // against exactly this regression: removing `validateAndSave` from
        // UNSERIALIZED_METHODS without also removing it (and this
        // self-acquisition) from that registry fails loudly at require()
        // time instead of silently reintroducing the deadlock.
        const saveResult = await mutexes.config.run(() => secretStore.save(key));
        if (!saveResult.ok) {
          // Reworded (rather than passed through verbatim) so the setup
          // wizard's error span — which renders whatever message lands here
          // (see renderer/views/setup-view.js's validateApiKey()) — can't
          // read as "the key you typed is invalid": validation already
          // succeeded; only persisting it to the OS-native secret store
          // failed.
          return {
            ok: false,
            error: {
              code: saveResult.error.code,
              message: `Key validated, but could not be saved: ${saveResult.error.message}`,
            },
          };
        }
        return { ok: true, data: { maskedKey: result.data.maskedKey, models: result.data.models } };
      },
      getMasked: async () => {
        const key = secretStore.load();
        return { ok: true, data: { maskedKey: key ? activeProvider.maskCredential(key) : null } };
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
        const baseUrl = getManifest()?.nim_base_url ?? undefined;
        const result = await activeProvider.listModels({ apiKey, baseUrl });
        if (!result.ok) return result;
        const recommended = activeProvider.recommendedModels(result.data.models);
        return {
          ok: true,
          data: {
            models: result.data.models,
            recommendedPrimary: recommended.primary,
            recommendedSmall: recommended.small,
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
          litellmProvider: activeProvider.litellmProvider,
          apiKeyEnvVar: activeProvider.apiKeyEnvVar,
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
          // CCA-14.5 AC#1: records which registry.js Provider this
          // connection uses, read back by regenerateStaleConfig() above (via
          // manifestStore.resolveManifestProviderId) on every later launch.
          provider: activeProvider.id,
          // NCOW-30: stamps the app version that produced this generation of
          // ecosystem.config.cjs/run.js, so a later launch under a newer app
          // version can detect this content is stale and regenerate it — see
          // configGen.needsRegeneration()/regenerateStaleConfig() above.
          generated_by_version: deps.appVersion,
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
          listModels: activeProvider.listModels,
          // CCA-14.4: lets diagnostics report per-provider capabilities
          // (e.g. "no catalog listing") plainly instead of a hardcoded NIM
          // assumption — see diagnostics.js's checkModelCatalog/checkToolCalling.
          capabilities: activeProvider.declareCapabilities(),
          providerLabel: activeProvider.label,
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
        // isn't mutex-guarded (see ipc.js: proxy/config/claudeDesktop/
        // claudeCode each have their own domain mutex, and NCOW-32 aliases
        // update onto proxy's (as of NCOW-45, uninstall aliases onto
        // claudeCode+config+proxy instead of proxy alone; as of NCOW-47,
        // apiKey's `clear` aliases onto config's, and `validateAndSave`
        // acquires it directly (NCOW-50)), but
        // diagnostics has no lock and no alias at all), so overlapping runs
        // aren't actually prevented at this layer; the renderer's own button
        // disable-while-running is what stops that in practice. Clearing
        // the controller in `finally` (rather than leaving a stale one
        // around) means a cancel() call after the run has already finished
        // is a no-op instead of accidentally aborting a *later* run.
        //
        // NCOW-47 re-checked this deliberately: the secretStore.load() two
        // lines up reads the exact same encrypted key that apiKey.clear and
        // config.generate now serialize against each other via the config
        // lock. diagnostics.run stays unlocked anyway — it only reads the
        // key into a local, doesn't persist or delete anything, and the
        // worst case of it racing a clear/validateAndSave is a diagnostics
        // pass that either NOT_CONFIGURED's on a since-cleared key or runs
        // against a key that's about to be replaced, both already possible
        // today (getManifest()/secretStore.load() above are two unguarded
        // reads back-to-back) and both cosmetic — no corrupted state, no
        // partial write, nothing for a future reader to "fix" here.
        //
        // diagnostics.run is not the only other reader of this key, so don't
        // read this comment as a complete census: catalog.fetch (this file's
        // catalog.fetch, zero locks) and proxy.testConnection (this file's
        // proxy.testConnection, locked under `proxy` — a different chain
        // than `config`, so still not serialized against apiKey's writes)
        // call the identical secretStore.load(). Same reasoning applies to
        // both: a read into a local, no persistence, worst case a stale key.
        // See ipc.js's DOMAIN_MUTEX_ALIASES comment for the cross-reference
        // from the other direction.
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
            listModels: activeProvider.listModels,
            // CCA-14.4: see the matching comment on testConnection above.
            capabilities: activeProvider.declareCapabilities(),
            providerLabel: activeProvider.label,
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

  return { handlers, pm2Control, files, configDir, homedir, configRegeneration, mutexes };
}

module.exports = { createEngineContext, DEFAULT_PORT };
