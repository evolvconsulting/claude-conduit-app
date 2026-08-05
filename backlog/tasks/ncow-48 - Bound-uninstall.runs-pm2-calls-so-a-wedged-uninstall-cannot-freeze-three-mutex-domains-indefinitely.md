---
id: NCOW-48
title: >-
  Bound uninstall.run's pm2 calls so a wedged uninstall cannot freeze three
  mutex domains indefinitely
status: In Progress
assignee: []
created_date: '2026-08-05 15:28'
updated_date: '2026-08-05 18:13'
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

## Wave 9 review pass 1 — REQUEST_CHANGES (independent opus review; recorded by the orchestrator)

**Confirmed AC: #2, #3, #4, #5, #6. NOT confirmed: #1.**

**BLOCKING — AC#1 is not met: `pm2.list` at src/engine/pm2Control.js:523 is still an unbounded raw callback INSIDE deleteAppIfPresent()'s own path, and it is reached BEFORE the newly-bounded pm2.delete.** AC#1 requires the `remove()`/`deleteAppIfPresent()` and `save()` *paths* be bounded; the mechanism choice is right but the paths are not. Full chain: remove() → ensureConnected (≤30s) → deleteAppIfPresent → ensureConnected (memo) → findApp → listApps → **pm2.list (UNBOUNDED)** → pm2.delete (≤15s) → save → pm2.dump (≤15s). In the canonical wedge — daemon accepts the connection then stops answering RPC — pm2.list hangs first and **the two new bounds never engage at all**. The reviewer reproduced the original wave-7 three-domain freeze through the real ipc.js/withLocks + real pm2Control + real uninstall.js chain with only pm2.list wedged and the bound at 30ms:

    PROBE A (wedged pm2.list, bound=30ms): FROZEN: STILL FROZEN after 3000ms (100x the bound)
    PROBE A order: ["uninstall:enter","pm2.list called, never calls back"]

claudeCode, config, proxy and apikey:clear all stayed dead. As delivered, **this task's own title is false**. Reviewer's recommendation, which the orchestrator accepted: fix on this branch (~10 lines plus a test) rather than filing a follow-up; if deferred instead, AC#1 must not be settled as met.

**MAJOR — AC#4's second half is only half-engineered, AND THE EVIDENCE PREVIOUSLY RECORDED IN THESE NOTES IS WRONG.** The worker reported '0 other tests cancelled'. That is true only of ipc-mutex.test.js in isolation. The reviewer's own full-suite run with only src/engine/pm2Control.js reverted: **`# pass 391 / # fail 1 / # cancelled 29`**. Per file: ipc-mutex.test.js clean (40 tests, 1 fail, 0 cancelled, informative message); **pm2Control.test.js loses tests 4-32 — all 29 `cancelledByParent` / 'Promise resolution is still pending but the event loop has already resolved'**, including its own three new tests. So a future regression there produces no diagnosis and buries the one real signal. **This supersedes the '0 other tests cancelled' figure recorded in the worker-evidence note above — that note is incorrect on this point.**

**MINOR — the bound silently widens beyond uninstall.** startOrRestart() calls deleteAppIfPresent() before pm2.start() and save() after the health check, so PM2_DELETE_TIMEOUT/PM2_SAVE_TIMEOUT are now reachable from proxy:start and proxy:restart too. Net improvement and harmless in the renderer (nothing outside ipc.js/engine-context.js reads `error.code`, so no code-branching breaks), but the new JSDoc and pm2CallTimeoutMs comment describe these calls purely as 'reachable from uninstall.run()', which is now incomplete.

**MINOR — new partial-state surface on the error path.** uninstall.js strips the Claude Code CLI env keys BEFORE calling pm2Control.remove(), so a PM2_DELETE_TIMEOUT returns an error after those settings are already reverted, and with purge:true the config directory is kept despite the user asking to purge. Pre-existing in principle (any remove() rejection did this) but the timeout makes it materially reachable where it previously hung. Retry is safe — verified two successive retries after a timed-out delete both return `{ok:true,data:{removed:['pm2-app'],kept:[]}}` — though a successful retry omits 'claude-code-cli-config' from the summary because the keys are already gone. Cosmetic; worth a line in README's Uninstalling section (which wave-mate NCOW-51 is concurrently editing, so deliberately NOT folded into this fix pass — carried to the wave integration review instead).

