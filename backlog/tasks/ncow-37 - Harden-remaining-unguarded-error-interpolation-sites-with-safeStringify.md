---
id: NCOW-37
title: Harden remaining unguarded error-interpolation sites with safeStringify()
status: In Progress
assignee: []
created_date: '2026-08-04 22:21'
updated_date: '2026-08-04 22:25'
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
