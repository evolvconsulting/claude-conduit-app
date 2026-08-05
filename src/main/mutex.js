'use strict';

/**
 * The per-domain serialization primitive for every operation that mutates
 * shared state this app owns (the pm2-supervised proxy, the generated config
 * directory, Claude Desktop's/Claude Code's settings, and — since NCOW-47 —
 * the encrypted NVIDIA key at `<userData>/nim-key.enc`, which the `config`
 * lock also guards even though it lives outside the config directory).
 *
 * NCOW-31: this used to live inside ipc.js as a private module-scope
 * `createDomainMutex()` + `mutexes` pair, which made it reachable from
 * exactly one place — the IPC handler registration. NCOW-30 then added a
 * launch-time stale-config regeneration that restarts a running proxy from
 * *outside* the IPC layer (engine-context.js), i.e. the first proxy-affecting
 * operation in the app with no way to take that lock. engine-context.js
 * cannot `require('./ipc')` to get at it either: ipc.js pulls ipcMain/app/
 * shell off `electron` at module scope, while engine-context.js is required
 * directly by plain `node --test` suites with no Electron runtime at all.
 *
 * So the primitive lives here instead: a module that imports NOTHING (no
 * electron, no engine module, no node builtin), so both ipc.js and
 * engine-context.js can construct/share one set of locks and every test can
 * require it directly. **Keep it that way** — the moment this file requires
 * `electron`, engine-context.js stops loading under `node --test` and roughly
 * a third of this repo's suites break.
 *
 * It lives in src/main/ rather than src/engine/ deliberately: it is a
 * main-process composition concern (which IPC domains serialize against what)
 * and nothing in src/engine/ has any business knowing about it. Engine
 * modules that need serializing receive an injected runner instead — see
 * configGen.regenerateStaleConfig()'s `runProxyOperation`.
 */

/**
 * A single FIFO lock: every function passed through it runs strictly after
 * the previously-locked one has settled.
 *
 * @returns {((fn: Function) => Function) & {run: (fn: Function) => Promise<any>}}
 *   A decorator — `withLock(fn)` returns a serialized version of `fn` — with a
 *   `.run(fn)` convenience that decorates and immediately invokes, for a
 *   one-off critical section that isn't a reusable handler.
 */
function createDomainMutex() {
  let chain = Promise.resolve();

  function withLock(fn) {
    return (...args) => {
      const run = chain.then(() => fn(...args));
      // Swallow so one failed (or throwing) call doesn't wedge the chain for
      // later calls. This is what guarantees a thrown error inside a critical
      // section can never deadlock every future operation on this domain —
      // there is no explicit release to leak.
      chain = run.catch(() => {});
      return run;
    };
  }

  withLock.run = (fn) => withLock(fn)();

  return withLock;
}

