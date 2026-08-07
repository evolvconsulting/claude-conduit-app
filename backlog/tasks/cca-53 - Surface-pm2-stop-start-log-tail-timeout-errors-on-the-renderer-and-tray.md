---
id: CCA-53
title: Surface pm2 stop/start/log-tail timeout errors on the renderer and tray
status: Done
assignee: []
created_date: '2026-08-05 22:02'
updated_date: '2026-08-06 16:46'
labels: []
dependencies:
  - CCA-52
ordinal: 66000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
CCA-52 bounded pm2Control.stop()/startOrRestart()/startLogTail() with timeouts (PM2_STOP_TIMEOUT/PM2_START_TIMEOUT/PM2_LOG_TAIL_TIMEOUT), verified correct at the IPC boundary by two independent review passes. But neither review pass followed the result past ipc.js to its actual user-facing surfaces, and the wave-10 integration review found both surfaces silently discard it. src/renderer/views/dashboard-view.js:68-69 does bare `await nimProxy.proxy.stop();` with the result discarded entirely — contrast its immediate neighbours #start-btn (:65-67) and #restart-btn (:71-74), which both do `const r = await ...; if (!r.ok) toast(...)`. The status pill never corrects either, since engine-context.js broadcasts proxy:status-changed only after the throwing await. startLogTailIfNeeded() (dashboard-view.js:99-117) has the same shape: sets logTailStarted=true at :101 BEFORE the await, discards the result at :117, and never resets the flag on failure, so a timeout leaves the log pane silently stuck at seeded content with no error and no retry until the view unmounts. Tray Stop (tray.js:130, `onStop: () => mutexes.proxy.run(() => handlers.proxy.stop())`) has no error surface at all — mutex.js:53 deliberately does `chain = run.catch(() => {})` so the rejection is absorbed with not even an unhandled-rejection log. Net effect: a wedged Stop is now a silently dead button for 15s and then forever, with zero diagnostic trail anywhere in the app — worse in one respect than the pre-CCA-52 behavior (which froze the whole app, which was at least obvious something was wrong).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A wedged proxy:stop surfaces a visible error to the user on the renderer Stop button, matching the existing pattern used by #start-btn/#restart-btn (result checked, toast or equivalent shown on !ok)
- [x] #2 A wedged proxy:stop issued via the tray Stop menu item surfaces some diagnostic trail (at minimum a console.warn/error) rather than being silently absorbed by mutex.js catch — decide and document the mechanism
- [x] #3 A wedged proxy:startLogTail surfaces a visible error on the renderer and resets logTailStarted so a retry is possible, rather than leaving the log pane silently stuck with no error and no way to retry until unmount
- [x] #4 A test demonstrates each of the three surfaces above actually shows/logs the error for a genuinely wedged call, and fails against current merged source (non-vacuity reproduced and reported)
- [x] #5 Normal (non-wedged) Stop/Start/Restart/log-tail behavior on all three surfaces is unchanged
- [x] #6 All pre-existing tests continue to pass unmodified and npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Re-read dashboard-view.js, tray.js, mutex.js fresh in the worktree.
2. AC#1: dashboard-view.js's #stop-btn handler captures the result and toasts on !ok, matching #start-btn/#restart-btn.
3. AC#3: startLogTailIfNeeded() captures startLogTail()'s result; on !ok resets logTailStarted=false, toasts, and returns before subscribing onLogLine.
4. AC#2: implemented at the tray.js call site (not inside mutex.js) — .catch(err => console.error(...)) appended to onStop's mutexes.proxy.run(...) call. mutex.js left byte-for-byte untouched.
5. Added tests for all three surfaces (empirically confirmed non-vacuous via git stash of pre-fix source), ran full suite, updated CLAUDE.md/README.md test counts, committed in 3 logical commits, pushed.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented on fix/CCA-53-surface-timeout-errors (b7bfc14..872b622, 3 commits), pushed.

