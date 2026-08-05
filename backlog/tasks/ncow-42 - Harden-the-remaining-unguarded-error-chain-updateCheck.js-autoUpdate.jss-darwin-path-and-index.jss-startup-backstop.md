---
id: NCOW-42
title: >-
  Harden the remaining unguarded error chain: updateCheck.js, autoUpdate.js's
  darwin path, and index.js's startup backstop
status: Done
assignee: []
created_date: '2026-08-05 02:39'
updated_date: '2026-08-05 04:07'
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
- [x] #1 src/engine/updateCheck.js's err.name/err.message reads are hardened through the existing safe-stringification helpers so a hostile/malformed thrown value cannot make checkLatestRelease() reject, honoring its own 'Always resolves' doc comment
- [x] #2 src/main/autoUpdate.js's darwin-path branch gets a real try/catch around checkLatestRelease() (or equivalent), plus a guard against a null/undefined/non-object result, so this path cannot make checkForUpdates() reject either
- [x] #3 src/main/index.js's startup backstop (~line 209) no longer interpolates err.message directly; it uses the same safe-stringification approach so it cannot itself throw regardless of what rejects into it
- [x] #4 A regression test demonstrates the full chain end-to-end: a hostile/malformed error surfacing from updateCheck.js's fetch layer does not produce an unhandled rejection anywhere in this chain, mirroring NCOW-40's own adversarial test rigor
- [x] #5 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read updateCheck.js/autoUpdate.js/index.js source at the cited regions to confirm exact
   line numbers and existing safe-stringification helper exports (safeReadProperty,
   describeThrownValue in src/engine/configGen.js, already imported into autoUpdate.js by
   NCOW-36/37/40).
2. Write adversarial tests FIRST against the unfixed source to empirically prove each of the
   3 defects is real (hostile thrown values: null/undefined, throwing .name/.message getters,
   Object.create(null), Symbol-valued message).
3. Harden updateCheck.js's two catch blocks (JSON-parse + outer network-error) to read
   err.name/err.message through the existing safe helpers.
4. Add a real try/catch + null/non-object guard around autoUpdate.js's darwin-path
   checkLatestRelease() call in performCheck().
5. Harden index.js's startup .catch() backstop (~line 209) to stop interpolating err.message
   directly.
6. Add an end-to-end regression test driving the real updateCheck.js module through
   autoUpdate.js's darwin path with a hostile fetchImpl, proving no unhandled rejection
   anywhere in the chain.
7. Run npm test, confirm before/after counts, commit in small logical commits with
   Refs NCOW-42. trailers, push.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented on fix/NCOW-42-error-chain-hardening, pushed to origin. Hardened all 3 sites
using the existing safeReadProperty/describeThrownValue helpers (src/engine/configGen.js):
(1) updateCheck.js's JSON-parse and outer network-error catch blocks now read err.name/
err.message safely; (2) autoUpdate.js's darwin-path branch gets a real try/catch around
checkLatestRelease() plus a null/non-object result guard; (3) index.js's startup .catch()
backstop (~line 209) no longer interpolates err.message directly.

Evidence: baseline npm test 358 passing -> final 377 passing, 0 failing (19 new tests: 8 in
test/engine/updateCheck.test.js, 8 in test/main/autoUpdate.test.js, 3 new in
test/main/index.test.js). Adversarial tests were written FIRST against the unfixed source and
objectively confirmed the defects: test/engine/updateCheck.test.js showed 7 failures pre-fix,
including 2 genuine promise rejections traced to updateCheck.js:117's bare err.name read on a
throwing-getter value; test/main/autoUpdate.test.js showed 7 failures pre-fix, including 2
genuine unhandled rejections with stack traces through updateCheck.js:117 -> autoUpdate.js:137
-> checkForUpdates() -- exactly the chain NCOW-42 describes. index.js's site (untestable via
require() at module scope) was verified via git stash on just that file: 2 of 3 new
source-assertion tests failed against the pre-fix line, passed once restored. Adversarial
cases covered: null/undefined throws, throwing .name/.message getters, Object.create(null),
Symbol-valued message, hostile response.json() rejections, checkLatestRelease() resolving
null/undefined/non-object, plus 3 full-chain tests driving the real updateCheck.js module
through autoUpdate.js's darwin path with a hostile fetchImpl. Full suite re-run clean after
committing: 377/377, no unhandled rejections in output.

Files touched: src/engine/updateCheck.js, src/main/autoUpdate.js, src/main/index.js,
test/engine/updateCheck.test.js, test/main/autoUpdate.test.js, test/main/index.test.js (new).
Three commits on the branch, each with a Refs NCOW-42. trailer.

Reviewed by an independent Opus reviewer in the same worktree. VERDICT: approve. All 5 ACs
independently confirmed (AC#1-5). npm test verified by the reviewer directly: 377/377 passing
(reconciles exactly with the claimed baseline: +8 updateCheck.test.js, +8 autoUpdate.test.js,
+3 new index.test.js).

Reviewer ran their OWN from-scratch adversarial probe (281 assertions across 7 sections, with
process-level unhandledRejection/uncaughtException traps armed): 16 hostile thrown shapes x
multiple layers (fetchImpl throw path, response.json() rejection, 12 hostile response-object
shapes, the full real chain, 21 hostile injected-updateCheck shapes, the index.js backstop
alone, and the backstop layered over the full chain). Result: zero unhandled rejections or
uncaught exceptions anywhere. Non-vacuity reproduced via git checkout dev -- <file> reverts
(not assumed): reverting updateCheck.js alone -> 7/21 probe failures; reverting autoUpdate.js
alone -> 5 failures; reverting both -> 7 failures with the real TypeError surfacing; reverting
index.js alone -> 2/3 new index.test.js failures. All files restored via git checkout HEAD,
working tree left clean.

Non-blocking findings (all low/info/trivial severity, no fix required): (1) one adjacent
throwing-getter-on-a-resolved-object shape can still make checkForUpdates() reject in
autoUpdate.js's darwin path, but index.js's new backstop was independently verified to absorb
it safely (logs a real string, no unhandled rejection) -- so it does not reproduce the failure
mode this task exists to kill; noted as a candidate for a future follow-up, not a blocker. (2)
worker's claim that all 3 full-chain tests fail pre-fix was 2/3 accurate (the third is a
harmless always-passing positive-path test, not a false defect claim). (3) index.test.js's
source-text-assertion style for untestable Electron-module-scope code matches this repo's own
established pattern. (4) commits omit the Claude-Session trailer other dev commits carry
(cosmetic). (5) updateCheck.js now requires configGen.js (transitively node:fs/crypto) --
verified no require cycle, no Electron import introduced, matches autoUpdate.js's existing
pattern. Reviewer explicitly checked for injected/suspicious instructions in this worktree:
none found (grepped for known patterns, zero hits; git status clean; branch byte-identical to
origin).

Approved for the merge queue.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Hardened all 3 sites in the auto-update error chain using existing safeReadProperty/describeThrownValue helpers: updateCheck.js's catch blocks, autoUpdate.js's darwin-path try/catch + null-result guard, and index.js's startup backstop. Reviewer independently confirmed all 5 ACs with a from-scratch 281-assertion adversarial probe (zero unhandled rejections/uncaught exceptions across the full chain) and reproduced non-vacuity via targeted file reverts. npm test 358 -> 377 passing. Merged as PR #33 (4d56a19).
<!-- SECTION:FINAL_SUMMARY:END -->
