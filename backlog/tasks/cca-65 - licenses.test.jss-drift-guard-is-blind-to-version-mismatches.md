---
id: CCA-65
title: licenses.test.js's drift guard is blind to version mismatches
status: In Progress
assignee: []
created_date: '2026-08-17 13:17'
updated_date: '2026-08-17 14:52'
labels:
  - bug
  - test-infra
dependencies: []
priority: medium
ordinal: 83000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`test/main/licenses.test.js` guards `src/assets/licenses.json` against drift from `package.json`/`package-lock.json`, but it only checks entry count and name membership — it never compares any bundled entry's `version` field against what's actually installed/locked. This is why a stale version can ship in the Help > Licenses dialog undetected through a full task review and merge.

Concrete instance (found by wave-18's integration review, 2026-08-17): CCA-64 bumped js-yaml from 4.3.0 to 4.3.1 in `package.json`/`package-lock.json` to close a Dependabot security advisory. `src/assets/licenses.json` still said `"js-yaml": "4.3.0"` after CCA-64 merged — the existing guard's count/membership checks passed cleanly, so nobody caught it until an unrelated wave's integration review happened to diff the file by hand. Separately (pre-existing, unrelated to CCA-64), the same file's `app.version` had drifted to `0.1.0` vs `package.json`'s real `0.1.1` for about two weeks after a version bump with no relicensing regeneration — same blind spot, different cause.

Both fields are genuinely user-visible: `src/renderer/components/licenses-dialog.js` renders `result.data.app.version` in its heading and each `entry.version` in its package rows, fed by `src/main/ipc.js`'s `getLicenses()` reading `src/assets/licenses.json` directly.

The fix is a guard addition, not a one-off correction of the two instances above (both are already fixed as of the wave-18 cleanup, PR #72) — the point is to make a future recurrence fail CI instead of shipping silently.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Guard compares src/assets/licenses.json's app.version against package.json's real version, and fails if they differ
- [ ] #2 Guard compares each bundled entry's version against what package-lock.json actually resolves that package to, and fails on any mismatch
- [ ] #3 Both checks are proven non-vacuous by experiment: deliberately stale each field in a scratch copy, observe the guard fail naming the mismatch; restore, observe it pass
- [ ] #4 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read test/main/licenses.test.js, src/assets/licenses.json, scripts/generate-licenses.js, package.json/package-lock.json.
2. Add test/main/.helpers/licenses-drift.js with two pure functions: appVersionMismatch(licensesData, pkgData) and entryVersionMismatches(licensesData, lockData) (set-membership against package-lock.json's resolved versions per package name, since some names resolve to >1 version in this tree).
3. Wire both into test/main/licenses.test.js as two new tests alongside the existing count/membership tests.
4. Prove AC#3 non-vacuously via a scratch-copy experiment (never the real tracked file): stale app.version and a known entry version (js-yaml 4.3.0, the real CCA-64 regression value), observe the guard fail naming the mismatch, restore, observe it pass again.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
IMPLEMENTED (worker, wave 19). npm test 562 -> 564, 0 failures before/after.

AC#3 non-vacuity experiment (scratch copy only, real licenses.json never touched):
- app.version check: clean -> pass (null). Staled to "0.0.0-STALE" -> guard reported
  'licenses.json app.version ("0.0.0-STALE") does not match package.json's version ("0.1.1")'.
  Restored -> pass again.
- Per-entry check: clean -> pass ([]). Staled js-yaml entry to "4.3.0" (the real CCA-64
  regression value) -> guard reported '["js-yaml@4.3.0 (package-lock.json resolves it to: 4.3.1)"]'.
  Restored -> pass again.

Files touched: test/main/.helpers/licenses-drift.js (new), test/main/licenses.test.js (2 new
tests + import). No production files touched.

Commits on fix/CCA-65-licenses-version-drift-guard (pushed): 7b7d652, 337498e.

Worker also checked the real currently-tracked licenses.json: no live drift found right now
(app.version and all 91 entries match) -- nothing outside scope to fix.
<!-- SECTION:NOTES:END -->
