---
id: CCA-40
title: Harden autoUpdate.js's remaining unguarded error-interpolation sites
status: Done
assignee: []
created_date: '2026-08-05 01:43'
updated_date: '2026-08-05 02:39'
labels: []
dependencies:
  - CCA-37
ordinal: 53000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
CCA-37 hardened src/main/autoUpdate.js's electron-updater 'error' event handler and configGen.js's 'restart-failed' branch. Wave-2's integration review found 2 more sites in the same file with the identical unguarded-interpolation shape, both still covered by doc comments promising stronger guarantees than they deliver: (1) performCheck()'s catch block (around lines 149-156) interpolates 'err.message' raw -- reproduced live to reject on 4/5 hostile shapes (including plain null/undefined, not just exotic ones) despite the function's own doc comment promising 'Always resolves ... so a caller can fire this from app startup without an enclosing try/catch'; (2) the darwin-path result branch (around lines 139-140) interpolates 'result.error.code'/'result.error.message' raw, rejecting on 3/4 hostile shapes (lower risk in practice since that object currently only ever comes from this app's own updateCheck.js, but still an inconsistency with the rest of the file). Bounded severity: index.js:209 already has a real .catch() on the caller side, so the practical consequence of either gap is a missed status-broadcast (the update banner silently hangs on 'checking'), not a crash or hung app -- but the module's own doc comments should not overstate what these two sites actually guarantee. While in this file, also collapse describeThrownValue()'s 2 remaining inline copies of the same property-read guard into the already-extracted safeReadProperty() helper (CCA-37 extracted it but didn't route describeThrownValue() through it), and either add a real consumer for the now-exported but currently-unused safeStringify() or drop the export -- both are small, behavior-preserving cleanups surfaced in the same review, not separate scope.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 performCheck()'s catch block no longer interpolates err.message directly; it routes through describeThrownValue()/safeStringify() (or equivalent) so a hostile thrown value cannot cause the handler to reject instead of degrading to a status broadcast, matching the function's own 'Always resolves' doc comment
- [x] #2 The darwin-path result.error interpolation is likewise hardened through the same safe-stringification approach
- [x] #3 describeThrownValue() in src/engine/configGen.js is refactored to call the existing safeReadProperty() helper instead of carrying its own duplicate inline property-read guards, with no behavior change (existing tests continue to pass unmodified in intent)
- [x] #4 The exported safeStringify() either gains a real consumer or is removed from configGen.js's exports if genuinely unused
- [x] #5 A regression test proves both hardened sites resolve (not reject) when given a hostile/malformed error value, mirroring CCA-37's own adversarial test style
- [x] #6 npm test passes
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
Implemented by worker (worktree fix/CCA-40-autoupdate-remaining-sites, commit aef9941, pushed to origin). performCheck()'s catch now uses describeThrownValue(err); darwin-path uses safeStringify(safeReadProperty(result.error, 'code'/'message')). describeThrownValue() refactored to call safeReadProperty() instead of duplicating inline guards (behavior-preserving). safeReadProperty exported from configGen.js; safeStringify now has a real external consumer (autoUpdate.js's darwin path). 8 new adversarial tests added to test/main/autoUpdate.test.js. npm test: 356/356 passing. Pre-fix verification: stashed only the 2 source files (kept new tests), ran against reverted code -- 17 pass / 8 fail, exactly the 8 new tests, with failure messages matching predicted TypeErrors; confirms genuine regression coverage, not happy-path.

Review pass 1 (opus): verdict approve. All 6 ACs confirmed independently. Reviewer's own from-scratch adversarial probe (53 hostile shapes x 3 sites = 159 case-runs: revoked Proxy, all-traps-throwing Proxy, self-recursive getters, throwing toString/valueOf/Symbol.toPrimitive, BigInt, circular objects, 100k-char messages, etc.) found 0 throws/rejections against the fix and 29 genuine throws against unpatched dev (125 total findings incl. non-throw string-type violations); control check confirmed CCA-37's already-hardened site produced 0 findings both before and after, validating the probe discriminates real gaps rather than flagging noise. AC#3's behavior-preservation verified via a 61-shape differential against a verbatim copy of the old describeThrownValue() implementation, including composition edge cases (throwing constructor getter, throwing .name getter, constructor as Proxy/null/primitive) -- byte-identical outputs on every shape, zero divergence. npm test 356/356 (reviewer's own run; dev baseline 348/348, confirming the reported +8). Pre-fix regression-coverage independently reproduced: reverting the 2 source files while keeping new tests produced exactly 17 pass / 8 fail, all genuine runtime throws. Commit aef9941 follows conventions; diff confined to the 3 expected files, no collision with sibling wave-3 task. 2 new non-blocking residuals found (out of this task's scope, pre-existing on dev, not introduced or worsened here): (1) performCheck()'s darwin branch still has no try/catch around checkLatestRelease() itself -- a rejecting or null-resolving call still makes checkForUpdates() reject despite its own 'Always resolves' doc comment; (2) src/engine/updateCheck.js:116-118 reads err.name off an unguarded caught value with the same CCA-36/37/40-family shape -- a fetchImpl throwing null/undefined makes checkLatestRelease() reject despite its own 'Always resolves' doc comment. Both are natural next follow-up candidates, to be proposed to the user at wave-3 integration review time, not created unilaterally.

Wave-3 integration review (opus): confirmed no cross-task conflicts with CCA-38 (disjoint files, no hidden coupling between autoUpdate.js and tray.js/its tests). npm test 358/358 on merged dev. Critically, the reviewer found the severity-bounding argument used to defer this task's 2 residuals was itself wrong: index.js:209's backstop .catch(err => console.warn(..., err.message)) -- cited as proof the consequence was 'just a missed status broadcast' -- has the identical unguarded-read bug. Reproduced the full chain empirically: updateCheck.js's err.name/err.message unguarded (3/5 hostile shapes reject), autoUpdate.js's darwin checkLatestRelease() call has no try/catch and no null-result guard (5/5 shapes reject), and index.js:209's own backstop then throws on a null rejection. Proposed to the user as a new follow-up task covering the full chain; approved and filed as CCA-42.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Hardened performCheck()'s catch block and autoUpdate.js's darwin-path result.error interpolation, refactored describeThrownValue() to use safeReadProperty(), gave safeStringify() a real consumer. Approved on the first review pass (opus): all 6 ACs confirmed, including a from-scratch 159-case-run adversarial probe (0 failures against the fix, 29 genuine throws against unpatched dev) and a 61-shape behavior-preservation differential proving the describeThrownValue() refactor byte-identical to the original. npm test 356/356 (reviewer's own run). Merged as PR #31 (7fbcc9e). Wave-3 integration review found the 2 residuals this task's reviewer deferred (performCheck()'s darwin branch, updateCheck.js's err.name read) combine with an equally-unguarded backstop at index.js:209 into a real, reproducible unhandled-rejection-shaped chain -- filed as CCA-42.
<!-- SECTION:FINAL_SUMMARY:END -->
