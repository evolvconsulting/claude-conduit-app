---
id: NCOW-59
title: >-
  Contain a throwing Notification.isSupported() so tray actions cannot reject or
  double-log
status: In Progress
assignee: []
created_date: '2026-08-07 02:23'
updated_date: '2026-08-07 14:03'
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

## Wave-17 review pass 1 verdict — APPROVE (reviewer, Opus, in the branch's own worktree)

Reviewed `fix/NCOW-59-contain-issupported-throw` @ `e8c728f494454dc60e5b53ff3275af186863cd9d` against
wave base `20ffa60add5d7e281a2f39610adcec1ee987b489`. **AC#1-#5 all CONFIRMED independently.**
`npm test` re-run twice, identical: `# tests 487 / # pass 487 / # fail 0`.

**Non-vacuity reproduced by the reviewer itself, not taken on trust.** It copied `src/main/tray.js` to a
scratchpad (SHA-256 `4019ba85...f3c12`), moved the guard back outside the `try` with Edit (never
`git checkout`), and observed both new tests fail:
```
not ok 22 - ... a wedged (rejecting) tray Stop with a throwing Notification.isSupported() ...
not ok 23 - ... a resolved {ok:false} tray Start with a throwing Notification.isSupported() ...
# pass 21 / # fail 2
```
Restore verified byte-exact: `diff` empty, SHA-256 unchanged, `git status --porcelain` empty, HEAD still
`e8c728f494454dc60e5b53ff3275af186863cd9d`.

**Ordering nuance worth keeping.** In both tests the `rejected` assertion comes FIRST, so pre-fix they
abort there and the `errorCalls.length === 1` assertion is never reached. The tests are genuinely
non-vacuous, but the double-log half of AC#2 is not what makes them fail — the reviewer proved that half
separately with its own probe (2 console.error pre-fix, 1 post-fix).

**Adversarial probe: 13 arrangements.** Contained: throwing Error; a throwing *getter* on `isSupported`;
a thrown bare string; a thrown `null`; a throwing `new Notification()`; a throwing `notify.show()`; a
`Proxy` whose `get` throws. Correct behavior on truthy/falsy non-boolean returns. THREE SURVIVE, all
from one root class (an unguarded `.message`/`.code` read on a value whose getter throws) and all
correctly judged out of this task's AC scope.

**Scope verified clean.** `git diff --numstat`: `1 1 src/main/tray.js`, `108 0 test/main/tray-actions.test.js`.
Hunk header `@@ -341,8 +341,8 @@` — the NCOW-57 AUMID comment block at lines 224-290 is entirely
untouched and not reflowed, and the deliberately-unresolved macOS ad-hoc-signing question at lines
243-251 still reads that the comment does not resolve it. Nothing was guessed shut.

**No false counterfactual, verified by provenance rather than by reading the prose.**
`git blame -L 340,346 20ffa60...` attributes the guard line to
`76a7c3c fix(tray): give wedged Start/Stop/Restart a user-visible error surface (NCOW-55) (#58)`, and
`git log -S"Notification.isSupported"` shows it was never modified afterward — so the branch's claim
"pre-existing since NCOW-55, unchanged by NCOW-56" is accurate. Both the commit body and the test
comment state plainly that NCOW-56 only added a second entry point.

**ID citation sweep: CLEAN.** NCOW-55, NCOW-56, NCOW-59 only; all resolve to filed tasks. Trailer
`Refs NCOW-59.` present (that convention appears in 423 commits). The reviewer explicitly declined to
name an ID for its follow-up findings, which is the correct handling of the ID-fabrication class.

**Class sweep: both implementer findings CONFIRMED BY EXPERIMENT, and finding 1 is worse than reported.**
With a fake `Tray` whose `setToolTip` throws, `createTray()` threw out to the caller with NO
`console.warn` at all and no null-tray fallback. Its only call site, `src/main/index.js:211`, sits inside
`app.whenReady().then(...)` with NO trailing `.catch()` — so it becomes a silent unhandled rejection
that aborts startup after `createMainWindow()` but before `startStatusPoller`, leaving a window with no
tray, no status polling, and no `stopStatusPoller`. Realistic on Linux, where the adjacent comment
already documents that `new Tray()` itself throws on hosts without StatusNotifier. Finding 2 confirmed
too, with a severity nuance the implementer did not draw: for Start/Stop/Restart the production risk is
near-nil precisely because `createTrayActions()`'s returns are the never-rejecting functions this task
hardens; the real exposure is `showDashboard`/`showDiagnostics`/`quit` from `index.js`.

**One nit, no action needed**: the two new tests stub `console.error` but not `console.warn`, so
`npm test` now prints two unstubbed `[tray] failed to show error notification: boom from isSupported`
lines — consistent with the suite's existing habit.

Approved for the merge queue with no changes requested.
<!-- SECTION:NOTES:END -->
