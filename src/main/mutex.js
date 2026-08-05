'use strict';

/**
 * The per-domain serialization primitive for every operation that mutates
 * shared state this app owns (the pm2-supervised proxy, the generated config
 * directory, Claude Desktop's/Claude Code's settings).
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
 *     (aliases onto) one of these four locks instead of getting its own,
 *     because its mutation touches state one of these domains already
 *     guards. See DOMAIN_MUTEX_ALIASES in ipc.js for exactly which lock each
 *     aliases onto and why (NCOW-32/45 for uninstall/update, NCOW-47 for
 *     apiKey).
 *   - diagnostics, prereqs: checked and confirmed to need NO lock at all —
 *     not even an alias. diagnostics.run reads the same secretStore state
 *     apiKey/config now serialize, but is deliberately left unserialized
 *     (see the comment on diagnostics.run in engine-context.js). prereqs.
 *     installLitellm shells out to uv/pipx/pip entirely outside the config
 *     directory, so it cannot collide with the config lock or a purge-
 *     uninstall (see prereqs.js's installLitellm) — its only coupling to
 *     `config` is indirect: it changes whether litellm is on PATH, and
 *     config.generate calls prereqs.checkLitellmOnPath() under the config
 *     lock and bakes litellmCheck.path into both ecosystem.config.cjs and
 *     manifest.litellm_path (engine-context.js's config.generate). Worst
 *     case of racing the two is a spurious LITELLM_MISSING error, or a path
 *     baked in that becomes valid a moment later — cosmetic, no corruption,
 *     and correctly out of scope for a lock.
 *
 * `catalog` is the one domain here with genuinely no mutating concern
 * anywhere in its chain — it only reads secretStore.load() and calls out to
 * the remote model catalog, full stop. `app` is NOT in that category, and
 * this comment used to claim otherwise (NCOW-47 fix pass: that claim was
 * false and concealed a real defect, so don't reintroduce it):
 *
 *   - app.openLogsFolder (engine-context.js) runs
 *     `fs.mkdirSync(files.logsDir, {recursive: true})`, and logsDir lives
 *     INSIDE the directory the `config` lock guards
 *     (`logsDir = path.join(configDir, 'logs')`, paths.js) — yet `app`
 *     resolves to zero locks (no MUTEX_DOMAINS entry, no
 *     DOMAIN_MUTEX_ALIASES entry). That unlocked mkdirSync can land inside a
 *     purge-uninstall's fs.rmSync(configDir) critical section (uninstall.js,
 *     held under claudeCode+config+proxy) and resurrect `<configDir>/logs`
 *     after uninstall has already reported success — a real, reproducible
 *     defect of exactly the family this task closes for apiKey. Deliberately
 *     left unfixed here (belongs in a follow-up task, not this one) — this
 *     comment names it so a future reader can find it instead of assuming
 *     "app is pure reads" the way this comment used to claim.
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
