---
id: CCA-67
title: >-
  Linux CI: spawnDaemon rejection test fails on real Linux runners
  (pm2Control.test.js)
status: To Do
assignee: []
created_date: '2026-08-17 17:10'
labels:
  - test-infra
  - bug
  - linux
dependencies: []
priority: high
ordinal: 85000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Discovered 2026-08-17 during CCA-63's real release attempt (tag v0.1.2): the release workflow's Linux jobs (both ubuntu-latest/x64 and ubuntu-24.04-arm/arm64) failed npm test at test/engine/pm2Control.test.js:914, 'spawnDaemon: a rejecting attempt does not leak the daemon it spawned (review finding #1 regression)'. The test writes a bogus non-socket file at the daemon's resolved rpc socket path, then calls spawnDaemon() three times expecting every attempt to reject (since the daemon cannot bind its socket over a non-socket file). On real Linux CI runners, the assertion failed with 'Missing expected rejection' -- spawnDaemon() apparently resolved (or hung past its own rejection path) at least once instead of rejecting as it reliably does on this campaign's macOS development/review environment. This is a genuine platform behavior difference (not a flake in the sense of intermittent timing noise observed so far -- it failed on BOTH Linux runners, x64 and arm64, in the same CI run), and it blocks any real release build from succeeding on Linux, since a failed npm test aborts that platform's build+publish step entirely. This campaign's test suite had never previously been run on real Linux CI before this release attempt -- every prior 'npm test passing' claim across this whole campaign was verified on macOS only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Root cause identified: why spawnDaemon() (or the daemon process it spawns) does not reliably reject when its rpc socket bind target is a pre-existing non-socket file, specifically under Linux CI runners
- [ ] #2 A fix or mitigation is implemented so this test passes reliably on real Linux CI (both x64 and arm64), verified by actually re-running the GitHub Actions release workflow (or an equivalent Linux CI job) rather than only local macOS runs
- [ ] #3 npm test passes on Linux CI with no regression to the leak-prevention behavior this test guards (a rejecting spawnDaemon attempt must still not leave an orphaned daemon process running)
<!-- AC:END -->
