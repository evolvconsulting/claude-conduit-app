---
id: NCOW-56
title: >-
  Tray Start/Restart still silent on a resolved {ok:false} failure (only
  wedged/thrown calls are covered)
status: In Progress
assignee: []
created_date: '2026-08-06 18:16'
updated_date: '2026-08-07 00:24'
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

**Fix pass 1 returned (comment/test-title-only). Not yet re-reviewed.** F1, F2, F3, F4, F6 corrected; F5 deliberately left untouched (see below).

**Mechanical proof that zero production logic changed** — `esprima.tokenize()` (comment-stripping) plus an LCS/Myers diff over `(type, value)` token sequences, not a visual diff read:
- `src/main/tray.js`: **895 tokens before, 895 after, 0 diffs** — byte-identical non-comment token stream.
- `test/main/tray-actions.test.js`: 3217 → 3225 tokens, **8 diff ops, all additions, 0 deletions and 0 changes**, and every one of the 8 belongs to the ternary that selects which title string is passed to `test()` (`method`, `===`, `'onStop'`, `?`, two Template literals, `code`, `:`). None touches an assertion, mutex, handler, or expected value.

**Corrections made, each verified against source by the fix worker rather than trusting the finding's phrasing:**
- **F1**: replaced the false "the ordinary case right after Setup finishes" parenthetical. Verified `setup-view.js:232-234` (models-continue click → `await generateAndStart()`) and `:240-263` (`config.generate(...)` then immediately `await proxy.start()`), plus `DESIGN.md:225-227`'s "Step 5 — start under pm2". New text states the ordinary post-Setup case is actually `running`, and cites a genuinely reachable alternative it verified independently: `proxy.start()` failing at the pm2 level before pm2 registers the app — grounded in `engine-context.js:388-404` (the manifest is written by `config.generate` independently, before `proxy.start` is ever called) and `pm2Control.js:560-576` (`ensureConnected()` can reject before `pm2.start()` runs).
- **F2**: "the `litellm-nim` pm2 app has never been started" → "pm2 currently has no app registered under that name". Verified against `pm2Control.js:739` (`remove()` → `deleteAppIfPresent()`) and `:675-679` (the transient window inside `startOrRestart()`).
- **F3**: the Stop row's test title now reads as a synthetic contract case, flagging that `stop()` never itself resolves `{ok:false}` in production and that the row exists because `runAction()` checks every action generically. Start/Restart titles left untouched — those codes are real and reachable. Implemented as a `method === 'onStop' ? ... : ...` ternary, so only the Stop row's title changed.
- **F4**: "failed every one of the tests below" → "every one of the five parametrized tests below".
- **F6**: "`pm2Control.stop()` only rejects on a timeout" → "can reject on a timeout, on pm2's own callback error, or from a failed `ensureConnected()`". Verified `pm2Control.js:729` (raw pm2 callback error rejects directly, not only via the `withTimeout` wrapper) and `:560-576`.

**F5 left unfixed, deliberately and with the orchestrator's explicit instruction** — a throw from `Notification.isSupported()` (called outside `notifyFailure()`'s own try) is caught by the trailing `.catch()`, yielding a doubled and misattributed `console.error` plus a promise rejection that contradicts this module's own "none of the three ever reject" JSDoc. The reviewer confirmed it is pre-existing in class (the pre-branch code rejects identically under the same throwing fake) and realistically unreachable with Electron's real `Notification`. Fixing it would be a production logic change outside NCOW-56's acceptance criteria, so it is recorded here as a known residual and will be proposed to the user as a possible follow-up rather than folded in silently. No comment about it was added to the source.

**Two discrepancies the fix worker flagged rather than silently absorbing:**
- F6's cited location (`tray.js:236-237`) did not match where the quoted phrase actually was (line 227 pre-fix). Unambiguous because the phrase is unique in the file, but the citation was off.
- The worker's "6 of 8 new tests" arithmetic slip was checked for repo-wide (`grep -rn "6 of 8"`) and appears in **no file in this branch** — it existed only in the returned chat report, so there was nothing to correct in the repo. The real figure is 6 of 7.

**Carry-forward for the squash-merge:** commit `3be055c`'s body still contains the F2 "never been started" wording. It was deliberately NOT rewritten (that would require a force-push, and individual commit bodies do not survive a squash-merge into `dev` anyway) — the corrected wording is carried in this task record and must also go into the squash-merge commit body.

`npm test`: 474 passing / 0 failing, unchanged from the pre-fix baseline.

