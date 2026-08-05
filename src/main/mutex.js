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
 *     uninstall (see prereqs.js's installLitellm).
 *
 * Only app and catalog are domains with genuinely no mutating concern
 * anywhere in the chain — pure reads, full stop.
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
