---
id: CCA-68
title: >-
  Windows CI: static-source regex test in ipc-mutex.test.js likely broken by
  CRLF checkout (index.js mutex-wiring guard)
status: Done
assignee:
  - '@claude'
created_date: '2026-08-17 17:10'
updated_date: '2026-08-18 01:59'
labels:
  - test-infra
  - bug
  - windows
dependencies: []
priority: high
ordinal: 86000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Discovered 2026-08-17 during CCA-63's real release attempt (tag v0.1.2): the release workflow's windows-latest job failed npm test at test/main/ipc-mutex.test.js:956, "index.js: passes engine-context's own mutexes into registerIpcHandlers". This test reads src/main/index.js's raw source text and matches it against two regexes, the second being /registerIpcHandlers\([\s\S]*?\n\s*mutexes,\n\s*\}\);/ -- a pattern that relies on literal LF (\n) characters at specific points. On Windows CI the assertion failed with "must pass those same mutexes to registerIpcHandlers". The leading hypothesis (not yet confirmed by direct inspection of the actual failing text) is that git's checkout on windows-latest converts this repo's LF line endings to CRLF, and the regex's literal \n expectations no longer line up against the resulting CRLF-separated text the way they do when the same file is read on macOS/Linux. This is a genuine platform-specific test-authoring gap (a static-source-text assertion that implicitly assumes a specific line-ending convention), not a flake -- it failed deterministically on this run's single windows-latest job, blocking any real release build from succeeding on Windows. This campaign's test suite had never previously been run on real Windows CI before this release attempt -- every prior "npm test passing" claim across this whole campaign was verified on macOS only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Root cause confirmed by direct inspection (e.g. actually diffing the file's bytes/line-endings as checked out on a real Windows runner, or reproducing locally with a CRLF-converted copy of index.js)
- [x] #2 A fix is implemented so this test (and any sibling static-source-text test using the same pattern, if others exist) passes reliably regardless of the checked-out file's line-ending convention
- [x] #3 npm test passes on real Windows CI, verified by actually re-running the GitHub Actions release workflow (or an equivalent Windows CI job) rather than only local macOS/Linux runs
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Confirm root cause: no .gitattributes forces LF, so windows-latest checkout autocrlf-converts to CRLF; reproduce locally with a CRLF-converted copy of index.js against the exact regex.
2. Grep test/ for sibling static-source regexes containing literal \n; verify each against a CRLF copy before assuming brittleness (auto-update-wiring.test.js:60 looked similar but its \n is \s*-padded on both sides, confirmed CRLF-tolerant by direct test — no fix needed there).
3. Fix ipc-mutex.test.js:965 by normalizing CRLF->LF on the read source before matching (lower blast radius than a repo-wide .gitattributes change).
4. Add a windows-latest leg to .github/workflows/test.yml (never touch release.yml, which auto-publishes) to get real Windows CI signal via a PR.
5. Verify locally (npm test) and on the real GitHub Actions run before checking ACs.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC1: Reproduced locally — regex against LF src/main/index.js matches; against a CRLF-converted copy (simulating windows-latest's autocrlf checkout, no .gitattributes present to force LF) it fails. Root cause: literal \n right after 'mutexes,' has no \s* padding to absorb the preceding \r. Grepped test/ for other assert.match(...\n...) static-source regexes; found one look-alike (auto-update-wiring.test.js:60) but its \n instances are both \s*-padded and verified CRLF-tolerant by the same repro technique — left unchanged.

AC2: Fixed by normalizing CRLF->LF on the read source in ipc-mutex.test.js before matching (lower blast radius than a repo-wide .gitattributes rule). Local npm test: 583/583 pass.

AC3: Added windows-latest to the existing publish-free .github/workflows/test.yml matrix (release.yml untouched — it auto-publishes on the same job as its test step). PR #79's real run: https://github.com/evolvconsulting/claude-conduit-app/actions/runs/32090051061 — windows-latest job passed, 585 tests/577 pass/0 fail/8 skipped, target test 'index.js: passes engine-context's own mutexes into registerIpcHandlers' (ok 442) passed. ubuntu-latest and ubuntu-24.04-arm also passed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Windows CI (windows-latest) checked this repo out with CRLF line endings (no .gitattributes forces LF), breaking ipc-mutex.test.js's static-source regex: its second literal \n had no \s* padding to absorb the preceding \r. Root cause confirmed by direct local repro against a CRLF-converted copy of index.js. Fixed by normalizing CRLF->LF on the read source before matching (scoped to this one test; a sibling-looking regex in auto-update-wiring.test.js was checked and confirmed already CRLF-tolerant, not touched). Added a windows-latest leg to the existing publish-free test.yml workflow; PR #79's real CI run passed on windows-latest (585 tests, 577 pass, 0 fail, 8 skipped, target test passing) as well as ubuntu-latest and ubuntu-24.04-arm. Local npm test: 583/583 pass.
<!-- SECTION:FINAL_SUMMARY:END -->
