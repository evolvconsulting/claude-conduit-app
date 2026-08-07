---
id: NCOW-59
title: >-
  Contain a throwing Notification.isSupported() so tray actions cannot reject or
  double-log
status: In Progress
assignee: []
created_date: '2026-08-07 02:23'
updated_date: '2026-08-07 13:53'
labels: []
dependencies:
  - NCOW-56
ordinal: 72000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-56's wave-15 integration review surfaced a defect in `src/main/tray.js`'s notification path that three separate review passes agreed was real but out of NCOW-56's own acceptance-criteria scope, so it was deliberately deferred rather than fixed silently.

`notifyFailure()` calls `Notification.isSupported()` in its guard clause, OUTSIDE its own `try` block. If that call throws, the throw escapes `notifyFailure()` and lands in `runAction()`'s trailing `.catch()`. Three consequences, all reproduced by a reviewer with a fake whose `isSupported()` throws: a SECOND `console.error` line is emitted, misattributed as though the tray action itself had failed (e.g. `[tray] Start failed:  boom from isSupported`) when the action may in fact have succeeded; the returned promise REJECTS, contradicting this module's own JSDoc contract that "none of the three ever reject"; and the intended notification is never shown.

Important scoping facts, all independently verified across three review passes:
- The class is PRE-EXISTING, not introduced by NCOW-56 — the pre-NCOW-56 code rejects identically under the same throwing fake, because the `.catch()` limb that produces the behavior is unchanged.
- It is realistically unreachable with Electron's real `Notification`, whose `isSupported()` does not throw.
- NCOW-56 DID add a second entry point into it: a resolved `{ok:false}` result now also reaches `notifyFailure()` via the new `.then()` limb, on a path whose throw lands in that same `.catch()`.

The likely fix is small — move the `isSupported()` check inside `notifyFailure()`'s existing `try`, so notification plumbing failures are contained exactly as the surrounding comment already claims they are. The task is worth filing because the module documents a contract it does not actually hold under this input, and the fix should come with a test rather than being folded silently into unrelated work.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 notifyFailure()'s Notification.isSupported() call can no longer let a throw escape into runAction()'s .catch()
- [ ] #2 A throwing isSupported() produces exactly one console.error attributable to the real cause, not a second misattributed '<action> failed' line
- [ ] #3 createTrayActions()'s returned onStart/onStop/onRestart never reject even when isSupported() throws, matching the module's existing JSDoc contract
- [ ] #4 A test drives a Notification fake whose isSupported() throws and proves the above, failing against current merged source (non-vacuity reproduced and reported)
- [ ] #5 All pre-existing tests continue to pass unmodified and npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read the task spec and CLAUDE.md conventions.
2. Read src/main/tray.js in full to locate the exact defect (notifyFailure(), lines 343-345 pre-fix) and understand the runAction() .then()/.catch() chain it feeds into.
3. Read test/main/tray-actions.test.js in full to learn existing patterns (fakeNotificationDeps) and confirm no existing test covers a throwing isSupported().
4. Write two new tests exercising BOTH entry points into notifyFailure() (the .catch() limb for a rejecting handlers.proxy.stop, and the .then() limb for a resolved {ok:false} handlers.proxy.start), each with a Notification.isSupported() that throws.
5. Run the test file against the UNMODIFIED pre-fix source and capture the actual failure output.
6. Also run two standalone reproduction scripts directly against createTrayActions() (not via the test framework) to get the precise console.error call sequence for both paths, to characterize AC#2 accurately.
7. Apply the fix: move the Notification.isSupported() guard inside notifyFailure()'s existing try.
8. Re-run the test file (pass) and the full npm test suite.
9. Sweep tray.js for other throw-outside-try instances on related paths.
10. Commit (single commit, tray.js + tray-actions.test.js only) and push the branch.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Wave-17 implementation evidence (worker, branch `fix/NCOW-59-contain-issupported-throw`, commit `e8c728f494454dc60e5b53ff3275af186863cd9d`, branched from `20ffa60add5d7e281a2f39610adcec1ee987b489`)

Recorded by the orchestrator from the worker's structured return. NOT yet independently reviewed at
the time of writing — the mandatory review pass follows.

