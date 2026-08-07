---
id: CCA-54
title: Fix pm2Control.startLogTail's timeout handler closing a later retry's live bus
status: Done
assignee: []
created_date: '2026-08-05 22:02'
updated_date: '2026-08-06 00:14'
labels: []
dependencies:
  - CCA-52
ordinal: 67000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
CCA-52 bounded pm2.launchBus with a manual timeout that, on a late-arriving callback, calls bus.close() to avoid leaking an open pm2 pub-socket connection. The wave-10 integration review found this leak fix can itself close the WRONG bus. pm2's own Client.launchBus (node_modules/pm2/lib/Client.js:434-442) stores the socket on a shared mutable slot, `this.sub`, and reads `self.sub`/`self.sub_sock` at callback-fire time rather than from a value captured when the call was made. Reproduced empirically: call #1 wedges and times out (PM2_LOG_TAIL_TIMEOUT); a retry, call #2, succeeds and reassigns client.sub to a new socket; call #1's callback then fires late, and pm2Control.js runs bus.close() on whatever client.sub currently is — socket #2, the bus call #2 is actively using — killing a healthy, in-use log tail while the actually-stale socket #1 leaks anyway (nobody closes it). This is genuinely reachable through the shipped UI, not just a contrived unit-test shape: src/renderer/views/dashboard-view.js resets logTailStarted on unmount, so navigating off the Dashboard view and back re-issues proxy:startLogTail, which is exactly the retry-after-timeout sequence needed to trigger it. After this happens, engine-context.js's logTailUnsubscribe is left non-null, so startLogTail returns {ok:true} early on every subsequent call even though the log tail is actually dead. This is a defect CCA-52 itself introduced (the pre-fix code had no close-on-timeout behavior at all, so this failure mode did not previously exist) — distinct from Task CCA-53's error-surfacing gap, since here even a caller that DID check the result would see a false {ok:true}.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The late-arriving callback from a timed-out pm2.launchBus call can no longer close a subsequent, currently-live retry's bus — via a generation counter, an identity check against the bus/socket that was actually returned to the caller, or an equivalently reasoned mechanism
- [x] #2 A test reproduces the exact sequence (call #1 wedges and times out, call #2 retries and succeeds, call #1's callback fires late) and demonstrates the live bus from call #2 survives — failing against current merged source (non-vacuity reproduced and reported)
- [x] #3 The original leak concern CCA-52's fix existed for is still addressed: a late callback whose bus is genuinely stale (no subsequent retry) still gets closed rather than leaked
- [x] #4 engine-context.js's logTailUnsubscribe state is confirmed correct after this fix — a call that returns {ok:true} means the log tail is actually live, not just that a stale unsubscribe handle was set
- [x] #5 Normal (non-wedged, non-retried) startLogTail behavior is unchanged
- [x] #6 All pre-existing tests continue to pass unmodified and npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Root-cause: pm2's real Client.prototype.launchBus (node_modules/pm2/lib/Client.js:434-442) stores the socket on a shared mutable slot (this.sub) and reads it at callback-fire time, so a late callback from a timed-out call #1 can be handed the exact same bus object a subsequent retry (call #2) already resolved with and is actively using.
2. Fix contained entirely inside pm2Control.js (no engine-context.js changes needed): add a closure-scoped activeLogTailBus variable, set to the bus a call actually resolves with, cleared by that call's own unsubscribe closure only if it still points at that bus.
3. Late-callback branch closes a late-arriving bus only when bus !== activeLogTailBus -- an identity check against the bus actually returned to a caller (one of the two mechanisms AC#1 names), rather than a generation counter.
4. Add a fake pm2 launchBus stub that faithfully models the real shared-slot bug (overwrites one shared slot on every launchBus() call, lets a queued callback be fired manually) to reproduce call #1 wedge+timeout -> call #2 retry+success -> call #1 late-fire, and assert call #2's bus is never closed and keeps delivering lines.
5. Verify non-vacuity by stashing only the pm2Control.js fix and confirming the new test fails against pre-fix source, then restoring and confirming it passes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented on fix/CCA-54-startlogtail-retry-bus-close, commit 0356d49, pushed to origin. Test counts: 435/435 before, 436/436 after (435 pre-existing unmodified + 1 new). Non-vacuity confirmed via git stash: with only src/engine/pm2Control.js's fix stashed (new test kept), the new test fails with "call #1's late callback must not close call #2's live bus (expected true, actual false)" -- reproduces the defect against pre-fix source; restoring the fix makes it pass.

AC-by-AC: #1 identity check against activeLogTailBus (closure-scoped, set to the bus actually returned to a caller) implemented -- late callback closes only when bus !== activeLogTailBus. #2 new test sharedSlotLaunchBusPm2 fake models pm2's real shared-slot bug and reproduces the exact call#1-wedge/call#2-retry/call#1-late-fire sequence; call #2's bus is never closed and keeps delivering lines afterward -- non-vacuity reproduced above. #3 pre-existing single-call late-close test (~line 472) passes unmodified -- activeLogTailBus stays null with no retry, so the genuinely stale bus still gets closed (leak concern still addressed). #4 confirmed by inspection of engine-context.js:391-395 -- logTailUnsubscribe is only ever assigned from a resolved startLogTail() call, and the handler's own guard prevents a second concurrent call; with the fix a resolved call's bus can no longer be silently killed, so {ok:true} now reliably means the tail is live. No engine-context.js edits were made or needed. #5 pre-existing success-path test (~line 511) passes unmodified. #6 full npm test run 436/436 green.

Files touched: src/engine/pm2Control.js, test/engine/pm2Control.test.js. Confirmed disjoint from CCA-50's footprint. No injected/suspicious instructions encountered this session (worked in treehouse slot 2, previously flagged in early campaign waves, clean since wave 5).

Reviewer verdict: APPROVE (opus, first pass). All 6 ACs independently confirmed with the reviewer's own evidence, not the implementer's claims.

Independently reproduced non-vacuity (not via the implementer's git-stash method, which shared a stash ref with the concurrent CCA-50 worktree -- flagged as a process hazard for future waves, not a defect): extracted the pm2Control.js diff as a patch, git apply -R'd it while keeping the new test intact, confirmed 42 pass / 1 fail with the exact expected failure message, restored and confirmed byte-identical via cmp. Test counts independently run: 435/435 at merge-base ea13bea, 436/436 with the fix, re-run 5x on the single file with zero flakiness.

Verified the real pm2 premise directly against node_modules/pm2/lib/Client.js:434-442 and API.js:259-260 -- the shared-mutable-slot bug is real, not assumed. Probed 9 edge cases beyond the delivered test with an independently-written shared-slot fake: overlapping 3-call sequences, unsubscribe-before-late-callback ordering, older-bus-unsubscribe not clobbering a newer bus's slot protection, and non-shared-slot pm2 semantics -- the identity-check fix holds correctly under all of them, including confirming AC#3 (genuine leak-close) does not go inert under overlap. Audited assignment ordering in the source directly: activeLogTailBus is set synchronously only on the success path, never on rejection, no interleaving window.

AC#4 verified by reading engine-context.js:391-395 and ipc.js:420-426 directly (not accepting the implementer's claim) -- confirmed logTailUnsubscribe only assigns on success, startLogTail holds mutexes.proxy (not in UNSERIALIZED_METHODS), so overlap is strictly sequential timeout-then-retry. No engine-context.js change needed; claim holds.

Non-blocking findings recorded, none require action: (1) a late bus can still be double-closed in some overlapping-timeout sequences, but this is unchanged from CCA-52 (the fix only reduces close() calls, never regresses) and every relevant close is try/catch-guarded; (2) pm2's own leak of the first stale socket is structurally unfixable from the app side (pm2 overwrites its own shared slot before the app ever sees the second reference) -- unchanged from CCA-52, not a new defect; (3) logTailUnsubscribe can still go stale for reasons entirely outside this fix (daemon death, socket error) -- pre-existing, broader than this task's own AC#4 wording, worth a separate note if the campaign wants genuine liveness rather than freedom from this specific defect; (4) commit trailer conventions consistent with project practice.

Scope confirmed: diff touches only src/engine/pm2Control.js (+37/-5) and test/engine/pm2Control.test.js (+144, zero deletions -- pure append, no pre-existing test modified). Confirmed zero overlap with CCA-50's concurrent worktree (engine-context.js/ipc.js/mutex.js/ipc-mutex.test.js untouched).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed a defect CCA-52 itself introduced: pm2Control.js's startLogTail() bounded pm2.launchBus with a manual timeout whose late-callback close-on-timeout branch read pm2's own shared-mutable Client.sub slot at callback-fire time rather than a captured per-call value, so a timed-out call's late callback could close a SUBSEQUENT retry's currently-live bus -- killing a healthy log tail while the actually-stale socket leaked anyway. Genuinely reachable through the shipped UI (dashboard-view.js's navigate-away/back unmount cycle re-issues proxy:startLogTail, exactly the retry-after-timeout sequence).

Fix: a closure-scoped activeLogTailBus variable, set to the bus a call actually resolves with and cleared by that call's own unsubscribe closure only if it still points at that bus; the late-callback branch now closes a late-arriving bus only when it's identity-distinct from activeLogTailBus. Contained entirely inside pm2Control.js, no engine-context.js changes needed.

Approved on the first review pass (opus). All 6 ACs independently confirmed -- the reviewer reproduced non-vacuity itself (git apply -R on just the production diff, not the implementer's stash method) and probed 9 further edge cases with an independently-written shared-slot fake (3-way overlapping calls, unsubscribe-before-late-callback ordering, older-bus-unsubscribe not clobbering a newer bus's slot protection, non-shared-slot pm2 semantics) -- all correct, and confirmed the original leak concern (AC#3) still holds under overlap. npm test 435 -> 436, merged as PR #52 (320a8ca).
<!-- SECTION:FINAL_SUMMARY:END -->