**NIT** — the AC#3 test's `for (let i=0;i<10;i++) await Promise.resolve()` couples to the exact microtask depth of withLocks + pm2Control's call chain; stable in every run but the same brittleness class NCOW-47's review flagged. **NIT** — the task description's own correction #3 (calling :51/:312 'ensureConnected's own bound') is a task-text cleanup for the orchestrator; the new code comment correctly says 'ensureConnected() below was already bounded'.

### Verifications that came back CLEAN — recorded so a later wave does not redo them

**withTimeout signature-change regression probe: no regression, proven by A/B rather than reading.** Call-site census first: withTimeout()'s only pre-existing consumer is ensureConnected() (pm2Control.js:497) — **probeDaemonAlive (:51) and spawnDaemon (:312) do NOT go through it**, each owns its own raw setTimeout, so the signature change structurally cannot reach them. Then base (`git show 84bb0d0:...`) vs HEAD, side by side on ensureConnected: identical on every axis — timing (121.4ms vs 121.6ms), message, `code=undefined`, `ownKeys=["message"]`, `hasOwn(code)=false`, NCOW-22 memo clearing, and passthrough of a real pm2 error's own code. The `if (code)` guard is what makes this exact: it never stamps an own `code: undefined`, so even an `'code' in err` check would see no change (none exist; the only readers are ipc.js:416 and engine-context.js:431/439/476, all `err.code || 'UNEXPECTED'`).

**Late-callback analysis: no hazard, all four probed.** The abandoned pm2.delete callback is not cancelled, but Promise.race attaches handlers to the inner promise permanently, so a late settle is absorbed by an already-settled race. No double-settle (outer already rejected; inner resolve/reject inert); **zero unhandled rejections** even when the late callback delivers an Error carrying its own code; save() cannot be corrupted because the delete timeout aborts remove() before save() is ever called; half-deleted state is handled — a timed-out delete followed by two retries against a healthy pm2 both returned ok, **proving the locks genuinely released rather than merely that the promise settled**, and findApp()'s early return makes a late-succeeded delete idempotent. Lock release is structural, not incidental: withLocks' sharedRun IS the handler promise, so the timeout rejection settles what each lock's critical section returns.

**AC#5 confirmed more strongly than the delivered test.** The delivered test uses synchronous pm2 callbacks (microtask-length hold). The reviewer re-ran it with a fake whose connect/list/delete/dump each take a real 40ms: base and HEAD indistinguishable — identical result shape, identical ~165ms real hold, background work on all three domains strictly after uninstall:exit. NCOW-45's multi-lock hold is not shortened.

**AC#6 confirmed with a baseline cross-check**: reviewer's own `npm test` on HEAD = 421/421 pass, 0 fail, 0 cancelled; reverting all three source/test files to the merge base gives exactly 416/416, independently confirming 416 → 421 (+5) and that both test files are pure appends. Scope clean, no drive-bys, no probe artifacts leaked, commit conventions OK, nothing touches the shared pm2 daemon.

**Composite worst case is ~60s, NOT the 15s the worker's framing implies and not 30s.** delete's bound firing aborts remove(), so 15+15 is only reachable when delete succeeds slowly-but-within-bound and dump then wedges — but ensureConnected's own 30s sits in front on a first call, so the bounded worst-case three-lock (+apiKey) hold is ~60s. The reviewer judges that acceptable for this task: capped, self-clearing, and the renderer shows 'Uninstalling…' throughout, categorically different from permanent deadness. It also rules AGAINST independently tunable delete/dump bounds as unjustified complexity — no caller needs them, both RPCs are sub-second when healthy, and a second knob makes the composite harder to reason about.

**Split ruling on the unbounded-siblings scoping.** For `pm2.stop` (:625), `pm2.start` (:599) and `pm2.launchBus` (:660) the exclusion IS defensible and should become a follow-up task, not a change here — each is a different call path with its own lock story and no AC cites them. **But it is worth filing, because the same-class hazard is live there: proxy:stop and proxy:start/restart hold the proxy lock (which uninstall also needs) for the full duration with no bound at any layer, and shutdown.js bounding its OWN call to pm2Control.stop() does nothing for a Stop clicked in the UI** — so a wedged pm2.stop still kills Start/Stop/Restart and Uninstall until restart. For `pm2.list` (:523) the exclusion is NOT defensible — that is the blocking finding above.

