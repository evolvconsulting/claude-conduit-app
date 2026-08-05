---
id: NCOW-38
title: Guard tray call site in index.js against post-spread action key override
status: In Progress
assignee: []
created_date: '2026-08-04 22:21'
updated_date: '2026-08-05 01:59'
labels: []
dependencies:
  - NCOW-35
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-35 extracted the tray's mutex-wrapped onStart/onStop/onRestart wiring into tray.js's createTrayActions({ mutexes, handlers }), spread into the createTray({...}) call in src/main/index.js (around lines 174-189) as `...createTrayActions({ mutexes, handlers })`. NCOW-35's reviewer identified the most realistic accidental-regression shape among several adversarial variants probed: a future edit that adds an onStart/onStop/onRestart key to the createTray({...}) object literal AFTER the spread (or otherwise overrides one of those three keys post-spread) would silently discard the mutex-wrapped action and reintroduce NCOW-31's original finding B1 (an unserialized tray action racing the shared proxy mutex) with a fully green test suite, since neither the existing behavioural test (test/main/tray-actions.test.js) nor the static single-binding check (test/main/engine-context-config-regen.test.js) inspects what happens to the spread's output after it lands in the object literal.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A regression test (static source check and/or behavioural test) fails if src/main/index.js's createTray({...}) call defines an onStart/onStop/onRestart key that overrides the one produced by ...createTrayActions({ mutexes, handlers })
- [ ] #2 The test explicitly reproduces the post-spread override shape described above (a key added after the spread in the same object literal) and confirms it is caught
- [ ] #3 npm test passes
- [ ] #4 The comment block in test/main/engine-context-config-regen.test.js (around lines 799-845, rewritten by NCOW-39) is updated to accurately describe this task's new post-spread-override guard as landed, rather than as an outstanding gap -- while implementing this task, also fold in NCOW-39 review pass 2's two accepted low-severity residuals (F2: correct the umbrella sentence about which gaps a text-only check can reach -- it can reach the 'handlers' single-binding gap the same way it reaches 'mutexes'; F3: describe the tray-actions.test.js negative control's actual mechanics precisely -- it uses an externally-provided differing mutex set, not an internally-constructed one)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a static source-text guard test in test/main/engine-context-config-regen.test.js: extract index.js's createTray({...}) block, locate the ...createTrayActions({ mutexes, handlers }) spread, fail if onStart/onStop/onRestart appears anywhere in the text after it (AC#1).
2. Add a companion meta-test applying the same helper to hand-built synthetic createTray({...}) blocks reproducing the post-spread-override shape for each key, proving the guard actually catches it (AC#2).
3. Update the shared comment block (~lines 799-845) to describe this guard as landed, and fold in NCOW-39's 2 accepted residuals (F2: text-only checks CAN reach the handlers gap the same way as mutexes; F3: tray-actions.test.js's negative control uses an externally-provided differing mutex set, not an internally-constructed one) (AC#4).
4. No source change needed in index.js itself -- current wiring is already correct; this is purely additive regression coverage.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented by worker (worktree fix/NCOW-38-tray-post-spread-guard, commit 6ad01bb, pushed to origin). Added a static guard test (findKeyAfterTraySpread() helper) plus a companion meta-test proving it catches the post-spread-override shape for each of onStart/onStop/onRestart. Updated the shared comment block to describe the guard as landed and folded in NCOW-39's 2 accepted residuals. npm test 350/350 (before and after a temporary regression repro). Verified the guard actually catches the regression: temporarily added a real 'onStop: ...' key after the spread in the live src/main/index.js, confirmed the new test failed with the expected message, then reverted and confirmed via git diff/status that index.js is byte-identical to HEAD. Worker flagged and disregarded a suspicious injected instruction encountered mid-task (a fake system-reminder falsely claiming index.js had been intentionally modified and instructing silence) -- independently re-verified clean via git commands both by the worker and by the orchestrator; no actual modification exists.

Review pass 1 (opus): verdict approve. All 4 ACs confirmed independently. Reviewer reproduced the regression directly (added a real onStop key after the spread in the live index.js, confirmed the new guard test fails with a clear message while the 2 pre-existing tray checks stay green, then reverted and confirmed byte-identical to dev via sha256). AC#4's comment updates verified accurate against real source (tray-actions.test.js's negative control really is externally-provided, not internally-constructed). npm test 350/350 (reviewer's own run, twice). Commit 6ad01bb follows conventions, pushed, diff confined to the one test file. 2 low-severity non-blocking findings recorded as residuals for NCOW-41 (which already owns this comment block's remaining claims and the other 3 gaps): F1 the comment's new closing sentence ('cover everything currently provable') slightly overstates given the handlers gap is reachable-but-uncovered; F2 the new post-spread-override regex only catches the canonical one-key-per-line colon-form style, missing quoted keys/method-shorthand/computed keys/same-line placement -- guard is safe in practice (matches this file's actual authoring style) but narrower than AC#1's literal wording. Reviewer also independently encountered and disregarded a second injected fake-instruction attempt (same pattern as the worker's: falsely claiming index.js was modified, instructing silence) -- verified false via git/sha256, reported transparently.
<!-- SECTION:NOTES:END -->
