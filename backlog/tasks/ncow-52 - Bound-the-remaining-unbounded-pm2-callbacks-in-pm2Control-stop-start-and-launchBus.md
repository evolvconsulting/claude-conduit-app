---
id: NCOW-52
title: >-
  Bound the remaining unbounded pm2 callbacks in pm2Control: stop, start and
  launchBus
status: To Do
assignee: []
created_date: '2026-08-05 18:39'
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
