---
id: NCOW-48
title: >-
  Bound uninstall.run's pm2 calls so a wedged uninstall cannot freeze three
  mutex domains indefinitely
status: In Progress
assignee: []
created_date: '2026-08-05 15:28'
updated_date: '2026-08-05 17:38'
labels: []
dependencies:
  - NCOW-45
ordinal: 61000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The wave-7 integration review of NCOW-46 found that NCOW-45 widened the blast radius of a hung uninstall without bounding the thing that can hang. withLocks() (src/main/ipc.js) reserves every resolved lock synchronously and holds ALL of them for the full duration of the handler. Reviewer reproduced it directly: with a handler returning new Promise(() => {}), background work queued on mutexes.claudeCode, mutexes.config and mutexes.proxy all stayed blocked indefinitely. And the real handler genuinely is unbounded — uninstall.run -> pm2Control.remove() -> deleteAppIfPresent() -> pm2.delete(APP_NAME, cb) at src/engine/pm2Control.js:508-510, then save() -> pm2.dump(cb) at pm2Control.js:513-518. Both are raw pm2 callbacks with NO timeout; only ensureConnected() is bounded (pm2Control.js:51 and :312). Before NCOW-45 a wedge there froze the proxy domain alone; now it also freezes config and claudeCode, so Start/Stop/Restart AND config generation AND Claude Code configure/remove all go permanently dead until the app is restarted. Note what this is NOT: the app remains quittable, because before-quit bypasses these locks and shutdown.js already bounds its own stop with a timeout — so this is a UI-inert hazard, not an unquittable-app regression. That existing shutdown.js timeout is the precedent to follow: CLAUDE.md already states the principle ('a wedged pm2 must never make the app unquittable'), and this is the same principle applied to a wedged pm2 making the app unusable rather than unquittable. NCOW-46 did not touch this and its new module-load assertion structurally cannot see it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 pm2Control's remove()/deleteAppIfPresent() and save() paths are bounded by a timeout, following the existing bounded-ensureConnected and shutdown.js precedents rather than inventing a new mechanism
- [ ] #2 A timeout on those calls surfaces as a normal handler error (an {ok:false, code} result reaching the renderer) rather than an unhandled rejection or a silently-swallowed failure
- [ ] #3 A test demonstrates that a pm2 call which never invokes its callback no longer holds the claudeCode, config and proxy locks indefinitely — after the bound elapses, work queued on all three domains proceeds
- [ ] #4 The test genuinely fails against unpatched source (non-vacuity reproduced and reported), and cannot itself hang the suite if the bound regresses
- [ ] #5 Uninstall's existing success path is unchanged: a normal uninstall still completes with the same result shape and still holds all three locks for its real duration
- [ ] #6 All pre-existing tests continue to pass unmodified and npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read NCOW-48's full text — description, all 6 ACs, and the Implementation Notes' wave-8 correction block — and re-verify the pm2Control.js citations against current source.
2. Read the existing bounded precedents before writing anything: pm2Control.js's own withTimeout (used by ensureConnected via probeDaemonAlive/spawnDaemon), src/main/shutdown.js's bounded stop, ipc.js's withLocks/DOMAIN_MUTEX_ALIASES, and src/engine/uninstall.js — so the fix reuses the existing mechanism per AC#1 rather than inventing one.
3. Establish an npm test baseline.
4. Bound deleteAppIfPresent()'s pm2.delete and save()'s pm2.dump with that same withTimeout race, default 15s to match shutdown.js's precedent, each carrying a distinct .code (PM2_DELETE_TIMEOUT / PM2_SAVE_TIMEOUT) so ipc.js's existing catch-and-wrap surfaces it as {ok:false,error:{code}} rather than a generic UNEXPECTED (AC#2).
5. Add isolated unit tests in test/engine/pm2Control.test.js: a hanging pm2.delete/pm2.dump rejects with the right code within the bound; a healthy remove() is unaffected even under a tight 30ms window (AC#5 at unit level).
6. Add an end-to-end test in test/main/ipc-mutex.test.js through the REAL pm2Control.js + uninstall.js + registerIpcHandlers: a wedged pm2.delete no longer freezes claudeCode/config/proxy, all three plus an explicit apiKey channel proceed once the bound elapses (per correction #2), and the result surfaces as {ok:false, code:'PM2_DELETE_TIMEOUT'} (AC#3). A sibling test pins the unchanged success-path result shape and lock-hold duration (AC#5).
7. Prove non-vacuity by stashing pm2Control.js only and re-running both test files, confirming the new tests genuinely fail — and that the failure is contained rather than hanging the suite (AC#4's second half).
8. Update the two live test-count doc lines (CLAUDE.md:51, README.md:330).
9. Commit as three logical commits and push.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Corrections from the wave-8 integration review (NCOW-47's merge, 81b5eb9) — recorded by the campaign orchestrator, not yet reflected in the description above:

1. THIS TASK'S BLAST-RADIUS DESCRIPTION IS UNDERSTATED. NCOW-47 aliased apiKey onto the config lock, so a wedged uninstall now also freezes Set Key and Clear Key. The reviewer measured the exact live/dead split during a wedge:
   - LIVE: apiKey:getMasked, catalog:fetch, diagnostics:run, prereqs:installLitellm, app:openLogsFolder.
   - DEAD until it clears: apiKey:validateAndSave, apiKey:clear, config:generate, config:getManifest (plus proxy and claudeCode per this task's own text).
   That makes the deadness PARTIAL AND CONFUSING rather than an obvious hang: the Setup wizard can still load the live model catalog and run full diagnostics while being unable to set a key, clear a key, or generate a config — and getMasked stays live, so the UI keeps rendering a masked key it can no longer change.
2. AC#3 says 'work queued on the claudeCode, config and proxy locks proceeds'. apiKey resolves to config, so it is technically covered — but the demonstration would be materially more honest if the test exercised an apiKey channel explicitly, since that is now the most user-visible thing the wedge kills.
3. Citations re-checked against merged source: pm2Control.js:508-510 and :513-518 are STILL ACCURATE (pm2.delete at :509, pm2.dump at :516) — NCOW-47 did not touch that file. One pre-existing imprecision worth fixing while editing: this task's text says 'only ensureConnected() is bounded (pm2Control.js:51 and :312)', but :51 is probeDaemonAlive's 1500ms bound and :312 is spawnDaemon's 15s bound. Both are called BY ensureConnected; neither is ensureConnected's own bound.
4. Sequencing vs the newly-filed NCOW-50: the two treat the same SYMPTOM (a three-domain freeze) from opposite causes at different fix sites — NCOW-48 bounds pm2 callbacks in src/engine/pm2Control.js, NCOW-50 shortens a network-bound hold in src/main/engine-context.js. They do not conflict and neither subsumes the other. If NCOW-50 lands first, this task's AC#3 test remains valid unchanged.

## Wave 9 worker evidence (recorded by the campaign orchestrator; independent review pending)

Branch `fix/NCOW-48-bound-pm2-calls` @ `ea38690`, based on dev @ `84bb0d0`. Three commits (fix / test / docs). Orchestrator-verified numstat: `src/engine/pm2Control.js` +49/-11, `test/engine/pm2Control.test.js` +91/-0, `test/main/ipc-mutex.test.js` +195/-0, `CLAUDE.md` +1/-1, `README.md` +1/-1.

**AC#1.** deleteAppIfPresent()'s `pm2.delete` and save()'s `pm2.dump` now go through the SAME `withTimeout()` helper (Promise.race against a non-unref'd setTimeout) that `ensureConnected`'s own path already used — reusing the existing mechanism, not a new one. Default `pm2CallTimeoutMs = 15_000`, chosen to match shutdown.js's own pm2.stop() bound. Injectable via `deps.pm2CallTimeoutMs`.

**AC#2.** `withTimeout()` gained an optional 4th `code` argument, attached to the rejecting Error (`PM2_DELETE_TIMEOUT` / `PM2_SAVE_TIMEOUT`). ipc.js's pre-existing handler wrapper (`{ ok:false, error:{ code: err.code || 'UNEXPECTED', message } }`) then surfaces it as a normal result rather than a generic UNEXPECTED. Asserted directly in the new AC#3 test.

**AC#3.** New test in test/main/ipc-mutex.test.js drives a wedged fake pm2 (delete() never calls back) through the REAL pm2Control.js + uninstall.js + ipc.js chain. Observed: after 10 microtask ticks the order is still only `['uninstall:enter']` (everything locked); after the 30ms bound elapses uninstall:run resolves `{ok:false, error:{code:'PM2_DELETE_TIMEOUT'}}` and the queued claudeCode/config/proxy work AND an explicit `invoke('apikey:clear')` all proceed — the apiKey channel exercised explicitly per the wave-8 correction #2 rather than relying on apiKey resolving to config transitively.

**AC#4 — non-vacuity, both halves.** Stashed `src/engine/pm2Control.js` only and re-ran both test files:
- test/engine/pm2Control.test.js: the new hanging-delete test failed with `failureType: 'cancelledByParent'`, `'Promise resolution is still pending but the event loop has already resolved'` — Node's own runner catching the genuine hang. Clean again after restore.
- test/main/ipc-mutex.test.js: the new AC#3 test failed after ~2002ms with `'uninstall:run did not settle within 2000ms — the pm2.delete bound appears to be missing or regressed'`, `failureType: 'testCodeFailure'`, and **0 other tests cancelled** (39 pass / 1 fail / 0 cancelled of 40) — proving the second half of AC#4: the test's own test-local `withSafetyTimeout()` (2000ms, independent of and additional to production's bound) contained the failure instead of hanging the suite.

**AC#5.** New sibling test with a healthy pm2 fake under the same 30ms window confirms uninstall:run still returns `{ok:true, data:{removed:['pm2-app'], kept:[]}}` and still holds all three locks for its real duration (queued work proceeds only after uninstall:exit). pm2Control.test.js adds a unit-level equivalent.

**AC#6 / quality gate.** `npm test` 416/416 baseline; 421/421 pass, 0 fail, 0 cancelled final (observed twice, before and after the stash/restore cycle). Orchestrator independently confirmed via `--numstat` that BOTH test files are pure appends (0 lines removed), so no pre-existing test body was modified.

**Test-count doc lines** (this wave's assigned owner): CLAUDE.md:51 and README.md:330 updated 416 -> 421 in a dedicated commit. Orchestrator confirmed the README hunk sits at @@ -327 while wave-mate NCOW-51's README hunks are at @@ -269 and @@ -384 — non-overlapping, so no rebase conflict. NCOW-48 touched neither DESIGN.md nor src/engine/uninstall.js.

**Worker's own open questions, forwarded to review**: (a) a single shared `pm2CallTimeoutMs` default rather than independently tunable delete/dump bounds; (b) `pm2.stop()`, `pm2.start()` and `pm2.list()` remain unbounded at the raw-callback level, deliberately left out of scope since no AC cites them and shutdown.js already bounds its own stop() call — flagged in case review reads the task's intent more broadly.
<!-- SECTION:NOTES:END -->
