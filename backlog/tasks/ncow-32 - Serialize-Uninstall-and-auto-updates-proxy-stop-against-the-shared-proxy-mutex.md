---
id: NCOW-32
title: >-
  Serialize Uninstall and auto-update's proxy-stop against the shared proxy
  mutex
status: In Progress
assignee: []
created_date: '2026-08-04 19:29'
updated_date: '2026-08-05 04:57'
labels: []
dependencies:
  - NCOW-31
ordinal: 45000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-31 gave engine-context.js's background config-regeneration restart and ipc.js's user-initiated proxy start/stop/restart a shared mutex (src/main/mutex.js, MUTEX_DOMAINS: proxy/config/claudeDesktop/claudeCode). Its review pass 2 found, while sweeping for any remaining unlocked caller, that this coverage is incomplete: the 'uninstall' and 'update' IPC domains have no mutex at all. Two real callers reach pm2Control without taking any lock: uninstall.run() -> runUninstall() -> pm2Control.remove() (src/engine/uninstall.js), and update.install() -> installUpdateAndRestart() -> stopProxyForShutdown() (src/main/autoUpdate.js). Clicking Uninstall inside a background restart's up-to-60s health-check window is not serialized against it -- pm2Control.remove()'s deleteAppIfPresent()+save() could run concurrently with the restart's own deleteAppIfPresent()->pm2.start(), and the in-flight restart's pm2.start() could re-register and start litellm against a config directory Uninstall is concurrently deleting, leaving a running proxy behind after 'uninstall complete'. The auto-update path reaches the same unserialized stopProxyForShutdown() used by the (deliberately unserialized, and separately reviewed/accepted) before-quit shutdown path -- but auto-update's caller is an ordinary IPC handler on an unmutexed domain, not a quit path, so the shutdown-carve-out's justification (never make the app unquittable) does not apply to it and it should very plausibly be serialized.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Uninstall's call into pm2Control.remove() is serialized against the same proxy mutex the background config-regeneration restart uses, so an Uninstall click can never run concurrently with an in-flight restart
- [ ] #2 The auto-update install path's proxy-stop (installUpdateAndRestart -> stopProxyForShutdown) is likewise serialized against the same mutex, distinct from the deliberately-unserialized before-quit shutdown path (which stays as-is)
- [ ] #3 A regression test demonstrates a background restart and an Uninstall (or auto-update install) attempt can no longer interleave
- [ ] #4 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read mutex.js, ipc.js, uninstall.js, autoUpdate.js, index.js, engine-context.js, and
   relevant existing tests (ipc-mutex.test.js, mutex.test.js, auto-update-wiring.test.js,
   uninstall.test.js, engine-context-config-regen.test.js, tray-actions.test.js) to confirm
   both unlocked call sites and understand exactly how registerIpcHandlers resolves
   per-domain locks.
2. Confirm both uninstall.run and update.install already flow through registerIpcHandlers()
   with the same shared mutexes object index.js passes everywhere else -- fix can live
   entirely in ipc.js, zero wiring changes needed in index.js/engine-context.js.
3. Implement a domain-alias mechanism in src/main/ipc.js: a DOMAIN_MUTEX_ALIASES map
   ({ uninstall: 'proxy', update: 'proxy' }) plus a resolveDomainLock(mutexes, domain)
   helper that falls back to a domain's alias when mutexes has no lock of its own for it.
   Serializes every method of uninstall/update by default (opt-out philosophy matching
   UNSERIALIZED_METHODS), rather than hand-wrapping individual call sites.
4. Add update: ['check'] to UNSERIALIZED_METHODS -- update:check never touches pm2Control
   or the config directory (unlike update:install), so it should keep firing immediately at
   startup rather than queuing behind a background restart.
5. Deliberately do NOT add uninstall/update to mutex.js's MUTEX_DOMAINS -- they only need to
   share proxy's lock, keeping createDomainMutexes()'s own "exactly these domains" test
   unaffected.
6. Update one stale comment in engine-context.js (diagnostics handler) that enumerated "only
   proxy/config/claudeDesktop/claudeCode have a domain mutex" -- no longer fully accurate
   post-alias.
7. Add 5 regression tests to test/main/ipc-mutex.test.js reusing the existing fake-electron
   require.cache shim and held-mutex pattern from NCOW-31's own tests.
