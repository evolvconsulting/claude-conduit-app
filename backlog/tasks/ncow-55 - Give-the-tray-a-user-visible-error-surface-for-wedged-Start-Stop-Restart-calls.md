---
id: NCOW-55
title: Give the tray a user-visible error surface for wedged Start/Stop/Restart calls
status: In Progress
assignee: []
created_date: '2026-08-06 16:27'
updated_date: '2026-08-06 17:24'
labels: []
dependencies:
  - NCOW-53
ordinal: 68000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-53 gave the tray's Stop menu item a diagnostic trail for a wedged pm2 call via `console.error`, per AC#2's literal wording. But the wave-13 integration review found `console.error` is invisible to an end user in a packaged build — stderr goes nowhere nobody reads — so a wedged Stop is now logged but still silent to the actual user, just like before the fix in the respect that matters (the renderer already gets a toast; the tray path does not). The same silent-absorption gap NCOW-53 fixed for tray Stop was never fixed for tray Start/Restart, which were out of NCOW-53's AC scope entirely (its own worker flagged this explicitly as out-of-scope-by-the-letter-of-the-AC when filing).

This task: give the tray a real user-visible error surface for all three actions (Start/Stop/Restart), not just a console log. The renderer's own toast pattern (`src/renderer/components/dom.js`'s `toast()`) is not directly reusable from the main process — decide and document a mechanism appropriate to the tray context (e.g. a native notification via Electron's `Notification` API, or broadcasting an IPC event the renderer's status pill / a toast can pick up even when the Dashboard view isn't mounted).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A wedged tray Stop surfaces a real user-visible error (not just console.error) — e.g. a native OS notification or an IPC-broadcast the renderer can show regardless of which view is mounted
- [ ] #2 A wedged tray Start surfaces the same kind of user-visible error
- [ ] #3 A wedged tray Restart surfaces the same kind of user-visible error
- [ ] #4 A test demonstrates each of the three surfaces above actually shows the error for a genuinely wedged call, and fails against current merged source (non-vacuity reproduced and reported)
- [ ] #5 Normal (non-wedged) Start/Stop/Restart tray behavior is unchanged
- [ ] #6 All pre-existing tests continue to pass unmodified and npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read tray.js/index.js/ipc-channels.js/app.js/dom.js fresh.
2. Attempted the IPC-broadcast mechanism first (deps.broadcast into createTrayActions, a new
   CHANNELS.tray.events.actionFailed, app.js listener -> toast()) — abandoned after discovering
   it breaks 2 pre-existing regex-based identity guards in
   test/main/engine-context-config-regen.test.js (NCOW-35/38/39/41) that hardcode the literal
   substring `createTrayActions({ mutexes, handlers })`; adding a 3rd property fails both, and
   AC#6 forbids modifying pre-existing tests.
3. Pivoted to Electron's native Notification API instead — zero changes needed to index.js's
   createTray({...}) call site; Notification obtained via the module's existing lazy
   require('electron'), with an optional notifyDeps 2nd arg mirroring createTray()'s own deps
   pattern for test injection.
4. Implemented AC#1-3 (Start/Stop/Restart) with the identical mechanism for all three.
5. Added 6 new tests, empirically confirmed non-vacuous via git-show-revert-and-rerun.
6. Ran full suite (461 -> 467), updated CLAUDE.md/README.md test counts, committed, pushed.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented on feat/NCOW-55-tray-error-surface (e9f0c4f..4ef871d, 1 commit), pushed.

Mechanism: native Electron Notification (not IPC-broadcast). Reasoning: IPC-broadcast would
require adding a new property (e.g. broadcast) to createTrayActions's first-argument object
literal, but 2 pre-existing tests (NCOW-35/38/39/41's identity-binding guards in
test/main/engine-context-config-regen.test.js) hardcode the exact substring
`createTrayActions({ mutexes, handlers })` via regex — a 3rd property breaks both, and AC#6
forbids modifying pre-existing tests. Notification sidesteps this: index.js's real
createTray({...}) call site needed zero changes; Notification comes from the module's existing
lazy require('electron'), with an optional notifyDeps 2nd arg (mirroring createTray()'s own deps
pattern) for test injection.

AC#1/#2/#3: all three tray actions (Start/Stop/Restart) construct+.show() a Notification on a
wedged call, identical mechanism across all three, naming the action and the underlying error
message in the body.
AC#4 (non-vacuity): confirmed by reverting tray.js to pre-fix (git show HEAD) and re-running
test/main/tray-actions.test.js directly — 3 of 12 tests fail, but NOT identically: onStop's
failed at the notification-count assertion (0 != 1, since NCOW-53's .catch() already existed but
no notification plumbing did), while onStart/onRestart failed earlier at assert.doesNotReject
(no .catch() existed for those at all pre-this-fix). Test comment corrected to describe this
actual differentiated failure mode rather than an assumed uniform one.
AC#5/#6: npm test 461 -> 467 (6 new tests), full suite green, all pre-existing tests unmodified —
git diff confirms index.js/ipc-channels.js/app.js untouched (the abandoned IPC-broadcast attempt
was fully reverted before committing).

Task-level review (opus), pass 1: request_changes on 2 minor comment-only findings, all 6 ACs
otherwise independently confirmed. Reviewer verified the mechanism pivot (IPC-broadcast tried
and abandoned due to a real conflict with 2 pre-existing identity-guard tests in
engine-context-config-regen.test.js, empirically reproduced by injecting a 3rd property and
observing exactly 2 failures) and reproduced AC#4's non-vacuity personally (reverted tray.js to
HEAD~1, ran tray-actions.test.js, observed 3/12 failures in the exact differentiated pattern
claimed: onStart/onRestart fail at doesNotReject, onStop fails at the notification-count
assertion). Also ran a throwaway live Electron script confirming all 3 real Notifications
construct and .show() with correct bodies against the real, unwrapped call site. npm test
467/467 confirmed.

