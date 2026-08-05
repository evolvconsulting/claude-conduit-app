---
id: NCOW-41
title: >-
  Cover the remaining tray-wiring mutex-identity gaps beyond the post-spread
  override
status: In Progress
assignee: []
created_date: '2026-08-05 01:43'
updated_date: '2026-08-05 02:48'
labels: []
dependencies:
  - NCOW-35
  - NCOW-38
ordinal: 54000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-35 introduced createTrayActions({ mutexes, handlers }) in tray.js and a partial static check in test/main/engine-context-config-regen.test.js proving only that the 'mutexes' identifier is declared/bare-reassigned exactly once in src/main/index.js. NCOW-39's review (and NCOW-35's own original review notes) documented 4 distinct ways the tray's createTray({...}) call site in index.js could end up with an unshared mutex/handlers pair that neither the existing behavioural test (test/main/tray-actions.test.js) nor the static single-binding check would catch. A sibling task, NCOW-38, covers 1 of the 4 (a future onStart/onStop/onRestart key added to the createTray({...}) object literal after the ...createTrayActions({ mutexes, handlers }) spread). This task covers the other 3, which currently have no covering task at all: (a) 'handlers' has no single-binding check at all -- the existing static check is scoped entirely to the 'mutexes' identifier, so a private, shadowed 'handlers' binding passes the full suite undetected (empirically reproduced during NCOW-39's review); (b) property-level mutation of 'mutexes.proxy' after the createEngineContext() destructure and before createTray({...}) -- NCOW-35's own review notes record this was empirically VERIFIED as a real serialization break (a tray Stop action ran concurrently with an in-flight IPC-triggered restart) that passed the full suite regardless; (c) parameter shadowing, e.g. a wrapper like '((mutexes) => createTray({...}))(privateMutexSet)', which is the same nested-scope-shadowing class as (a)/(b) but via a function parameter instead of a block-scoped const.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A single-binding check (static and/or behavioural) exists for 'handlers' equivalent in rigor to the existing 'mutexes' check, so a shadowed/private 'handlers' binding at the createTray({...}) call site is caught
- [ ] #2 A regression test demonstrates that mutating 'mutexes.proxy' (or the equivalent handlers property) after the createEngineContext() destructure and before createTray({...}) is caught -- this is the gap NCOW-35's own review verified as a REAL serialization break, so prioritize this one if scope needs to be trimmed
- [ ] #3 A regression test demonstrates that parameter-shadowing the mutexes/handlers identifiers passed into createTray({...}) (e.g. via a wrapping function parameter) is caught
- [ ] #4 npm test passes
- [ ] #5 Correct the comment block's closing sentence (introduced by NCOW-38) claiming the existing tests 'cover everything currently provable' -- this overstates, since the handlers gap this task closes was reachable-but-uncovered before this task landed
- [ ] #6 Widen NCOW-38's post-spread-override regex (or note explicitly why it's intentionally scoped) to also catch quoted keys ('onStop': ...), method-shorthand (onStop() {...}), and computed keys (['onStop']: ...), not just the canonical bare colon-form key -- currently only catches the file's existing one-key-per-line arrow-function style
- [ ] #7 Make NCOW-38's post-spread-override guard fail loud instead of fail open: findKeyAfterTraySpread() currently returns undefined both when no override exists AND when the ...createTrayActions spread isn't found in the extracted block (e.g. a nested '});' between the spread and an override key truncates the block early), so the exact regression the guard exists to catch can slip through green -- add an explicit assertion that the spread was actually found before asserting no override followed it
- [ ] #8 Correct the comment block's 'is now CLOSED' framing for the post-spread-override guard if AC#7 above (fail-loud fix) is not yet fixed by the time this task lands, and resolve the dangling '...not X' contrast left over from an earlier edit to the closing sentence
<!-- AC:END -->
