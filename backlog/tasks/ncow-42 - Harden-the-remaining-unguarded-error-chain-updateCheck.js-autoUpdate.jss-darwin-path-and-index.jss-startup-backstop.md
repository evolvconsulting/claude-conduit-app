---
id: NCOW-42
title: >-
  Harden the remaining unguarded error chain: updateCheck.js, autoUpdate.js's
  darwin path, and index.js's startup backstop
status: In Progress
assignee: []
created_date: '2026-08-05 02:39'
updated_date: '2026-08-05 02:48'
labels: []
dependencies:
  - NCOW-40
ordinal: 55000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-40's own reviewer found 2 residual unguarded-interpolation sites out of that task's scope, and a wave-3 integration review found they combine with a third, previously-unnoticed one into a real, reproducible failure chain -- not just 'a missed status broadcast' as NCOW-40's task description had assumed when bounding severity. The chain: (1) src/engine/updateCheck.js (~lines 116-118) reads 'err.name' off a caught value with no guard -- a fetchImpl that throws null/undefined, or an error with a throwing '.name' getter, makes checkLatestRelease() REJECT despite its own 'Always resolves' doc comment (3 of 5 adversarial shapes reproduced this); (2) src/main/autoUpdate.js's darwin-path branch (~lines 137-138) has NO try/catch at all around 'await deps.updateCheck.checkLatestRelease(...)', and dereferences 'result.ok' unguarded -- ALL 5 adversarial shapes tried (throwing null/undefined/Error, resolving null/undefined) made checkForUpdates() reject; (3) src/main/index.js (~line 209)'s own startup backstop -- '.catch((err) => console.warn('[auto-update] startup check failed unexpectedly:', err.message))' -- was cited by NCOW-40 as proof any residual gap degrades safely, but it has the exact same unguarded 'err.message' read, so a null/undefined rejection propagating up from (1)/(2) makes THIS handler itself throw a TypeError, producing an unhandled rejection in the main process instead of the safe log line it was assumed to be. All 3 sites share the same root cause and the same fix pattern already established by NCOW-36/37/40 (safeStringify()/describeThrownValue()/safeReadProperty()), so fixing them as one task (rather than 3 separate ones) avoids re-deriving the same adversarial test harness 3 times.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 src/engine/updateCheck.js's err.name/err.message reads are hardened through the existing safe-stringification helpers so a hostile/malformed thrown value cannot make checkLatestRelease() reject, honoring its own 'Always resolves' doc comment
- [ ] #2 src/main/autoUpdate.js's darwin-path branch gets a real try/catch around checkLatestRelease() (or equivalent), plus a guard against a null/undefined/non-object result, so this path cannot make checkForUpdates() reject either
- [ ] #3 src/main/index.js's startup backstop (~line 209) no longer interpolates err.message directly; it uses the same safe-stringification approach so it cannot itself throw regardless of what rejects into it
- [ ] #4 A regression test demonstrates the full chain end-to-end: a hostile/malformed error surfacing from updateCheck.js's fetch layer does not produce an unhandled rejection anywhere in this chain, mirroring NCOW-40's own adversarial test rigor
- [ ] #5 npm test passes
<!-- AC:END -->
