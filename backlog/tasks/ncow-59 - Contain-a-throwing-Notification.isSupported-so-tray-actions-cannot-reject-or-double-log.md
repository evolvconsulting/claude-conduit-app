---
id: NCOW-59
title: >-
  Contain a throwing Notification.isSupported() so tray actions cannot reject or
  double-log
status: In Progress
assignee: []
created_date: '2026-08-07 02:23'
updated_date: '2026-08-07 13:45'
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
