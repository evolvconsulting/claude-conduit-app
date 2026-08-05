---
id: NCOW-54
title: Fix pm2Control.startLogTail's timeout handler closing a later retry's live bus
status: In Progress
assignee: []
created_date: '2026-08-05 22:02'
updated_date: '2026-08-05 23:03'
labels: []
dependencies:
  - NCOW-52
ordinal: 67000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-52 bounded pm2.launchBus with a manual timeout that, on a late-arriving callback, calls bus.close() to avoid leaking an open pm2 pub-socket connection. The wave-10 integration review found this leak fix can itself close the WRONG bus. pm2's own Client.launchBus (node_modules/pm2/lib/Client.js:434-442) stores the socket on a shared mutable slot, `this.sub`, and reads `self.sub`/`self.sub_sock` at callback-fire time rather than from a value captured when the call was made. Reproduced empirically: call #1 wedges and times out (PM2_LOG_TAIL_TIMEOUT); a retry, call #2, succeeds and reassigns client.sub to a new socket; call #1's callback then fires late, and pm2Control.js runs bus.close() on whatever client.sub currently is — socket #2, the bus call #2 is actively using — killing a healthy, in-use log tail while the actually-stale socket #1 leaks anyway (nobody closes it). This is genuinely reachable through the shipped UI, not just a contrived unit-test shape: src/renderer/views/dashboard-view.js resets logTailStarted on unmount, so navigating off the Dashboard view and back re-issues proxy:startLogTail, which is exactly the retry-after-timeout sequence needed to trigger it. After this happens, engine-context.js's logTailUnsubscribe is left non-null, so startLogTail returns {ok:true} early on every subsequent call even though the log tail is actually dead. This is a defect NCOW-52 itself introduced (the pre-fix code had no close-on-timeout behavior at all, so this failure mode did not previously exist) — distinct from Task NCOW-53's error-surfacing gap, since here even a caller that DID check the result would see a false {ok:true}.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The late-arriving callback from a timed-out pm2.launchBus call can no longer close a subsequent, currently-live retry's bus — via a generation counter, an identity check against the bus/socket that was actually returned to the caller, or an equivalently reasoned mechanism
- [ ] #2 A test reproduces the exact sequence (call #1 wedges and times out, call #2 retries and succeeds, call #1's callback fires late) and demonstrates the live bus from call #2 survives — failing against current merged source (non-vacuity reproduced and reported)
- [ ] #3 The original leak concern NCOW-52's fix existed for is still addressed: a late callback whose bus is genuinely stale (no subsequent retry) still gets closed rather than leaked
- [ ] #4 engine-context.js's logTailUnsubscribe state is confirmed correct after this fix — a call that returns {ok:true} means the log tail is actually live, not just that a stale unsubscribe handle was set
- [ ] #5 Normal (non-wedged, non-retried) startLogTail behavior is unchanged
- [ ] #6 All pre-existing tests continue to pass unmodified and npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Root-cause: pm2's real Client.prototype.launchBus (node_modules/pm2/lib/Client.js:434-442) stores the socket on a shared mutable slot (this.sub) and reads it at callback-fire time, so a late callback from a timed-out call #1 can be handed the exact same bus object a subsequent retry (call #2) already resolved with and is actively using.
2. Fix contained entirely inside pm2Control.js (no engine-context.js changes needed): add a closure-scoped activeLogTailBus variable, set to the bus a call actually resolves with, cleared by that call's own unsubscribe closure only if it still points at that bus.
3. Late-callback branch closes a late-arriving bus only when bus !== activeLogTailBus -- an identity check against the bus actually returned to a caller (one of the two mechanisms AC#1 names), rather than a generation counter.
4. Add a fake pm2 launchBus stub that faithfully models the real shared-slot bug (overwrites one shared slot on every launchBus() call, lets a queued callback be fired manually) to reproduce call #1 wedge+timeout -> call #2 retry+success -> call #1 late-fire, and assert call #2's bus is never closed and keeps delivering lines.
5. Verify non-vacuity by stashing only the pm2Control.js fix and confirming the new test fails against pre-fix source, then restoring and confirming it passes.
<!-- SECTION:PLAN:END -->