**Review pass 2 (opus, fresh reviewer): `request_changes`.** Independently confirmed AC: **1, 2, 3, 4, 5** — all five, including AC#2, which pass 1 had withheld. One blocking finding remains, and it is a quality gate rather than an AC failure.

**BLOCKING — `test/main/tray-actions.test.js:578-579`: fix pass 1 corrected the F6 falsehood in `src/main/tray.js` but left a verbatim duplicate of the same falsehood in the test file**, in lines this branch itself added (`git blame` → `3be055c`, the branch's own implementation commit). The surviving text reads "pm2Control.js's `stop()` only rejects on PM2_STOP_TIMEOUT or resolves with nothing to report as an error" — false for exactly the reason the tray.js copy was: `pm2Control.js:725-735`'s `stop()` also rejects with pm2's raw callback error (`:729`) and with anything `ensureConnected()` rejects with (`:726` → `:560-576` → `pm2ConnectOnce` `:538-542`), including a "pm2 connect timed out" rejection that is emphatically NOT `PM2_STOP_TIMEOUT`. Fix pass 1's commit message presents F6 as fixed ("Broadened the claim") but it broadened only one of the branch's two statements of it. **This is this campaign's signature failure mode in a new variant: a correction that fixes an INSTANCE rather than the CLAIM.** One-line English edit, zero token change; the conclusion the sentence supports (stop's real handler never itself resolves `{ok:false}`) is correct either way.

**Every replacement claim from fix pass 1 audited TRUE, with all cited locations verified accurate:**
- **F1 TRUE** — `setup-view.js:232-234` is exactly the models-continue click → `await generateAndStart()`; `:245-249` calls `config.generate`, bails at `:250-255`, then `:258` `await nimProxy.proxy.start()` with its own bail at `:259-263`, and the wizard only advances to `clientConfig` if the start succeeded, so `running` genuinely is the ordinary post-Setup state. `DESIGN.md:225-227` verbatim as cited. `engine-context.js:388-404` confirms `saveManifest({...})` returns inside the `config.generate` handler while `proxy.start` is a separate handler at `:409` — the manifest really is written before and independently of start. The new reachable example verified reachable: `pm2Control.js:671-684` does `ensureConnected()` (`:674`) → `deleteAppIfPresent()` (`:675`) → `pm2.start()` (`:679`), so a failure at `:674`/`:675` is strictly before registration AND after any prior app was removed, leaving `getStatus()` reporting `not-installed` with the manifest still on disk.
- **F2 TRUE** — `findApp()` (`:597-600`, `apps.find(app => app.name === APP_NAME) || null`) is a present-tense registry query, so it genuinely covers a previously-started-then-deleted app. Both cited locations accurate.
- **F3 TRUE** — the ternary changes only the Stop row's title; Start/Restart titles byte-identical (proved by the reviewer's own token diff and corroborated by the reverted-run output). The retitling is itself factually correct.
- **F4 TRUE and precise** — the reviewer's reverted run shows all five parametrized rows failing at `assert.equal(errorCalls.length, 1, ...)` with `0 !== 1`, so "the SAME assertion each time" is exact.
- **F6 TRUE in `tray.js`** — all three rejection paths real, both citations accurate. Incomplete only in the sense of the blocking finding above.

**AST proof independently reproduced by the reviewer** (`esprima.tokenize()`, full LCS DP diff over `(type,value)` pairs, `5894bcf` vs `ef28e0b`): `tray.js` 895 → 895 tokens, **0 diff ops**; `tray-actions.test.js` 3217 → 3225, **8 ops, all additions, LCS = 3217 = |A|** — meaning every pre-existing token survives in order, nothing changed or removed. All 8 additions are the title-selecting ternary and the two `Template` pieces of the new title. Confirmed English-only.

**AC#3 non-vacuity independently re-reproduced**: 19 tests, 13 pass, 6 fail against reverted `tray.js`; pass 1's "6 of 7 new tests" **confirmed exactly** (7 new = 5 parametrized + isSupported + the `{ok:true}` control, which correctly passes pre-fix). `npm test` observed by the reviewer: **474 passing / 0 failing**, exit 0.

**Scope re-confirmed clean**: `git diff --name-only` → exactly `CLAUDE.md`, `README.md`, `src/main/tray.js`, `test/main/tray-actions.test.js`; the README change is the single numeric `467 → 474` line with no prose; `index.js`, `electron-builder.yml`, `DESIGN.md` untouched; the `Notification.isSupported()` docstring unmodified. **No relative git refs anywhere** — the reviewer grepped the full diff AND all three commit messages for `HEAD~|HEAD^|HEAD|@{|ORIG_HEAD` and got nothing; the only ref cited is the absolute `5b9e49e...`. `git diff --numstat 5b9e49e...HEAD -- test/` → `160 0`, zero deletions.