/**
 * The domains with a mutating concern of their own — each gets a dedicated
 * lock here. This list is NOT the complete answer to "which domains have a
 * mutating concern" — it only covers the ones that need their OWN lock.
 * Several other domains genuinely mutate shared state but are deliberately
 * absent from this array for domain-specific reasons documented elsewhere,
 * so don't read "not listed here" as "has no mutating concern":
 *
 *   - apiKey, uninstall, update: each has a real mutating concern but shares
 *     (aliases onto) locks from this array instead of getting its own,
 *     because its mutation touches state one or more of these domains
 *     already guards. apiKey and update each alias onto a single lock;
 *     uninstall aliases onto all three, because it mutates claudeCode,
 *     config, AND proxy state in one call. See DOMAIN_MUTEX_ALIASES in
 *     ipc.js for exactly which lock(s) each aliases onto and why (NCOW-32/45
 *     for uninstall/update, NCOW-47 for apiKey). For apiKey specifically,
 *     NCOW-50's correction: `clear` still resolves its lock through that
 *     alias table for its whole (fast, no-network) body, but
 *     `validateAndSave` does not — it opts out of ipc.js's automatic
 *     per-method locking entirely (see ipc.js's UNSERIALIZED_METHODS) and
 *     instead acquires this exact `config` mutex itself, directly, inside
 *     engine-context.js, scoped to only its secretStore.save() call rather
 *     than the up-to-two sequential 10s network round trips ahead of it.
 *     Same underlying lock, same guarantee, deliberately narrower scope —
 *     not an exemption from serialization, a fix for where it was being
 *     applied.
 *   - diagnostics, prereqs: checked and confirmed to need NO lock at all —
 *     not even an alias. diagnostics.run reads the same secretStore state
 *     apiKey/config now serialize, but is deliberately left unserialized
 *     (see the comment on diagnostics.run in engine-context.js). prereqs.
 *     installLitellm shells out to uv/pipx/pip entirely outside the config
 *     directory, so it cannot collide with the config lock or a purge-
 *     uninstall (see prereqs.js's installLitellm) — its only coupling to
 *     `config` is indirect: it changes whether litellm is on PATH, and
 *     config.generate calls prereqs.checkLitellmOnPath() under the config
 *     lock and bakes litellmCheck.path into both the generated run.js
 *     launcher (configGen.js's renderRunLauncherJs) and manifest.litellm_path
 *     (engine-context.js's config.generate) — NOT ecosystem.config.cjs,
 *     which only ever gets run.js's own path and the node interpreter
 *     (renderEcosystemConfigCjs); litellm's path never appears there. Worst
 *     case of racing the two is a spurious LITELLM_MISSING error, or a path
 *     baked in that becomes valid a moment later — cosmetic, no corruption,
 *     and correctly out of scope for a lock.
 *
 * `catalog` is the one domain here with genuinely no mutating concern
 * anywhere in its chain — catalog.fetch reads secretStore.load(), reads the
 * manifest via getManifest() for nim_base_url, and calls out to the remote
 * model catalog: reads, all the way down, nothing more. `app` is NOT in that
 * category, and this comment used to claim otherwise (NCOW-47 fix pass: that
 * claim was false and concealed a real defect, so don't reintroduce it):
 *
 *   - app.openLogsFolder (engine-context.js) runs
 *     `fs.mkdirSync(files.logsDir, {recursive: true})`, and logsDir lives
 *     INSIDE the directory the `config` lock guards
 *     (`logsDir = path.join(configDir, 'logs')`, paths.js) — yet `app`
 *     resolves to zero locks (no MUTEX_DOMAINS entry, no
 *     DOMAIN_MUTEX_ALIASES entry). `app` is NOT pure reads, but measuring it
 *     (NCOW-47 fix-pass-2) rules out this comment's earlier claim that the
 *     unlocked mkdirSync can land inside the purge critical section: a call
 *     delivered mid-uninstall — while uninstall.js's one
 *     `await pm2Control.remove()` is still pending — lands BEFORE
 *     fs.rmSync(configDir) and is wiped out by that same delete. (NCOW-48
 *     nuance: that's the shape when `pm2Control.remove()` resolves. It could
 *     already reject before NCOW-48 (a pm2 connect timeout, or a genuine pm2
 *     err callback) — NCOW-48 only adds a *bound* on top of that, so a wedge
 *     now rejects too instead of hanging forever — and either way, uninstall()
 *     throws before ever reaching the `opts.purge` branch, so there is no
 *     `fs.rmSync` call at all in that run for this mkdirSync to race
 *     against. The "no resurrection" conclusion below holds even more
 *     directly on that path: nothing deletes the directory in the first
 *     place, so there is nothing for an unlocked mkdirSync to resurrect.)
 *     On the resolve path, even
 *     scheduled in the exact same tick as uninstall:run it never lands
 *     between that rmSync and uninstall:run's promise fully settling either:
 *     everything from rmSync onward (removed.push, then the async returns
 *     back up through runUninstall -> the handler -> withLocks' sharedRun ->
 *     ipcMain.handle) is chained-promise microtask work with no macrotask
 *     boundary in it for a real, macrotask-delivered IPC/menu call to land
 *     inside. The genuinely reachable defect is different: a click on "Open
 *     Logs Folder" any time AFTER a purge-uninstall has already reported
 *     success recreates `<configDir>/logs` (and configDir itself)
 *     unconditionally — not a serialization gap, and no lock fixes it.
 *     Aliasing `app` onto `config` is specifically NOT that fix: measured
 *     doing exactly that, it turns the harmless mid-uninstall case above
 *     into a genuine resurrection, since the call then queues behind
 *     uninstall's own lock hold and lands AFTER fs.rmSync instead of before
 *     it. Left unfixed here (needs a guard in the handler itself — skip the
 *     mkdirSync when nothing is configured — which belongs in a follow-up
 *     task, not this one) — named so a future reader neither reaches for
 *     that alias nor re-assumes "app is pure reads".
 *   - app.quit (index.js) transitively stops the pm2-supervised proxy via
 *     before-quit -> stopProxyForShutdown — but that one IS already
 *     accounted for: it's the documented, deliberate carve-out described in
 *     ipc.js's DOMAIN_MUTEX_ALIASES comment ("Distinct from main/index.js's
 *     before-quit shutdown path..."), not an oversight, because a wedged
 *     pm2 must never make the app unquittable (CLAUDE.md).
 */
const MUTEX_DOMAINS = ['proxy', 'config', 'claudeDesktop', 'claudeCode'];

/**
 * One mutex per domain, created together so a single object can be handed to
 * every component that must share them (engine-context.js creates it,
 * index.js passes it on to registerIpcHandlers).
 *
 * @param {string[]} [domains]
 */
function createDomainMutexes(domains = MUTEX_DOMAINS) {
  const mutexes = {};
  for (const domain of domains) mutexes[domain] = createDomainMutex();
  return mutexes;
}

module.exports = { createDomainMutex, createDomainMutexes, MUTEX_DOMAINS };
