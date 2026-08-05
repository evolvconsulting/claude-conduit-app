---
id: NCOW-38
title: Guard tray call site in index.js against post-spread action key override
status: To Do
assignee: []
created_date: '2026-08-04 22:21'
updated_date: '2026-08-05 01:44'
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