**AC#1** — fixed by moving the guard clause inside notifyFailure()'s existing `try` (two lines changed,
one of them moved). No throw escapes on either entry path post-fix.

**AC#2** — verified EXPERIMENTALLY with a standalone script calling the real `createTrayActions()`
directly, not via the test framework. Pre-fix, the resolved-`{ok:false}` path produced exactly two
`console.error` calls:
`[["[tray] Start failed:","NOT_CONFIGURED","Run setup first."],["[tray] Start failed:","","boom from isSupported"]]`
The second is the misattributed line the task describes; joined with spaces it renders as
`"[tray] Start failed:  boom from isSupported"`, matching the task description's own example including
the double space. Post-fix only the first (correct) call remains.

**AC#3** — verified both ways. Pre-fix both new tests failed with `true !== false` because
`onStop()`/`onStart()` rejected with `boom from isSupported`. Post-fix both resolve cleanly.

**AC#4 — NON-VACUITY REPRODUCED AND REPORTED.** Two tests added, both proven to FAIL against the
pre-fix source:
```
not ok 22 - createTrayActions: NCOW-59 - a wedged (rejecting) tray Stop with a throwing Notification.isSupported()
  error: onStop() must never reject even when isSupported() throws, but it rejected with: boom from isSupported
not ok 23 - createTrayActions: NCOW-59 - a resolved {ok:false} tray Start with a throwing Notification.isSupported()
  error: onStart() must never reject even when isSupported() throws, but it rejected with: boom from isSupported
# tests 23 / # pass 21 / # fail 2
```
Post-fix, same file: `# tests 23 / # pass 23 / # fail 0`.
NOVELTY CHECK: compared against every existing test in the file using `fakeNotificationDeps` (the
NCOW-55 and NCOW-56 wedge and resolved-`{ok:false}` tests). All of those use
`isSupported: () => supported` — a boolean, never throwing — and specifically assert the
`isSupported() === false` no-op fallback. None of the 21 pre-existing tests make `isSupported()` throw.
The two new tests use a new helper `fakeThrowingIsSupportedDeps` and new assertions on rejection state
and exact console.error count/content, so neither is a copy of an existing passing test.

**AC#5** — no existing test edited; `git diff` on the test file shows pure additions (108 insertions,
0 deletions). Full suite: `# tests 487 / # pass 487 / # fail 0`, up from the 485 baseline by exactly
the two tests added.

## Class sweep (required by dispatch, "fix the class not the instance") — TWO further findings, NOT fixed

The worker correctly reported rather than drive-by-fixed these. Both were verified BY READING only,
not by experiment, and both are outside this task's acceptance criteria:

1. `tray.setToolTip('Claude Conduit')` (tray.js:62) runs immediately after `new Tray(...)` succeeds but
   sits OUTSIDE the try/catch that wraps only the constructor call (tray.js:52-60). A throw there would
   escape `createTray()` entirely, uncaught.
2. The tray's click wiring — `tray.on('click', () => opts.showDashboard())` (tray.js:145) and the
   `showDashboard`/`showDiagnostics`/`quit` menu-item click callbacks inside
   `Menu.buildFromTemplate([...])` (tray.js:129-135) — invoke `opts.*()` with no try/catch anywhere in
   the call chain. Unlike onStart/onStop/onRestart, which after this fix are contained end-to-end via
   runAction()/notifyFailure(), a throw from those when actually clicked has nothing in tray.js to catch
   it. The try/catch around `Menu.buildFromTemplate(...)` in `setStatus()` guards menu CONSTRUCTION
   only, not click-time execution of the callbacks it installs.

These are follow-up candidates requiring user approval before filing; deliberately not promoted here.

## Worker's own open question, recorded verbatim in substance

AC#4 says "a test" (singular); the worker wrote TWO, one per entry point, reasoning that only the
resolved-`{ok:false}` path reproduces the second-misattributed-console.error behavior the description
centers on, while the rejecting path reproduces the rejection half of the contract violation on its
own. Judged additive rather than risky since no existing test was touched.
<!-- SECTION:NOTES:END -->
