---
id: NCOW-31
title: 'Serialize config-regeneration''s proxy restart, and retry a failed regeneration'
status: In Progress
assignee: []
created_date: '2026-08-04 06:27'
updated_date: '2026-08-04 18:47'
labels:
  - pm2
  - packaging
dependencies: []
priority: low
type: bug
ordinal: 44000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found independently by both NCOW-30's opus reviewers (2026-08-04), across
its two review passes.

NCOW-30 added a launch-time stale-config regeneration mechanism
(configGen.js's regenerateStaleConfig(), wired into
src/main/engine-context.js) that, when a currently-running proxy is
detected, calls pm2Control.startOrRestart() in the background to pick up
the regenerated config. Two related gaps in that restart path were
deliberately deferred out of NCOW-30's own fix pass as out of scope for a
single-task fix:

1. **Not serialized behind ipc.js's proxy-domain mutex.** Every other
   proxy-affecting operation in this app (start/stop/restart via the
   renderer) goes through a mutex constructed inside ipc.js at module scope
   (`mutexes` at ipc.js:38). engine-context.js's background restart calls
   pm2Control.startOrRestart() directly, with no shared reference to that
   lock -- engine-context.js cannot simply `require('./ipc')`, because
   ipc.js pulls ipcMain/app/shell from electron at module scope and
   engine-context.js is required directly by several plain `node --test`
   suites that have no Electron runtime. A real fix needs a new
   electron-free mutex module (or equivalent shared primitive)
   engine-context.js and ipc.js can both construct/reuse, not a one-line
   change. Without it, a race is possible: an upgrade launch that finds the
   proxy already running, PLUS a user clicking Stop (or quitting the app)
   inside the up-to-60s health-check window of the background restart,
   could interleave with that restart. Both reviewers judged the practical
   blast radius small and recoverable (e.g. a Stop that doesn't stick,
   visible on the status pill) -- not a data-loss or security issue, but a
   real correctness gap worth closing.

2. **A failed restart is never retried.** regenerateStaleConfig() stamps
   manifest.json's `generated_by_version` BEFORE attempting the restart, so
   if the restart fails (or times out), the next app launch sees the
   manifest as already current and skips regeneration entirely --
   permanently, until something else changes the running app's version
   again. Compounding this, the current failure-logging (added in NCOW-30's
   fix pass) only fires on a genuine throw from pm2Control.startOrRestart();
   it does NOT inspect that function's other failure shape, a normal
   returned `{ ok: false, error: { code: 'HEALTH_CHECK_TIMEOUT' } }` (see
   pm2Control.js's startOrRestart(), ~line 404) -- so a health-check timeout
   during a background restart is currently silent AND non-retried.

Fixing these together makes sense since both live in the same
regenerateStaleConfig()/startOrRestart() call path and a shared "did the
restart actually succeed" signal is useful for both (only stamp
generated_by_version -- or otherwise mark regeneration complete -- after a
confirmed-successful restart, and log/distinguish a timeout-shaped failure
from a thrown error).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The background restart triggered by stale-config regeneration is serialized against the same proxy-domain mutex ipc.js already uses for user-initiated start/stop/restart, so the two can never interleave
- [ ] #2 A failed or timed-out restart (both the thrown-error shape and pm2Control.startOrRestart()'s {ok:false, error} return shape) is logged distinctly from success, and does NOT cause generated_by_version to be stamped -- so the next app launch retries regeneration instead of silently treating it as done
- [ ] #3 A regression test covers: (a) the mutex actually prevents an interleaved user-initiated proxy operation during a background restart, (b) a failed/timed-out restart is retried on the next launch rather than silently skipped
- [ ] #4 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Verify the mutex.js extraction left by a crashed prior worker session is complete and correct (electron-free FIFO per-domain mutex module) -- do not rewrite it.
2. Finish wiring src/main/ipc.js: accept an injected mutex set via opts.mutexes; invert the prior worker's SERIALIZED_METHODS allowlist to an UNSERIALIZED_METHODS denylist (proxy.getStatus/getRecentLogs only) so any proxy method added later is serialized by default rather than silently unlocked -- the allowlist form would have shipped a real regression (unlocking start/stopLogTail, which mutate engine-context's single logTailUnsubscribe slot).
3. Wire src/main/index.js to actually pass the shared mutex set through to registerIpcHandlers -- without this the whole mechanism is inert in the real app (registerIpcHandlers would build its own private lock set).
4. engine-context.js creates the shared mutexes, exposes them (context.mutexes), and injects a runProxyOperation bound to mutexes.proxy.run into configGen.regenerateStaleConfig() -- the status read (getStatus) is inside the SAME critical section as the restart, not just the restart, so a Stop landing between the read and the restart can't race it.
5. configGen.js: stamp generated_by_version only after a confirmed-successful restart; recognize and distinctly log both failure shapes (a thrown error, and pm2Control.startOrRestart()'s {ok:false,error} return, e.g. HEALTH_CHECK_TIMEOUT) instead of only the thrown-error shape.
6. Deliberately leave shutdown.js's before-quit proxy stop UNSERIALIZED against this lock -- queueing it behind a background restart that can hold the lock for up to 60s would make the app unquittable while wedged, which CLAUDE.md forbids outright. Documented as a deliberate choice, not a silent gap.
7. Regression tests for both ACs, including a negative control proving the pre-fix code actually interleaves (so the test measures the lock, not luck), and mutation-testing 10 distinct reverts against the new tests.
8. npm test, commit in 2 logical commits, push.
<!-- SECTION:PLAN:END -->