AC#1: dashboard-view.js #stop-btn now `const r = await nimProxy.proxy.stop(); if (!r.ok) toast('Stop failed: ...')` — matches #start-btn/#restart-btn exactly.
AC#2: tray.js onStop wraps mutexes.proxy.run(() => handlers.proxy.stop()) in .catch(err => console.error('[tray] Stop failed:', err?.code, err?.message)). mutex.js:53 confirmed byte-identical to baseline (untouched) — the swallowed `chain` variable is internal sequencing state only; the `run` promise handed back to the caller was already unswallowed, so the fix needed no mutex.js change and ipc.js:118/155's literal quotations of mutex.js:53 remain accurate.
AC#3: startLogTailIfNeeded() captures startLogTail()'s result; on !ok resets logTailStarted=false, toasts, returns before subscribing onLogLine (enables retry).
AC#4 (non-vacuity): each new test independently confirmed to fail against pre-fix source via git stash/revert/restore of the exact file, then stash pop to restore the fix — reported exact failure messages for all 3 surfaces (assertion text for AC#1/#3's static source checks; a genuine unhandled rejection for AC#2's pre-fix tray onStop).
AC#5/#6: npm test 457 -> 461 (4 new tests: 2 dashboard-view.test.js, 2 tray-actions.test.js), all 457 pre-existing tests pass unmodified, full suite green. CLAUDE.md/README.md test counts updated to 461.

mutex.js decision: tray.js call site (per dispatch recommendation), not mutex.js-level — mutex.js diff vs baseline is empty.

Scope note from worker: tray Start/Restart have the same latent silent-absorption gap as Stop did, but out of scope per AC#2's literal wording (Stop only) — flagging for a possible future task, not touched here.

CORRECTION (wave-13 integration review): the evidence claim above — "a genuine unhandled rejection for AC#2's pre-fix tray onStop" — is not accurate. The integration reviewer reconstructed the pre-fix onStop and ran the new test's exact body against it with an unhandledRejection listener installed: it failed at assert.doesNotReject() with AssertionError ("Got unwanted rejection"), not as an actual unhandled rejection — assert.doesNotReject() awaits and handles the rejection itself. The underlying AC#2 fix and its non-vacuity are still sound (the pre-fix code does genuinely reject, which is what the assertion correctly catches); only this task record's characterization of the observed failure mode was wrong. See the wave-13 integration review and the CCA-53 cleanup PR for the corrected comment text.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Surfaced all 3 previously-silent pm2 timeout paths: the renderer's #stop-btn now checks the
result and toasts on !ok (matching #start-btn/#restart-btn); startLogTailIfNeeded() resets
logTailStarted and toasts on failure instead of leaving the log pane permanently stuck; the
tray's Stop menu item now .catch()s the mutex-guarded call and logs a diagnostic, at the
tray.js call site rather than inside mutex.js (mutex.js confirmed byte-for-byte untouched by
two independent reviewers). 4 new tests added (npm test 457 -> 461), each independently
confirmed non-vacuous (fails against reverted pre-fix source) by both the worker and the
task-level reviewer. Merged as PR #56 (f20eb5d).

A wave-level integration review then found several of CCA-53's own new comments/test-comments
contained factually inaccurate claims about pre-fix behavior (this campaign's recurring
"correction introduces a false claim" pattern, here appearing in the original PR itself) —
fixed via a comment-only cleanup pass (PR #57, 9245a9d), each corrected claim independently
reproduced by that PR's reviewer (including a real-Electron probe for the highest-risk claim).
A related task-record evidence error (a claimed "unhandled rejection" that was actually a
caught AssertionError) was also corrected on this task's own notes.

Follow-up CCA-55 filed (user-approved) for giving the tray a real user-visible error surface
for Start/Stop/Restart, since console.error alone is invisible in a packaged build and
Start/Restart were never in this task's AC scope.

Final npm test on merged dev: 461/461.
<!-- SECTION:FINAL_SUMMARY:END -->