**Two nits (both pre-existing from `3be055c`, not introduced by the fix pass):**
- `tray.js:103-104` says "changing this call's shape at its one call site (index.js)"; there is a second — `tray.js:137`'s own `setStatus({ status: 'stopped' })` seed call. `grep -rn setStatus src/` returns only `index.js:214` and `tray.js:137`. "its one EXTERNAL call site" would be exact. Conclusion unaffected.
- `tray.js:101-102` has a leftover ragged line wrap from the edit; cosmetic.

**Reviewer's note on F5 (agreeing with the deferral):** the class is genuinely pre-existing — the `.catch()` limb producing it is unchanged from before the branch, and real Electron's `Notification.isSupported()` does not throw. But it observed something worth recording: NCOW-56's new `.then()` limb adds a **second entry point** into the same latent bug, since a `{ok:false}` result now also reaches `notifyFailure()` on a path whose throw lands in that `.catch()`. It neither creates the defect nor makes it reachable with the real API. Correctly out of NCOW-56's scope; belongs in whatever residual gets filed.

**Reviewer's note on AC#2 durability:** the decision lives only as a code comment in `src/main/tray.js:78-117`. Right given sibling NCOW-58 owns README/DESIGN prose — but if the decision should be durable outside the source file, NCOW-58 is where to carry it.

**Fix pass 2 returned (comment-text-only, commit `7d9b0c9`). Not yet re-reviewed.** Blocking finding plus both nits corrected.

**The blocking duplicate is fixed.** `test/main/tray-actions.test.js:577-579` now reads "pm2Control.js's `stop()` can reject on a timeout, on pm2's own callback error, or from a failed `ensureConnected()` — or resolve with nothing to report as an error", matching the already-corrected `src/main/tray.js:232-233`. The worker verified the three distinct rejection paths itself and added a detail neither earlier pass stated: `ensureConnected()`'s own `withTimeout` at `pm2Control.js:562-565` is called with **no `code` parameter**, and `pm2ConnectOnce()`'s raw `pm2.connect` callback error at `:540` is likewise uncoded — while `withTimeout` only attaches `PM2_STOP_TIMEOUT` on its own timeout branch (`:531`). So two of the three rejection paths carry no code at all, which is a stronger refutation of "only rejects on PM2_STOP_TIMEOUT" than the reviewer's original framing.

**The required claim sweep was run and reported** — the specific discipline fix pass 1 failed. Two greps across the branch diff vs merge-base `5b9e49e...`: first scoped to the two touched files, then widened to all four changed files, searching for `"only rejects"`, `"PM2_STOP_TIMEOUT"`, `"nothing to report as an error"`, `"one call site"`, `"call site (index.js)"`. Results: **`"only rejects"` now has zero occurrences anywhere in the branch diff** — the false phrase is fully gone. The single surviving `PM2_STOP_TIMEOUT` hit is a correct, unrelated usage in `tray.js`'s doc comment listing example timeout codes for the throw/reject case, deliberately left alone with the reason stated. `CLAUDE.md`/`README.md` diffs confirmed to contain only the 467→474 count bump. Honest conclusion reported: nothing further to fix.

