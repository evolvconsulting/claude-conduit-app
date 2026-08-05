---
id: NCOW-48
title: >-
  Bound uninstall.run's pm2 calls so a wedged uninstall cannot freeze three
  mutex domains indefinitely
status: In Progress
assignee: []
created_date: '2026-08-05 15:28'
updated_date: '2026-08-05 17:26'
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
<!-- SECTION:NOTES:END -->