**Overlap risk vs NCOW-51: LOW, textually zero.** This branch's only README hunk is @@ -327 (the Building-from-source npm test line); NCOW-51's are ~50+ lines away on both sides. No rebase conflict in either order. This branch touches neither src/engine/uninstall.js nor DESIGN.md. Shared surface is semantic only: NCOW-51 rewrites README's Uninstalling prose without the new bounded-failure mode.

## Wave 9 fix pass 1 (post-review-pass-1) — recorded by the orchestrator; re-review pending

Four new commits on top of `ea38690` (`cfd21c7`, `3b11f0c`, `90b44b1`, `9215910`), tip `9215910`, pushed. Orchestrator-verified numstat vs dev: src/engine/pm2Control.js +87/-14, test/engine/pm2Control.test.js +215/-0, test/main/ipc-mutex.test.js +310/-0, CLAUDE.md +1/-1, README.md +1/-1.

**BLOCKING finding fixed.** `listApps()`'s `pm2.list` callback now goes through the same `withTimeout()` helper as pm2.delete/pm2.dump, returning `PM2_LIST_TIMEOUT`. This was the call the reviewer traced as one step earlier than the calls the first pass bounded — `deleteAppIfPresent()`, `remove()` AND `getStatus()` all hit `findApp() → listApps() → pm2.list` before ever reaching pm2.delete. Worker reproduced the reviewer's probe itself, before and after:

    BEFORE — PROBE (wedged pm2.list, bound=30ms): FROZEN: STILL FROZEN after 3000ms (100x the bound)
             PROBE order: ["uninstall:enter","pm2.list called, never calls back"]
    AFTER  — PROBE (wedged pm2.list, bound=30ms): UNFROZEN: all three locks + apiKey channel proceeded
             PROBE order: [...,"claudeCode-bg","config-bg","proxy-bg","apiKey:clear"]
             uninstall result: {"ok":false,"error":{"code":"PM2_LIST_TIMEOUT","message":"pm2 list timed out after 30ms"}}

