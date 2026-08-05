---
id: NCOW-52
title: >-
  Bound the remaining unbounded pm2 callbacks in pm2Control: stop, start and
  launchBus
status: In Progress
assignee: []
created_date: '2026-08-05 18:39'
updated_date: '2026-08-05 21:40'
labels:
  - concurrency
dependencies:
  - NCOW-48
ordinal: 65000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by the wave-9 integration review of NCOW-48, and recommended as a follow-up by both of the NCOW-48 review passes (the recommendation was never filed at the time, so it survived only in task notes that are now history). NCOW-48 bounded three raw pm2 callbacks reachable from the uninstall path — pm2.list, pm2.delete and pm2.dump — via the existing withTimeout helper. The same hazard class is still fully live one door down: pm2Control.stop() wraps a raw unbounded pm2.stop callback (src/engine/pm2Control.js:653-658), and pm2.start (:628) and pm2.launchBus (:685) are likewise unbounded. The consequence is the same shape NCOW-48 just fixed: the proxy:stop IPC domain holds mutexes.proxy for the whole duration of the call, and uninstall aliases that same lock, so a wedged pm2.stop clicked in the UI freezes Start/Stop/Restart AND Uninstall AND update:install indefinitely until the app is restarted. Important nuance, because it is the thing that makes this look already-handled when it is not: src/main/shutdown.js does bound its OWN call to pm2Control.stop(), which is why a wedged pm2 cannot make the app unquittable (CLAUDE.md records that principle) — but that bound lives at the shutdown call site, not inside pm2Control, so it does nothing whatsoever for a Stop button pressed in the running UI. The integration reviewer verified all three call sites against merged source and confirmed via a Proxy-based census that pm2.start, pm2.stop and pm2.launchBus are provably NOT on the remove()/save()/getStatus() paths NCOW-48 covered, which is exactly why NCOW-48 correctly left them out of scope. NCOW-48 is the precedent to follow rather than a design to reinvent: the withTimeout helper already takes an optional error code, and ipc.js turns that code into an ok:false result for the renderer. Note also that launchBus is a different shape from the other two (it yields an event bus rather than completing an operation), so whether a timeout is even the right primitive there is part of the judgment this task owns rather than a settled requirement.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 pm2Control.stop() is bounded by a timeout following the NCOW-48 precedent (the existing withTimeout helper and the shared pm2CallTimeoutMs knob) rather than a newly invented mechanism
- [ ] #2 A timeout on stop surfaces as a normal handler error reaching the renderer as an ok:false result with a distinct code, consistent with PM2_LIST_TIMEOUT / PM2_DELETE_TIMEOUT / PM2_SAVE_TIMEOUT
- [ ] #3 A test demonstrates that a pm2.stop call which never invokes its callback no longer holds the proxy lock indefinitely: after the bound elapses, work queued on the proxy domain proceeds, and an uninstall issued afterwards is no longer blocked
- [ ] #4 The test genuinely fails against unpatched source (non-vacuity reproduced and reported) and cannot itself hang or cancel other tests if the bound regresses — race each assertion against a real-clock safety timeout, as NCOW-48 does after its own review found 29 cancelled tests
- [ ] #5 pm2.start is bounded on the same terms, or its exclusion is explicitly justified in writing against the actual call path rather than left silent
- [ ] #6 pm2.launchBus is either bounded, or an explicit reasoned decision is recorded that a timeout is the wrong primitive for an event-bus handle, naming what it would break
- [ ] #7 The success paths of stop/start are unchanged: a normal Stop, Start and Restart still complete with the same result shape and still hold the proxy lock for their real duration, preserving the multi-lock fairness NCOW-45 established
- [ ] #8 The shutdown.js quit path behaviour is confirmed unchanged, since it already applies its own outer bound around the same call
- [ ] #9 Comments and JSDoc name every call site that can now raise the new codes, following the correction NCOW-48 needed when its own bound turned out to also cover proxy:start/restart and the 5-second status poll
- [ ] #10 All pre-existing tests continue to pass unmodified and npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Census every raw pm2.* callback in src/engine/pm2Control.js (pm2.connect/disconnect/list/delete/dump already bounded by NCOW-22/NCOW-48; pm2.start, pm2.stop, pm2.launchBus unbounded).
2. Bound stop() and startOrRestart()'s pm2.start via the existing withTimeout() + pm2CallTimeoutMs, following NCOW-48's precedent exactly: PM2_STOP_TIMEOUT, PM2_START_TIMEOUT.
3. Bound startLogTail()'s pm2.launchBus with a manual timeout rather than plain withTimeout(), because a late-arriving callback there hands back a live bus handle that must be closed on timeout to avoid leaking an open pm2 pub-socket connection: PM2_LOG_TAIL_TIMEOUT.
4. Verify ipc.js needs no change for AC#2 (its generic handler wrapper already turns err.code into {ok:false, error:{code, message}}).
5. Add unit coverage in test/engine/pm2Control.test.js, an IPC-level demonstration in test/main/ipc-mutex.test.js (AC#3), and an integration test in test/main/shutdown.test.js (AC#8) proving the pre-existing outer shutdown bound still wins the race.
6. Non-vacuity: reproduce all three call sites hanging against unpatched source with a wedged pm2 fake (real-clock bounded reproduction, no cancelled tests), then confirm they reject promptly with the fix.
7. Document every call site that can now raise the new codes; bump the two live test-count references.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented and pushed to fix/NCOW-52-bound-pm2-stop-start-launchbus (commits 7ceffb4, 0909ede, 1132332, e8c4479, 6f16692). All three named call sites bounded: pm2Control.stop() -> PM2_STOP_TIMEOUT, startOrRestart()'s pm2.start -> PM2_START_TIMEOUT, startLogTail()'s pm2.launchBus -> PM2_LOG_TAIL_TIMEOUT (a manual timeout, not plain withTimeout(), because a late callback there yields a live bus handle that must be explicitly closed on timeout or it leaks an open pm2 pub-socket connection).

Call-chain census (AC#4): every raw pm2.* callback in pm2Control.js is now accounted for -- connect (NCOW-22), list/delete/dump (NCOW-48), start/stop/launchBus (this task); disconnect is synchronous with no callback. Traced each public method's full chain end to end; nothing unbounded remains reachable from stop()/startOrRestart()/startLogTail().

Non-vacuity (AC#3/#4): stashing only the source fix and running the new tests produced exactly 5 failures (4 in pm2Control.test.js, 1 in ipc-mutex.test.js's AC#3 wedge test), 0 cancelled, each a clean real-clock-bounded 'did not reject/settle' failure rather than a hang -- confirms tests genuinely fail against unpatched source and a future regression fails fast rather than wedging CI (the NCOW-48 '29 cancelled tests' lesson applied here from the start rather than found on review).

AC#5/#6: both pm2.start and pm2.launchBus bounded (not excluded) -- same hazard shape NCOW-48 already fixed elsewhere in this file; launchBus needed the extra close-on-late-callback handling, covered by a dedicated test.

AC#7/#8: added explicit success-path tests (tight timeout, genuine success still completes) for stop/start/launchBus and for proxy:stop at the IPC level; added a shutdown.test.js integration test combining a wedged pm2.stop with the real outer shutdown bound, confirming the pre-existing quit-path bound still wins the race and its result/timing are unchanged.

npm test: 425 -> 435 passing, 0 failing, 0 cancelled (run twice for stability). Files touched: src/engine/pm2Control.js, test/engine/pm2Control.test.js, test/main/ipc-mutex.test.js (append-only), test/main/shutdown.test.js, CLAUDE.md, README.md (test-count bump). Confirmed untouched: pm2.list/delete/dump, engine-context.js, mutex.js, and no pre-existing ipc-mutex.test.js content modified.

Session note: worker was interrupted mid-task by an account weekly API-limit error right before its final census grep; resumed from its own transcript, verified via git status/diff that the worktree was exactly as left, and continued to completion with no lost work.

REVIEW PASS 1 (opus) — request_changes. All 10 ACs independently confirmed (mechanism matches NCOW-48 precedent exactly; own call-chain census over pm2Control.js's 8 pm2.* call sites found nothing unbounded; reproduced AC#4's non-vacuity personally -- reverting only the source fix produces exactly 5 failing / 0 cancelled, confirmed the worker's claim true; specifically mutation-tested the launchBus leak-on-late-callback branch in isolation and confirmed it is non-vacuous; verified AC#6's close-the-bus reasoning against pm2/pm2-axon's actual socket-close semantics -- safe, non-throwing, idempotent; verified AC#8's outer-bound-wins-the-race timing and AC#9's named call sites; confirmed test/main/ipc-mutex.test.js is a single append-only hunk with zero collision risk against NCOW-49/NCOW-50's future scope).

BLOCKING FINDING (the only one, non-AC): test/main/shutdown.test.js's new AC#8 test uses pm2CallTimeoutMs:10_000 for its wedged pm2.stop. Because the inner withTimeout's setTimeout is only cleared when it fires (not when the outer 50ms shutdown bound settles first), node's test runner waits out the full 10s before that file can finish -- reviewer measured 137ms on dev's 9 tests vs 10,143ms on this branch's 10 tests (74x), even though the AC#8 test's own recorded duration is 50.4ms. Full suite: 8042ms -> 10371ms. Reviewer verified a fix: pm2CallTimeoutMs:1_000 AND the assertion threshold lowered from elapsed<2000 to elapsed<300 together (moving only the timeout without moving the threshold would make the test vacuous against a regression) -- confirmed both changed together drops the file to 1145ms with real margin on both sides (~50ms pass-side observed, 3.3x fail-side margin).

Non-blocking, recorded for the record (not required for this task's own fix pass): (a) pm2's own launchBus reads self.sub at callback time rather than a captured local, so a >15s wedge followed by a retry followed by a late first-attempt callback could close the wrong (live) bus -- narrow, upstream pm2 behavior, strictly better than the pre-fix indefinite lock hold, not worth fixing here; (b) DESIGN.md's pm2-timeout census (:397-409, :621-624) still only names PM2_LIST/DELETE/SAVE_TIMEOUT, now missing 3 more codes -- matches NCOW-48's own precedent of leaving this to the wave-level integration review rather than the fix branch.
<!-- SECTION:NOTES:END -->
