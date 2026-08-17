---
id: CCA-65
title: licenses.test.js's drift guard is blind to version mismatches
status: Done
assignee: []
created_date: '2026-08-17 13:17'
updated_date: '2026-08-17 16:03'
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
- [x] #1 Guard compares src/assets/licenses.json's app.version against package.json's real version, and fails if they differ
- [x] #2 Guard compares each bundled entry's version against what package-lock.json actually resolves that package to, and fails on any mismatch
- [x] #3 Both checks are proven non-vacuous by experiment: deliberately stale each field in a scratch copy, observe the guard fail naming the mismatch; restore, observe it pass
- [x] #4 npm test passes
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

REVIEW PASS 1 (opus): APPROVE. Confirmed AC indices: [1, 2, 3, 4] -- all independently
re-verified against real source, not the worker's claims.

npm test personally observed: before 562/562, after 564/564 (delta +2, matches worker).

Non-vacuity independently reproduced (stronger than the worker's own): ran the shipped
TEST FILE (not just the helper) against a staled real licenses.json copy -- exit 1, 2/15
failing exactly on the two new drift tests, both naming the mismatch. Also found the
set-membership design correctly still catches the real js-yaml regression despite being lax
for names with >1 lockfile version (14/91 entries affected -- documented, not blocking, since
AC#2 as worded only requires matching *a* version package-lock.json resolves that name to).

Non-blocking findings (none gate merge): (1) commit 7b7d652's message misattributes which
commit/PR shipped the stale js-yaml (says 7e3b408/PR#72, actually 806f5ce/PR#68 caused it,
PR#72 fixed it) -- worth a quick amend before merge since branch is unmerged and this
campaign holds a "no overclaims" standard, but not blocking. (2) lockVersionsByName() DRY
duplication with licenses.test.js's existing lockEntriesByName(). (3) informational: once
CCA-63 lands (bumps package.json version), this guard will correctly fail until
`npm run licenses` regenerates licenses.json -- expected, not a defect, but relevant given
CCA-63 was found to have exactly this bug live (see CCA-63's own notes).

Reviewer's own scope/overlap checks: clean, no drive-bys, disjoint from CCA-63/CCA-14.5.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a pure comparison helper (test/main/.helpers/licenses-drift.js) plus two new tests to
test/main/licenses.test.js: app.version must match package.json's real version (AC#1), and
every bundled entry's version must be among the versions package-lock.json actually resolves
that package name to (AC#2, set-membership since some names legitimately resolve to more than
one version in this tree). Non-vacuity proven by staling both fields in a scratch copy (never
the real tracked file) and observing real failures naming the exact mismatch, then restoring
and observing clean passes (AC#3) -- reproduced independently by the reviewer against both the
helper functions and the shipped test file, including an independent re-derivation of the
lockfile-parsing logic against all 352 real package-lock.json entries. 1 review pass (opus),
approved with all 4 ACs confirmed; npm test 564/564 standalone, 583/583 on merged dev (AC#4).
The guard was independently cross-checked against CCA-63's version bump before that PR merged,
and confirmed clean on the real merged dev by the wave-19 integration review. Merged as PR #75
(1520b55).
<!-- SECTION:FINAL_SUMMARY:END -->
