---
id: NCOW-38
title: Guard tray call site in index.js against post-spread action key override
status: To Do
assignee: []
created_date: '2026-08-04 22:21'
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
<!-- AC:END -->
