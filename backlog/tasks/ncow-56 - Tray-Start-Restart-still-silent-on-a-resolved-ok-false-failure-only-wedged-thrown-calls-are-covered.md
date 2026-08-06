---
id: NCOW-56
title: >-
  Tray Start/Restart still silent on a resolved {ok:false} failure (only
  wedged/thrown calls are covered)
status: In Progress
assignee: []
created_date: '2026-08-06 18:16'
updated_date: '2026-08-06 23:42'
labels: []
dependencies:
  - NCOW-55
ordinal: 69000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-55 gave the tray a real user-visible error surface for wedged Start/Stop/Restart calls (throws/rejections), using Electron's native Notification API. But the wave-14 integration review found the renderer's own `#start-btn`/`#restart-btn` handlers already toast on a DIFFERENT, more common failure mode: `handlers.proxy.start()` (src/main/engine-context.js) can RESOLVE with `{ok:false, error:{code:'NOT_CONFIGURED'}}` or `{ok:false, error:{code:'HEALTH_CHECK_TIMEOUT'}}` (after a 60s window) rather than throwing — `restart` inherits this since it's `async () => handlers.proxy.start()`. NCOW-55's tray fix only wraps a `.catch()` around the mutex-guarded call, so it fires on a genuine pm2-level rejection (PM2_START_TIMEOUT and similar) but does nothing when the call resolves with `{ok:false}` instead.