Blocking findings (both comment-only, no behavior change):
1. tray-actions.test.js's non-vacuity reproduction recipe said `git show HEAD:src/main/tray.js`
   — true when written pre-commit, false the moment it was committed (HEAD is now the fix
   itself). Should reference the pre-fix commit (HEAD~1/dev).
2. tray.js's own prose described the new 2nd constructor argument as "deps" (`deps.Notification`)
   when the actual parameter name is `notifyDeps` — `deps` is already the JSDoc name of the
   *first* argument elsewhere in the file (createTray()'s own deps).

Dispatched a fresh worker fix pass into the same worktree with both findings verbatim.

Task-level review, pass 2 (opus): request_changes again, all 6 ACs re-confirmed unaffected.
Finding 2 (notifyDeps) from pass 1 was correctly and scopefully fixed (confirmed byte-identical
elsewhere). Finding 1 (non-vacuity reproduction recipe) was NOT fixed — it was reintroduced with
the identical off-by-one, shifted forward one commit: the fix pass changed `git show
HEAD:src/main/tray.js` to `git show HEAD~1:src/main/tray.js`, but committing that very change
made HEAD~1 resolve to the fix commit itself (4ef871d) again, not the pre-fix source (e9f0c4f).
Reviewer verified directly: `git show HEAD~1:...  | grep -c notifyDeps` returns 3 (should be 0
for genuinely pre-fix content). Root cause: any HEAD~n reference in a committed comment
self-invalidates on the next commit that touches the same file. Reviewer's explicit
recommendation: use an immutable ref instead — e9f0c4f (this branch's base on dev) — not another
relative offset.

Fix pass 2 (worker): replaced HEAD~1 with the absolute SHA e9f0c4f (this branch's actual base
commit on dev), with a parenthetical explaining why an absolute ref was chosen over a relative
one. Verify-then-commit order followed correctly this time (verification ran before the commit
that could invalidate it, and nothing touched the file afterward). Re-verified: 9 pass/3 fail
against e9f0c4f's tray.js (same differentiated pattern), 467/467 on the real restored file.
Pushed as a2cdfaa. Awaiting review pass 3 (final, capped).
<!-- SECTION:NOTES:END -->