**MAJOR finding fixed — the 29-cancelled-tests problem is gone.** Added a `withSafetyTimeout()` helper (same shape as ipc-mutex.test.js's) to test/engine/pm2Control.test.js and raced EVERY NCOW-48 assertion in that file against it — including the three pre-existing hanging-delete/hanging-dump/success-path tests from the first pass — plus new pm2.list-bound tests (listApps, getStatus, remove-before-delete). Reproduction with only src/engine/pm2Control.js reverted to its pre-fix-pass (ea38690) state:

    Full suite:              # pass 421 / # fail 4 / # cancelled 0
    pm2Control.test.js alone: # pass 32 / # fail 3 / # cancelled 0
    ipc-mutex.test.js alone:  # pass 40 / # fail 1 / # cancelled 0

**Cancelled count is 0 everywhere, down from 29** — a regression now fails exactly the tests that cover it, with readable messages, instead of burying the signal. Fix restored afterwards (diffed byte-identical to pre-revert) and re-run: 425/425 pass, 0 cancelled.

**MINOR finding fixed, with the status-poller claims independently verified by the worker rather than taken on the orchestrator's word.** JSDoc/inline comments now state the bound is reachable beyond `uninstall.run()` — via proxy:start/proxy:restart (startOrRestart() calls deleteAppIfPresent() before pm2.start() and save() after the health check) and via the 5-second status poll (getStatus() → findApp() → listApps()). Verified against src/main/status-poller.js: **tick()'s setInterval fires every 5s regardless of whether the previous tick's `await pm2Control.getStatus()` settled, so a wedged pm2.list today silently accumulates one pending promise per tick forever**; after this bound getStatus() rejects once pm2CallTimeoutMs elapses and the existing `catch { onStatus({status:'errored'}) }` reports the pill as errored rather than freezing at its last value.

**Purity preserved**: both test files remain pure appends relative to dev (215/0 and 310/0, zero deletion lines), so AC#5/AC#6's 'no pre-existing test modified' still holds across the whole branch.

**npm test**: 425/425 pass, 0 fail, 0 cancelled (up from 421). CLAUDE.md:51 and README.md:330 both re-bumped to 425 — orchestrator confirmed both lines read 425 and that only the test-count line in README.md was touched, leaving the wave-mate's regions alone.

## Wave 9 review pass 2 — APPROVE (same opus reviewer, resumed for the delta; recorded by the orchestrator)

**Verdict: approve. All 6 acceptance criteria now independently confirmed (#1-#6).**

### AC#1 is genuinely met, not merely moved one hop — proven two independent ways

The reviewer explicitly refused to take this on reading, given the first pass failed by bounding some calls and leaving an earlier one.

**(a) Mechanical wedge sweep** — every pm2 member reachable from remove() wedged one at a time, bound 40ms:

    wedge=connect -> rejected code=undefined            msg='pm2 connect timed out after 40ms' (+42ms)
    wedge=list    -> rejected code=PM2_LIST_TIMEOUT     msg='pm2 list timed out after 40ms'    (+41ms)
    wedge=delete  -> rejected code=PM2_DELETE_TIMEOUT   msg='pm2 delete timed out after 40ms'  (+41ms)
    wedge=dump    -> rejected code=PM2_SAVE_TIMEOUT     msg='pm2 dump timed out after 40ms'    (+42ms)
    wedge=none    -> resolved (+0ms)

and through the real IPC handler all four release everything: `locks=released: ["claudeCode-bg","config-bg","proxy-bg","apiKey:clear"]`.

**(b) Exhaustiveness census** — a Proxy over the pm2 fake recording every member the chain actually touches, so 'nothing left unbounded' is a measurement rather than a reading claim:

    pm2 members touched by remove():    ["connect","delete","dump","list"]
    pm2 members touched by save():      ["dump"]
    pm2 members touched by getStatus(): ["list"]

All four bounded (connect by ensureConnected's pre-existing 30s). **pm2.start, pm2.stop and pm2.launchBus are provably NOT on any of these paths** — correctly out of scope, and the pass-1 follow-up recommendation for proxy:stop/proxy:start stands unchanged as a separate task.

### The cancellation cascade is fixed AND the safety-timeout polarity is correct
`withSafetyTimeout`'s timeout branch **rejects** (never resolves), and each assertion is wrapped as `withSafetyTimeout(assert.rejects(...))` / `(assert.doesNotReject(...))`, so a missing bound makes assert.rejects never settle and the safety timer fails that one test with its own message. Verified by observation, not inspection.

### Non-vacuity — the reviewer ran BOTH reverts (the worker reported only the delta one)
- **Delta revert** (pass-1 source: delete/dump bounded, list not): 425 tests, 421 pass, 4 fail, **0 cancelled** — failures 152 (listApps), 153 (getStatus), 154 (deleteAppIfPresent via remove, before pm2.delete is ever reached), 355 (ipc AC#1/#3). Each names its regression, e.g. 'getStatus() did not reject within 2000ms — this is the path status-poller.js polls every 5s'.
- **Full revert to merge-base** (no bounds at all): 425 tests, 418 pass, **7 fail, 0 cancelled** — exactly the 7 load-bearing tests, with both AC#5 control tests correctly still PASSING. **The arithmetic closes from both ends: 425-7=418, and 416 baseline + 9 new = 425.**

### getStatus impact — measured against the real poller, and the ruling on bound length
Real status-poller run (interval 50ms, wedged pm2.list, ~400ms window):

    BASE (unbounded list):    pm2.list invocations=8  getStatus settled=0  onStatus=[]
    HEAD (list bounded 60ms): pm2.list invocations=8  getStatus settled=7  onStatus=[7x "errored"]

Both worker claims hold: tick()'s setInterval fires regardless of whether the previous tick's await settled (8 invocations either way, so **ticks genuinely overlap**), pre-fix a wedged pm2.list accumulates one never-settling promise per tick forever and the pill never updates, post-fix the existing `catch { onStatus({status:'errored'}) }` fires and the accumulation stops. Rulings on the three hazards: overlapping polls are **pre-existing, not introduced**; the pile-up is **genuinely fixed, not merely slowed** (bounded steady state of ~3 in-flight at 15s/5s, each guaranteed to settle, versus unbounded monotonic growth); flapping is **real and new but recovery-only, ~3 alternations, self-clearing**.

**Ruling: the poll path should NOT get a shorter bound than 15s.** A shorter bound buys a marginally faster 'Error' label while adding a second knob and a real false-errored risk on a slow-but-alive daemon (the poller has no retry or hysteresis to absorb it), and it would only shorten the flap, not remove it. The pill is 5s-granular and advisory. If the flap is worth fixing, fix it where it lives — have status-poller drop a result from a tick older than the newest one that has already reported.

**PM2_LIST_TIMEOUT surfacing verified on all three paths**: uninstall:run (observed `{ok:false,error:{code:'PM2_LIST_TIMEOUT'}}`; uninstall-view.js:81-87 renders error.message and re-enables the button); proxy:start/restart (engine-context.js:358-369 has no try/catch, so it reaches ipc.js:416's wrapper unchanged); the 5s poll (correctly does NOT go through the IPC wrapper — status-poller's catch discards the error and emits `{status:'errored'}`, which status-pill.js maps to 'Error'). Zero unhandled rejections in every probe. The pass-1 census of `error.code` readers still holds; nothing new reads it.

### AC#5 re-verified with the list bound now in the path (real 40ms per pm2 round trip)

    BASE (no bounds):        {"ok":true,"data":{"removed":["pm2-app"],"kept":[]}}
                             uninstall:exit@165ms, then claudeCode/config/proxy-bg @165ms
    HEAD (all three bounded): identical result shape
                             uninstall:exit@163ms, then claudeCode/config/proxy-bg @163ms

Real hold unchanged, background work still strictly after uninstall:exit — **NCOW-45's multi-lock fairness guarantee intact.**

### COMPOSITE WORST CASE UPDATED: ~75s, not the ~60s accepted at pass 1 and not 15s
connect (≤30s) + list (≤15s) + delete (≤15s) + dump (≤15s), each stage slow-but-just-under-bound with the last timing out. Contrived in practice, still bounded, still self-clearing, renderer shows 'Uninstalling…' throughout. Accepted — **but recorded as ~75s so no future reader infers 15s.**

**npm test**: reviewer's own run at 9215910 — 425/425 pass, 0 fail, 0 cancelled. Both doc lines read the true count. Scope clean, 5 files, no drive-bys, no probe artifacts, conventions OK, nothing touches or kills the shared pm2 daemon.

### Residual minors — one being fixed in-branch, the rest carried to the wave integration review
- **BEING FIXED NOW (test hygiene): a vacuous assertion at test/engine/pm2Control.test.js:239.** It asserts `!pm2.calls.includes('delete')`, but hangingListPm2's delete pushes `delete:${name}` while hangingDeletePm2 (the pass-1 fixture) pushes the bare `'delete'` — **the two fixtures disagree, so the guard can never fail.** Demonstrated: `calls=['connect','list','delete:litellm-nim','dump']`, `calls.includes('delete') -> false`, `calls.some(c=>c.startsWith('delete')) -> true`. The test's load-bearing assertion (rejects with PM2_LIST_TIMEOUT) IS genuinely non-vacuous, so this is hygiene rather than a false pass of the test — but a knowingly-vacuous assertion should not ship.
- **minor (new)**: engine-context.js:367/372 can now convert a more useful error into a less useful one — `broadcast('proxy:status-changed', await pm2Control.getStatus())` runs after startOrRestart() resolves, so if startOrRestart returns the ok:false HEALTH_CHECK_TIMEOUT result (which carries outTail/errTail log tails) and pm2.list then wedges, that await rejects and the handler surfaces a bare PM2_LIST_TIMEOUT with the log tails discarded. Narrow window; pre-fix that line hung forever holding the proxy lock, so still a net improvement.
- **minor (new)**: status pill flaps for ~3 poll cycles after a wedged daemon recovers. Measured (bound 300ms, interval 100ms, recovery at 250ms): `[errored@302,running@303,errored@401,running@403,errored@502,running@502,running@604,running@704,running@805]`. At production values ~3 alternations over ~15s, then steady. Fix belongs in status-poller.js, not in a shorter bound.
- **minor (carried from pass 1, unchanged)**: uninstall.js strips the Claude Code CLI env keys BEFORE pm2Control.remove(), so any of the three timeouts returns an error after those settings are already reverted, and with purge:true the config dir is kept despite the user asking to purge. Retry is safe (re-verified: no unhandled rejections, subsequent uninstalls succeed), though a successful retry's summary omits 'claude-code-cli-config'.
- **nit (positive, worth recording)**: src/renderer/app.js:44 awaits proxy.getStatus() before rendering the pill or subscribing to status changes, so **pre-fix a wedged pm2.list hung the renderer's entire boot sequence forever**; it now recovers after the bound. Cosmetic consequence: that boot path does `if (statusResult.ok)`, so the pill reads 'Not configured' rather than 'Error' until the poller's next broadcast corrects it.
- **nit**: 'pure appends' is loose but harmless — zero deletions vs the merge base in both test files, though pm2Control.test.js's insertion point is line 69 (mid-file) rather than EOF. No pre-existing test line is touched; the delta's deletions are the fix pass rewriting its OWN pass-1 lines.

## Wave 9 hygiene fix (post-approval, reviewer-prescribed) — recorded by the orchestrator

Commit `2c0ec4f` on top of `9215910`. One file, 3 insertions / 3 deletions, test-only.

**Root cause closed, not just the symptom.** The worker found the two hanging fixtures disagreed on how they recorded a delete call: `hangingListPm2` recorded `delete:${name}` (matching `fakePm2`) while `hangingDeletePm2` alone recorded the bare `'delete'`. Rather than only rewriting the call-site assertion, it **made all three fixtures agree** on `delete:${name}`, so the next person copying a fixture cannot reinherit the bug — then applied the reviewer's suggested assertion form (`!pm2.calls.some((c) => c.startsWith('delete'))`), which now works against any fixture.

**Vacuity reproduced before fixing**: `pm2.calls = ["connect","list"]` from hangingListPm2 (the fixture the affected test actually uses). Injecting a simulated `'delete:litellm-nim'` entry and re-running with the OLD assertion still passed (`ok 6`) — confirming the guard could never fail.

**Non-vacuity of the FIXED assertion proven the same way**: with the injected entry, the new form fails as intended — `not ok 6`, 'pm2.delete must never be reached while pm2.list is still wedged ahead of it', `expected: true, actual: false`. Injection and the swapped-in old assertion were both removed afterwards.

**Purity re-verified by the orchestrator against the merge base**: `git diff 84bb0d0...HEAD --numstat` gives `215/0` for test/engine/pm2Control.test.js and `310/0` for test/main/ipc-mutex.test.js — **zero deletions relative to merge base in either file**, so this commit's 3 deletions are all against lines this branch itself introduced. AC#5/AC#6's 'no pre-existing test modified' still holds.

**npm test**: 425/425 pass, unchanged — no test added or removed, so CLAUDE.md:51 and README.md:330 remain correct at 425 and were deliberately not touched.

## Hygiene-fix confirmation — APPROVE STANDS at `2c0ec4f` (same reviewer, narrow re-check)

1. **No weakening from the fixture change.** `hangingDeletePm2` has exactly ONE consumer — the hanging-delete test at :243 — and that test asserts only `rejects` with `/pm2 delete timed out/` + PM2_DELETE_TIMEOUT; **it never inspects `calls`**. The `calls.includes('delete:litellm-nim')` assertions at :62 and :280 belong to `fakePm2`, which already used that format and is untouched. The format change is therefore unobservable to every test that consumes it, and the fixture set is now internally consistent (fakePm2 / hangingListPm2 / hangingDeletePm2 all record `delete:${name}`).
2. **Non-vacuity re-proven by the reviewer's OWN injection**, not the worker's: making `hangingListPm2.list` also push `'delete:litellm-nim'` gives `not ok 6 … expected: true, actual: false`, 35 tests / 34 pass / 1 fail / 0 cancelled. Worktree restored clean.
3. **approve stands. All six ACs remain confirmed.** npm test 425/425, 0 fail, 0 cancelled; both doc lines still read the true count. Nothing in the delta touches source, the AC#5 success-path tests, or their assertions. The pass-2 residual minors (recovery flap, engine-context.js:367 log-tail loss, uninstall partial-state docs) are unchanged and non-blocking.
<!-- SECTION:NOTES:END -->