Concrete reproducible case: tray.js currently enables Start whenever `status !== 'running'`, with no manifest check (unlike the dashboard's Start button, which is `disabled` when `!manifest`). On a fresh, unconfigured install, clicking tray Start returns `{ok:false, error:{code:'NOT_CONFIGURED'}}` and the user sees nothing at all — no notification, no console.error, no error of any kind. This is the same "invisible to the user" gap NCOW-55 was filed to close, for the failure mode that's actually the more common one in practice.

This task: extend the tray's error surface to also cover a resolved `{ok:false}` result, not just a thrown rejection, for all three actions (Start/Stop/Restart) — using the same Notification mechanism NCOW-55 established. Also decide whether tray Start's enabled/disabled logic should require a manifest, matching the dashboard's #start-btn, or whether showing a clear NOT_CONFIGURED notification on click is a sufficient alternative — document whichever is chosen and why.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A tray Start/Restart/Stop click that resolves {ok:false} (e.g. NOT_CONFIGURED, HEALTH_CHECK_TIMEOUT) surfaces a user-visible notification, using the same mechanism NCOW-55 established for thrown/rejected calls
- [ ] #2 Decide and document whether tray Start's enabled/disabled state should require a manifest (matching the dashboard's #start-btn) or whether a clear on-click notification is the chosen alternative
- [ ] #3 A test demonstrates the {ok:false} surface actually shows a notification for a genuinely {ok:false} resolved call (e.g. NOT_CONFIGURED on an unconfigured install), and fails against current merged source (non-vacuity reproduced and reported)
- [ ] #4 Normal (successful) Start/Stop/Restart tray behavior is unchanged
- [ ] #5 All pre-existing tests continue to pass unmodified and npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read src/main/tray.js in full, src/main/engine-context.js's proxy handlers, src/renderer/views/dashboard-view.js's Start/Stop/Restart handlers (the precedent for {ok:false} toast handling), test/main/tray-actions.test.js, and test/main/tray.test.js.
2. Verify in source that NOT_CONFIGURED and HEALTH_CHECK_TIMEOUT genuinely exist and in what real shapes, rather than trusting the task text's quotation of them.
3. Investigate AC#2 empirically: trace setStatus()'s only input back through status-poller.js and index.js's call site to establish whether any manifest data reaches the tray, and determine what `not-installed` actually means in pm2Control.js.
4. Implement: createTrayActions()'s runAction() also inspects the RESOLVED value via .then(), and for {ok:false} logs via console.error and calls the existing notifyFailure() (left unchanged), then passes the result through unchanged. The .catch() branch for thrown/rejected calls stays untouched.
5. Document the AC#2 decision as a code comment at the Start menu item in tray.js plus an NCOW-56 doc comment above createTrayActions(). (Orchestrator scope boundary: README/DESIGN prose is NCOW-58's, so AC#2's "document" lands in code comments plus this task record.)
6. Add tests to test/main/tray-actions.test.js: a parametrized loop (NOT_CONFIGURED for all three actions, HEALTH_CHECK_TIMEOUT for Start/Restart), an isSupported()===false fallback test, and an {ok:true} control test.
7. Prove non-vacuity by stashing ONLY src/main/tray.js and running the new tests against unmodified merged source.
8. Run npm test; confirm the two pre-existing engine-context-config-regen.test.js identity-guard tests still pass unmodified.
9. Bump stale numeric test-count citations in CLAUDE.md/README.md.
10. Commit in small logical commits and push.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Worker implementation returned (wave 15, branch `fix/NCOW-56-tray-ok-false-notify`, commits `3be055c` + `5894bcf`). Not yet reviewed.**

**AC#2 decision (chosen: on-click notification, NOT manifest-gated enable/disable).** Grounds, as reported by the worker: `tray.js`'s `setStatus(status)` receives exactly `pm2Control.getStatus()`'s return shape (`{status, pid, uptime, restarts}`) — traced through `status-poller.js`'s `startStatusPoller({ pm2Control, onStatus })` and `index.js`'s `onStatus` call site — with no manifest information anywhere on that path. Separately, `pm2Control.js`'s `getStatus()` reports `not-installed` purely from `findApp()` finding nothing (the `litellm-nim` pm2 app was never started), which is a DIFFERENT axis from whether `manifest.json` exists: a completed-but-never-started setup is `not-installed` with a manifest already on disk, and nothing prevents `stopped`/`errored`/`running` with no manifest either. Gating Start's `enabled` on manifest presence would require threading new manifest state into `setStatus()`, changing `index.js`'s call site and `status-poller.js`'s `onStatus` payload shape — `index.js` is sibling task NCOW-57's territory this wave. Accepted trade-off, documented in the code comment: a click on an unconfigured install still round-trips through the handler before the user learns anything, rather than the button being visibly inert — but it is no longer silent.

**Evidence reported per AC (to be independently re-verified at review, not accepted as-is):**
- AC#1: new parametrized tests in `test/main/tray-actions.test.js` cover 5 rows (3x NOT_CONFIGURED across Start/Stop/Restart, 2x HEALTH_CHECK_TIMEOUT across Start/Restart).
- AC#3 non-vacuity: `git stash push --keep-index -- src/main/tray.js`, then `node --test test/main/tray-actions.test.js` — reported 6 of 8 new tests failing identically on `expected exactly one console.error call diagnosing the resolved failure / 0 !== 1`, with the `{ok:true}` control test correctly still passing. Restored; all 19 pass again.
- AC#5: baseline confirmed 467 passing before any change; final `npm test` 474 passing / 0 failing (7 new). `test/main/engine-context-config-regen.test.js` in isolation 25 passing — the two `createTrayActions({ mutexes, handlers })` regex identity guards untouched.

**Worker-reported finding worth carrying into review:** `stop`'s real `engine-context.js` handler never itself resolves `{ok:false}` today — `pm2Control.stop()` only rejects (PM2_STOP_TIMEOUT) or resolves with nothing to report. The task text's "Start/Restart/Stop" framing in AC#1 is therefore aspirational for Stop against current production code. The worker still implemented the check generically for all three actions on the grounds that it costs nothing and covers Stop for free if a future change makes it resolve `{ok:false}`. **This claim needs independent verification at review** — it is exactly the class of counterfactual/behavioral assertion this campaign has repeatedly found to be wrong.

Files touched: `src/main/tray.js`, `test/main/tray-actions.test.js`, plus numeric-only test-count bumps in `CLAUDE.md` and `README.md`. No live Electron verification was performed (optional for this task). Scope boundaries held: `src/main/index.js` and `electron-builder.yml` untouched (NCOW-57's), the existing `Notification.isSupported()` docstring unmodified (NCOW-57's), no pre-existing test modified, no `backlog` command run by the worker.
<!-- SECTION:NOTES:END -->
