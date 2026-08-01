---
id: NCOW-19
title: licenses.test.js is platform-sensitive to optional dependency resolution
status: In Progress
assignee: []
created_date: '2026-08-01 14:32'
updated_date: '2026-08-01 22:04'
labels: []
dependencies: []
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
test/main/licenses.test.js asserts licenses.bundled.length === (a live `npm ls --omit=dev --all` count) + 1. That live count depends on which platform-restricted optional dependencies npm actually installs. NCOW-18 (2026-08-01) fixed a staleness bug by regenerating licenses.json to include `fsevents` — a darwin-only optional dependency of chokidar/pm2 — bringing the count to 79. That is correct on macOS (where this project is exclusively developed today and where `npm run dist` builds all three platforms), but the same assertion would now fail on a genuinely fresh Linux or Windows install, where npm never installs `fsevents` and the live count is 77, not 78. This is the mirror image of the bug NCOW-18 just fixed, discovered by the wave-level integration reviewer while confirming NCOW-17 and NCOW-18 (merged together in the same campaign wave) do not conflict — it is not caused by either task, and nothing is broken today (no CI exists in this repo). Make the tree-coverage assertion platform-aware so it stays correct regardless of which platform-restricted optional dependencies the current OS happens to resolve.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The assertion in test/main/licenses.test.js excludes, from its expected count, any package whose lockfile entry restricts it to an os/cpu that does not match the current platform (so it does not require regenerating licenses.json to drop a legitimately-shipped-on-macOS entry like fsevents)
- [ ] #2 The test passes on this macOS machine with the current licenses.json (79 entries) exactly as it does today
- [ ] #3 The test would also pass if run on a platform where fsevents (or any other platform-restricted optional dependency introduced later) is not installed, verified by reasoning through the logic or by simulating the exclusion rather than requiring an actual non-macOS machine
- [ ] #4 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Lockfile-driven fix, scoped to test/main/licenses.test.js only (no changes to
src/assets/licenses.json or scripts/generate-licenses.js). package-lock.json
(lockfileVersion 3) carries os/cpu arrays on platform-restricted entries;
today exactly one exists (fsevents: os:["darwin"], optional, via
pm2->chokidar->fsevents). Implementation: matchesPlatformList() reproduces
npm's own os/cpu negation semantics; isInstallableOn() requires both os and
cpu to match; lockEntriesByName() maps lockfile keys to entries;
platformExcluded() marks a bundled entry excluded only if every one of its
lockfile entries fails to match the current platform/arch (conservative --
a package installable via any path stays counted). Assertion changed from
`bundled.length === installed.length + 1` to
`bundled.length === installed.length + 1 + excluded.length`, with excluded
names printed on failure. Added a membership check (every npm-ls-installed
package must appear in licenses.json) alongside the count so a balanced
count can't mask a swap. No hardcoded fsevents special-case -- fully
lockfile-metadata driven, so future platform-restricted deps are handled
automatically. AC#3 (cross-platform correctness without a real non-macOS
machine) is enforced in-suite: a new test re-runs the identical arithmetic
against the real npm-ls output with lockfile-restricted paths dropped for
linux/x64, win32/x64, and linux/arm64, asserting it balances on each and
that fsevents is actually in the excluded set on linux (non-vacuous) while
nothing is excluded on darwin (the generating platform). A second new test
pins the os/cpu matcher against synthetic entries covering npm's negation
rules.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Worker evidence (implementation phase): branch fix/NCOW-19-platform-aware-
license-count, commit a86b16b (fix(test): make license tree coverage
platform-aware), pushed to origin. Files touched: test/main/licenses.test.js
only (+116/-5).

npm test: 178/178 pass (up from 176 -- 2 new tests). licenses.test.js alone:
13/13 pass. Passes on this macOS machine against the current unmodified
79-entry licenses.json (AC#2).

Cross-platform arithmetic verified against the real npm-ls tree, filtered by
lockfile os/cpu restrictions per target platform:
  darwin/arm64: npm-ls=78 excluded=[]          old-expected=79 new-expected=79 actual=79  old PASS  new PASS
  linux/x64:    npm-ls=77 excluded=[fsevents]  old-expected=78 new-expected=79 actual=79  old FAIL  new PASS
  win32/x64:    npm-ls=77 excluded=[fsevents]  old-expected=78 new-expected=79 actual=79  old FAIL  new PASS
This confirms the reported bug was real (old assertion fails on a fresh
Linux/Windows install) and the fix balances on every platform without
touching licenses.json (AC#1, AC#3).

Worker flagged one known limitation for the record: libc restrictions
(musl/glibc) are not handled -- no lockfile entry currently carries one and
process exposes no reliable libc signal; would need extending if a
musl-restricted package enters the tree later. Also noted and reverted an
incidental unrelated package-lock.json change (npm had added a root
"license" field) that arrived pre-existing in the worktree -- not part of
this task's diff.

Next: dispatching opus review into the same worktree before merge.
<!-- SECTION:NOTES:END -->
