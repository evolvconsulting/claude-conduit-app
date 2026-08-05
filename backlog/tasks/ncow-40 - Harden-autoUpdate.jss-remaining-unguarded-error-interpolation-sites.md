---
id: NCOW-40
title: Harden autoUpdate.js's remaining unguarded error-interpolation sites
status: To Do
assignee: []
created_date: '2026-08-05 01:43'
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
