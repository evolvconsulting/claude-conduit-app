---
id: NCOW-40
title: Harden autoUpdate.js's remaining unguarded error-interpolation sites
status: In Progress
assignee: []
created_date: '2026-08-05 01:43'
updated_date: '2026-08-05 01:53'
labels: []
dependencies:
  - NCOW-37
ordinal: 53000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-37 hardened src/main/autoUpdate.js's electron-updater 'error' event handler and configGen.js's 'restart-failed' branch. Wave-2's integration review found 2 more sites in the same file with the identical unguarded-interpolation shape, both still covered by doc comments promising stronger guarantees than they deliver: (1) performCheck()'s catch block (around lines 149-156) interpolates 'err.message' raw -- reproduced live to reject on 4/5 hostile shapes (including plain null/undefined, not just exotic ones) despite the function's own doc comment promising 'Always resolves ... so a caller can fire this from app startup without an enclosing try/catch'; (2) the darwin-path result branch (around lines 139-140) interpolates 'result.error.code'/'result.error.message' raw, rejecting on 3/4 hostile shapes (lower risk in practice since that object currently only ever comes from this app's own updateCheck.js, but still an inconsistency with the rest of the file). Bounded severity: index.js:209 already has a real .catch() on the caller side, so the practical consequence of either gap is a missed status-broadcast (the update banner silently hangs on 'checking'), not a crash or hung app -- but the module's own doc comments should not overstate what these two sites actually guarantee. While in this file, also collapse describeThrownValue()'s 2 remaining inline copies of the same property-read guard into the already-extracted safeReadProperty() helper (NCOW-37 extracted it but didn't route describeThrownValue() through it), and either add a real consumer for the now-exported but currently-unused safeStringify() or drop the export -- both are small, behavior-preserving cleanups surfaced in the same review, not separate scope.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 performCheck()'s catch block no longer interpolates err.message directly; it routes through describeThrownValue()/safeStringify() (or equivalent) so a hostile thrown value cannot cause the handler to reject instead of degrading to a status broadcast, matching the function's own 'Always resolves' doc comment
- [ ] #2 The darwin-path result.error interpolation is likewise hardened through the same safe-stringification approach
- [ ] #3 describeThrownValue() in src/engine/configGen.js is refactored to call the existing safeReadProperty() helper instead of carrying its own duplicate inline property-read guards, with no behavior change (existing tests continue to pass unmodified in intent)
- [ ] #4 The exported safeStringify() either gains a real consumer or is removed from configGen.js's exports if genuinely unused
- [ ] #5 A regression test proves both hardened sites resolve (not reject) when given a hostile/malformed error value, mirroring NCOW-37's own adversarial test style
- [ ] #6 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Route performCheck()'s catch block's err through the already-imported describeThrownValue() instead of bare err.message.
2. Route the darwin-path result.error.code/message through safeStringify(safeReadProperty(...)), mirroring configGen.js's own restart-failed pattern.
3. Refactor describeThrownValue() in configGen.js to call safeReadProperty() for its .message and .constructor.name reads instead of duplicating inline try/catch guards.
4. Export safeReadProperty from configGen.js so autoUpdate.js can consume it directly, giving safeStringify a genuine external consumer.
5. Add 8 adversarial regression tests (4 per site) to test/main/autoUpdate.test.js.
6. Stay within autoUpdate.js, configGen.js, and autoUpdate.test.js only.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented by worker (worktree fix/NCOW-40-autoupdate-remaining-sites, commit aef9941, pushed to origin). performCheck()'s catch now uses describeThrownValue(err); darwin-path uses safeStringify(safeReadProperty(result.error, 'code'/'message')). describeThrownValue() refactored to call safeReadProperty() instead of duplicating inline guards (behavior-preserving). safeReadProperty exported from configGen.js; safeStringify now has a real external consumer (autoUpdate.js's darwin path). 8 new adversarial tests added to test/main/autoUpdate.test.js. npm test: 356/356 passing. Pre-fix verification: stashed only the 2 source files (kept new tests), ran against reverted code -- 17 pass / 8 fail, exactly the 8 new tests, with failure messages matching predicted TypeErrors; confirms genuine regression coverage, not happy-path.
<!-- SECTION:NOTES:END -->