8. Verify before/after test counts and that the new tests fail without the fix.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
IMPLEMENTED (worker report). Baseline before fix: npm test 382/382 passing. After fix: npm
test 387/387 passing (5 new tests, nothing else changed). AC#3 verification: temporarily
stashed only src/main/ipc.js (keeping the new tests) and reran test/main/ipc-mutex.test.js --
4 of the 5 new tests failed, demonstrating the exact interleaving the fix prevents
(update:install's body and uninstall:run's body both entered while the background restart
holding mutexes.proxy was still in flight, instead of queuing behind it). The 5th test
(update:check opting out of the lock) passed either way, as expected. Restored ipc.js and
reran -- all 5 pass with correct FIFO ordering (bg-restart:enter -> bg-restart:exit ->
uninstall:enter/install:enter).

Files touched: src/main/ipc.js (DOMAIN_MUTEX_ALIASES, resolveDomainLock(),
UNSERIALIZED_METHODS.update, doc comments), src/main/engine-context.js (one comment
correction, no behavior change), test/main/ipc-mutex.test.js (5 new regression tests).

Judgment calls: (1) chose the generic domain-alias approach in ipc.js over hand-wrapping
installUpdateAndRestart/uninstall.run at their call sites in index.js/engine-context.js --
required touching only ipc.js and kept the existing opt-out-list philosophy; (2) exempted
update:check from the alias lock (added to UNSERIALIZED_METHODS) since it never touches
pm2Control and locking it would delay the startup update-check broadcast for no safety
benefit -- pinned with a dedicated test.

Follow-up flagged as out of scope (not created as a task yet, needs user approval per
campaign convention): diagnostics:run remains completely unmutexed (pre-existing, called out
in both NCOW-17's and this task's comments) -- overlapping diagnostic runs are only
prevented by the renderer disabling its own button, not at the IPC layer.

Branch fix/NCOW-32-serialize-uninstall-update-proxy-mutex pushed to origin. Two commits:
fix(ipc): serialize uninstall and update-install against the proxy mutex;
test(ipc): cover NCOW-32's uninstall/update-install mutex aliasing.

REVIEW (opus, independent): verdict APPROVE. All 4 ACs independently confirmed:
- AC#1: traced uninstall.run's sole call path (engine-context.js -> IPC handler only, no
  tray/menu route) through resolveDomainLock -> mutexes.proxy, same identity as the
  background restart's runProxyOperation lock.
- AC#2: traced update.install's sole call path (index.js:149 IPC handler only;
  autoInstallOnAppQuit=false rules out an electron-updater quit-time call). Confirmed
  before-quit's own stopProxyForShutdown() path in index.js is untouched (index.js absent
  from the diff) and stays outside the mutex, per AC#2's explicit requirement. Checked for a
  lock-then-quit deadlock -- none, the shuttingDown latch fires first.
- AC#3: reviewer's OWN adversarial reproduction (not the worker's claim) -- swapped
  src/main/ipc.js back to dev's version, kept the new tests: 387 -> 383 passing, with exactly
  the 4 AC#3-relevant tests failing (test 12 fails for an incidental microtask-ordering
  reason rather than serialization, noted as a non-blocking test-quality nuance, not a
  correctness problem). Restored ipc.js and SHA-256-verified it matches the pre-experiment
  copy; worktree left clean at the worker's actual commits.
- AC#4: reviewer's own npm test run: 387/387 passing on the fixed branch.

Scope confirmed: exactly 3 files (ipc.js, engine-context.js comment-only, ipc-mutex.test.js),
no drive-bys, MUTEX_DOMAINS unchanged.

Non-blocking findings (none require a branch change): (1) CLAUDE.md's test count is stale
again (382 -> 387) -- deferred to the wave-integration doc pass, same as prior waves; (2)
DESIGN.md's proxy-mutex-domain enumeration (~line 400-410) doesn't yet mention
uninstall/update sharing the lock -- same doc pass; (3) ipc.js's "update:check is a pure
status read" comment slightly understates checkForUpdates()'s own background-download
behavior on win32/linux, though the safety reasoning for exempting it from the lock is sound
and confirmed independently; (4) confirmed the ipc.js-only domain-alias approach is the
right interpretation and no non-IPC caller of pm2Control.remove()/installUpdateAndRestart()
exists; (5) confirmed the update:check lock exemption is safe and philosophically consistent
with the existing proxy-domain exemptions; (6) pre-existing, out of scope: the alias only
shares the proxy mutex, not the config domain, so uninstall's config-directory purge is not
serialized against configGen.js's regenerateStaleConfig() config-file-write phase (only its
pm2.start() phase) -- practically negligible since that write completes synchronously during
createEngineContext(), before the window is interactive, and outside NCOW-32's own ACs;
flagged for a future backlog item, not this branch. No overlap risk with NCOW-44 (disjoint
file sets, dev only advanced via orchestrator bookkeeping commits since branch point).

No injected-instruction pattern encountered on this worktree (slot 1).
<!-- SECTION:NOTES:END -->
