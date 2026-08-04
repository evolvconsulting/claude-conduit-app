---
id: NCOW-37
title: Harden remaining unguarded error-interpolation sites with safeStringify()
status: In Progress
assignee: []
created_date: '2026-08-04 22:21'
updated_date: '2026-08-04 22:31'
labels: []
dependencies:
  - NCOW-36
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-36 introduced safeStringify()/describeThrownValue() in src/engine/configGen.js to make configGen's thrown-value logging guard structurally throw-proof against hostile/malformed error objects. NCOW-36's reviewer confirmed live that two adjacent sites use the old unguarded interpolation pattern and remain exposed to the same class of bug: (1) src/engine/configGen.js's regenerateStaleConfig(), the 'restart-failed' branch (around line 613), which interpolates `${error.code}: ${error.message}` from pm2Control's returned error object rather than a thrown value; (2) src/main/autoUpdate.js's electron-updater 'error' event handler (around line 100), `const message = err?.message ?? String(err);`, in a handler whose surrounding comment explicitly promises it will 'never throw.' Both should route through configGen.js's existing safeStringify()/describeThrownValue() helpers (or an equivalent import) so a hostile error/thrown value (e.g. an object with a throwing message getter, or one created via Object.create(null)) cannot make either code path throw instead of log.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 src/engine/configGen.js's 'restart-failed' branch no longer interpolates error.code/error.message directly; it uses safeStringify()/describeThrownValue() (or equivalent) so a hostile error object cannot throw during logging
- [ ] #2 src/main/autoUpdate.js's electron-updater error handler (around line 100) no longer calls bare String(err) as a fallback; it uses the same safe-stringification approach so a thrown non-Error value (e.g. Object.create(null)) cannot make the handler itself throw
- [ ] #3 A regression test proves both sites log safely (do not throw) when given a hostile/malformed error value, mirroring NCOW-36's own adversarial test style
- [ ] #4 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reuse configGen.js's existing safeStringify()/describeThrownValue() helpers (from NCOW-36) rather than inventing new ones; export them from the module.
2. In regenerateStaleConfig()'s 'restart-failed' branch, add a safeReadProperty(obj, key) helper (guards a hostile throwing getter) and route error.code/error.message through safeStringify().
3. In src/main/autoUpdate.js's electron-updater 'error' handler, replace 'err?.message ?? String(err)' with describeThrownValue(err) imported from ../engine/configGen (matches existing main/->engine/ import precedent).
4. Add adversarial regression tests mirroring NCOW-36's style (throwing getters, Object.create(null)) in test/engine/configGen.test.js and test/main/autoUpdate.test.js.
5. Stay within src/engine/configGen.js, src/main/autoUpdate.js, and their two test files only; do not touch index.js/engine-context.js.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented by worker (worktree fix/NCOW-37-safestringify-remaining-sites, commit 08ea3b8, pushed to origin). Added safeReadProperty() helper + routed the restart-failed branch's error.code/error.message through the existing safeStringify(); exported safeStringify/describeThrownValue from configGen.js; autoUpdate.js's error handler now uses describeThrownValue(err) instead of bare String(err). 5 new adversarial tests added (3 in test/engine/configGen.test.js, 2 in test/main/autoUpdate.test.js) covering throwing getters and Object.create(null) shapes. npm test: 348/348 passing (run twice, consistent). Confirmed via git diff --stat that only the 4 in-scope files were touched.
<!-- SECTION:NOTES:END -->