**Nits fixed:** "its one call site (index.js)" → "its one EXTERNAL call site (index.js)", verified via `grep -rn setStatus src/` returning exactly two invocations — `index.js:214` (external) and `tray.js:137` (the module's own internal seed call). The ragged comment wrap was reflowed (39/78-char pair → 62/60).

**AST proof, this pass: ZERO token diffs on BOTH files** — `src/main/tray.js` 895 → 895 (LCS 895, 0 ops) and `test/main/tray-actions.test.js` 3225 → 3225 (LCS 3225, 0 ops). Unlike fix pass 1, no test titles changed, so nothing at all should have moved, and nothing did. `git diff --stat`: 2 files changed, 9 insertions, 7 deletions, all inside `//` comment lines.

**All three citations quoted to the worker were accurate this pass** (577-579, 103-104, 101-102) — worth noting, since the previous round's F6 citation was off by ~9 lines and the worker was explicitly told to verify rather than trust.

`npm test`: **474 passing / 0 failing**. Scope held: no touch to `index.js`, `electron-builder.yml`, `DESIGN.md`, no prose in `README.md`/`CLAUDE.md`, no mention of F5 added anywhere, no rebase/force-push, no `backlog` command run.

**Review pass 3 (opus, final pass in the retry budget): `approve`.** Independently confirmed AC: **1, 2, 3, 4, 5**.

**The blocking finding is genuinely resolved and the replacement text is TRUE.** The reviewer read `pm2Control.js` itself rather than accepting the fix report, and confirmed all three rejection paths plus fix pass 2's new uncoded-paths assertion: `stop()` (`:725-735`) is `await ensureConnected()` then `withTimeout(...pm2.stop..., 'PM2_STOP_TIMEOUT')`; `withTimeout` (`:516-536`) attaches the code at `:531` **inside the `setTimeout` callback only**, so the raced promise's own rejection propagates through `Promise.race` untouched and the raw pm2.stop callback error is uncoded; `ensureConnected()` (`:560-576`) calls `withTimeout(...)` at `:562-565` with **three arguments and no `code`**; `pm2ConnectOnce()` (`:538-542`) rejects raw and uncoded. So of the three rejection paths, only `stop()`'s own timeout carries `PM2_STOP_TIMEOUT`. The conclusion the sentence supports was re-verified too: `engine-context.js:422-426` can only resolve `{ok:true}` or reject.

**Independent claim sweep — no third restatement survives.** The reviewer ran its own sweep rather than trusting fix pass 2's, widening beyond `"only rejects"` to every claim corrected across BOTH fix passes (`only reject`, `only resolve`, `PM2_STOP_TIMEOUT`, `ordinary case`, `right after Setup`, `never been started`, `every one of the`, `one call site`, `call site (index`, `nothing to report as an error`), over added lines in the diff AND repo-wide. Every hit was either the correction itself or a verified-correct unrelated usage. The three repo-wide hits outside the diff are all in files this branch does not touch; the only one adjacent to a corrected claim (`test/engine/pm2Control.test.js:59`, "reports not-installed when the app has never been started") is a pre-existing test title describing its own fixture — a never-started app genuinely does produce `not-installed` — not a definitional gloss, and it predates this branch.

**AST proof independently reproduced**: `src/main/tray.js` A=895 B=895 LCS=895 **ops=0**; `test/main/tray-actions.test.js` A=3225 B=3225 LCS=3225 **ops=0**. Every changed line in `ef28e0b..7d9b0c9` starts with `//`.

**Branch-level scope verified via `git diff --numstat` against the merge base**: CLAUDE.md 1/1, README.md 1/1, `src/main/tray.js` 100/6, `test/main/tray-actions.test.js` **161/0** — zero deleted lines in the test file across the whole branch, so no pre-existing test was modified. tray.js's six removed lines are only the two rewritten JSDoc `@returns` lines and `runAction()`'s four-line pre-fix body. `index.js`, `electron-builder.yml`, `DESIGN.md` untouched (empty `git diff --stat`); CLAUDE.md/README.md numeric-only; the `Notification.isSupported()` docstring appears only as diff context, never as a `+`/`-` line.

**Non-vacuity reproduced a third independent time**: reverting only `src/main/tray.js` to `5b9e49e...` gives 19 tests / 13 pass / **6 fail** — the five parametrized rows each at `assert.equal(errorCalls.length, 1, ...)` with `actual: 0 / expected: 1`, plus the `isSupported()===false` test; the `{ok:true}` control passes pre-fix. Matches passes 1 and 2 exactly.

**No relative git refs** anywhere in the diff or in any of the four commit messages; the only ref is the absolute `5b9e49e...`, used twice at `test/main/tray-actions.test.js:587-588`.

**Every remaining factual citation in the added comments was checked against source this pass and is accurate**: `dashboard-view.js:94` quoted verbatim; `pm2Control.js` "~703" is exactly the `HEALTH_CHECK_TIMEOUT` return; `engine-context.js:412` the `NOT_CONFIGURED` return; `:427` `restart: async () => handlers.proxy.start()`; `index.js:208-216` matches the quoted `startStatusPoller` shape; `status-poller.js:7-16` passes `getStatus()`'s value through with nothing manifest-related mixed in.

`npm test` observed by the reviewer: **474 passing / 0 failing / 0 cancelled / 0 skipped**.

**Two non-blocking findings, accepted as-is rather than spending a fourth cycle:**
- cosmetic, `test/main/tray-actions.test.js:580` — fix pass 2's reflow left its own ragged line (~30 chars against ~76-char neighbours), the same class of nit it was fixing in tray.js.
- info, `test/main/tray-actions.test.js:595` — the non-vacuity note paraphrases the failure as `"0 !== 1"`, which is `assert.strictEqual`'s default form; this is a loose `assert.equal` with a custom message, so Node reports `actual: 0 / expected: 1`. The substantive claim (which assertion, which values, all five tests) is exactly right and was reproduced.
<!-- SECTION:NOTES:END -->
