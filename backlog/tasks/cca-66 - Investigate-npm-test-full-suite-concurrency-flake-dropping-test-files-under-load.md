---
id: CCA-66
title: >-
  Investigate npm test full-suite concurrency flake dropping test files under
  load
status: To Do
assignee: []
created_date: '2026-08-17 16:02'
labels:
  - test-infra
  - bug
dependencies: []
priority: medium
ordinal: 84000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two independent reviewers in the wave-19 backlog campaign (2026-08-17, reviewing CCA-14.5 and the wave-19 integration cleanup) each independently hit a transient full-suite npm test failure: instead of the real 583/583, a run reported 563 tests / 561 pass / 2 fail. Both reviewers traced it: the two apparent failures were test/main/licenses.test.js and test/renderer/about-dialog.test.js (per CCA-14.5's worker) or test/main/licenses.test.js and test/main/menu.test.js (per the wave-19 cleanup reviewer) failing to load/register their tests at all under node --test's full-suite concurrency, each reporting as a single failing test while its real tests (15 in licenses.test.js, 7 in menu.test.js) silently vanish from the count. Both files pass cleanly every time when run in isolation. This is not a flaky assertion — it's a file-level load race, meaning an affected run's reported N/N-passing figure is genuinely smaller than the real suite, which could let a stale or incomplete run be mistaken for a full clean pass in a future session or PR review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Root cause identified: why specific test files (so far seen: licenses.test.js, about-dialog.test.js, menu.test.js) intermittently fail to load under node --test's full-suite concurrency, while passing cleanly in isolation every time
- [ ] #2 A fix or mitigation is implemented and proven non-vacuous by reproducing the failure before the fix and confirming it no longer reproduces after, across multiple full-suite runs
- [ ] #3 npm test passes with the real, complete test count with no unexplained file-load failures across at least 5 consecutive full-suite runs
<!-- AC:END -->
