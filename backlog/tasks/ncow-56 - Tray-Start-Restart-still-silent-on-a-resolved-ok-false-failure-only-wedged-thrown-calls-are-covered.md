---
id: NCOW-56
title: >-
  Tray Start/Restart still silent on a resolved {ok:false} failure (only
  wedged/thrown calls are covered)
status: In Progress
assignee: []
created_date: '2026-08-06 18:16'
updated_date: '2026-08-06 23:52'
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

**Review pass 1 (opus): `request_changes`.** Independently confirmed AC: **1, 3, 4, 5**. AC#2 deliberately withheld — the decision is made and documented and its two load-bearing grounds were independently verified TRUE, but the illustration used to demonstrate them is false (F1).

**What the reviewer verified itself rather than accepting:**
- AC#1: re-read the fix; independently confirmed both error codes are real and correctly attributed — `engine-context.js:411-412` literally returns `{ok:false, error:{code:'NOT_CONFIGURED', message:'Run setup first.'}}`; `pm2Control.js:703` returns `HEALTH_CHECK_TIMEOUT`, forwarded by `engine-context.js:420`; `engine-context.js:427` is `restart: async () => handlers.proxy.start()`, so Restart genuinely inherits both. No fabrication.
- AC#3: re-ran non-vacuity itself via `git checkout 5b9e49e -- src/main/tray.js` + `node --test test/main/tray-actions.test.js` → 19 tests, 13 pass, 6 fail, all on the same assertion (`expected: 1 / actual: 0`), with the `{ok:true}` control correctly still passing. **Corrects the worker's arithmetic: 6 of 7 new tests fail, not "6 of 8"** — 7 matches the 467→474 bump.
- AC#5: `git diff --numstat 5b9e49e...HEAD -- test/` → `155 0` (pure addition, zero deletions in test/). Total branch deletions are exactly 8, all accounted for. Both `createTrayActions({ mutexes, handlers })` regex identity guards untouched and passing.
- npm test observed **474 passing / 0 failing**, twice, on a clean tree.
- **Scope: clean.** No prose in README/DESIGN/CLAUDE (numeric-only 467→474 bumps), no touch to `index.js` or `electron-builder.yml`, the `Notification.isSupported()` docstring verified untouched. No relative git refs anywhere — the only ref is the absolute `5b9e49e...`, and `git merge-base HEAD dev` confirmed to return exactly that SHA.

**The worker's "stop never resolves {ok:false}" claim HELD UP** under the reviewer's own independent tracing: `engine-context.js:422-426` can only return `{ok:true}` or reject; `pm2Control.stop()` resolves with nothing or rejects; and `index.js:208` passes `handlers` into `createTrayActions` with no interposing wrapper (the tray path bypasses `ipc.js` entirely). The comment asserting it is safe to keep.

**The AC#2 grounds HELD UP in substance:** `status-poller.js:12-14` calls `onStatus(await pm2Control.getStatus())` with nothing mixed in, and `index.js:211-217` passes that straight to `tray.setStatus` — so no manifest data is on that path (TRUE); `pm2Control.js:746-748` derives `not-installed` purely from `findApp()` returning null, orthogonal to `manifest.json` (TRUE); and the quoted dashboard line `dashboard-view.js:94` is exact (TRUE).

**Findings:**
- **F1 (major, `src/main/tray.js:91-93`)** — a false claim about another module's behavior, inside the AC#2 documentation artifact itself. The comment calls a completed-but-never-started setup "the ordinary case right after Setup finishes"; it is not. `setup-view.js:232-234` wires the models step straight into `generateAndStart()`, which at `:240-263` calls `config.generate(...)` then immediately `await proxy.start()` in the same wizard step — DESIGN.md's "Step 5 — start under pm2" confirms this is by design. The ordinary post-Setup case is `running`. The orthogonality CONCLUSION survives (`not-installed` with a manifest on disk is genuinely reachable: a setup whose `proxy.start()` failed before pm2 registration, an out-of-band `pm2 delete litellm-nim`, or a pm2 daemon restarted without resurrect) — so this is a comment-only correction.
- **F2 (minor, `src/main/tray.js:89-90`)** — `not-installed` glossed as "never been started"; `findApp()` returning null also covers a previously-started app since deleted (uninstall's `deleteAppIfPresent()` at `pm2Control.js:739`, and the transient window inside `startOrRestart()` between `:675` and `:679`). Same wording is in commit `3be055c`'s body.
- **F3 (minor, `test/main/tray-actions.test.js:601`)** — the Stop/NOT_CONFIGURED parametrized row produces a test title describing a production scenario that cannot occur. Materially better than wave 14's fabricated code (this code is real and correctly attributed to `start` in the comment at `:578-582`, and AC#1 does require Stop coverage), but a reader grepping the title alone is misled.
- **F4 (nit, `test/main/tray-actions.test.js:592-593`)** — "failed every one of the tests below" is false for the `{ok:true}` control, which the reviewer observed passing pre-fix.
- **F5 (nit, `src/main/tray.js:279-292`)** — a throw from `Notification.isSupported()` (called at `:265`, outside `notifyFailure()`'s own try) is caught by the trailing `.catch()`. Reviewer reproduced with a throwing fake: TWO `console.error` lines, the second misattributed, and the returned promise REJECTED, violating the "none of the three ever reject" JSDoc contract at `:250-257`. **Pre-existing in class** — the reviewer ran the pre-change code with the same fake and it rejects too. Realistically unreachable with Electron's real `Notification`.
- **F6 (nit, `src/main/tray.js:236-237`)** — docstring says `pm2Control.stop()` "only rejects on a timeout"; it can also reject with pm2's own callback error (`pm2Control.js:728`) or from `ensureConnected()`.

**Reviewer's forward-looking note for NCOW-57:** this branch inserts a 34-line comment block immediately AFTER the `Notification.isSupported()` docstring NCOW-57 owns. It does not modify those lines, but the adjacency means NCOW-57's edit will land right against new text — sequence NCOW-57 after this merges and rebase rather than cherry-pick.
<!-- SECTION:NOTES:END -->
