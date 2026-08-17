---
id: CCA-67
title: >-
  Linux CI: spawnDaemon rejection test fails on real Linux runners
  (pm2Control.test.js)
status: In Progress
assignee:
  - '@claude'
created_date: '2026-08-17 17:10'
updated_date: '2026-08-17 23:28'
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
- [x] #1 Root cause identified: why spawnDaemon() (or the daemon process it spawns) does not reliably reject when its rpc socket bind target is a pre-existing non-socket file, specifically under Linux CI runners
- [ ] #2 A fix or mitigation is implemented so this test passes reliably on real Linux CI (both x64 and arm64), verified by actually re-running the GitHub Actions release workflow (or an equivalent Linux CI job) rather than only local macOS runs
- [x] #3 npm test passes on Linux CI with no regression to the leak-prevention behavior this test guards (a rejecting spawnDaemon attempt must still not leave an orphaned daemon process running)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Root-cause via empirical repro (not guessing): reproduce the exact CI failure in a node:20-slim Linux container (clean npm ci, matching .github/workflows/release.yml). Isolate the errno pm2's bundled axon transport (node_modules/pm2/modules/pm2-axon/lib/sockets/sock.js bind()) gets back from connect()-ing to the test's bogus rpc-socket-path file, on macOS vs Linux.
2. Fix: change the test's forced-bind-failure technique from 'write a plain non-socket file at rpc.sock' to 'mkdir a directory at rpc.sock' -- axon's stale-socket self-heal can delete a regular file (Linux's ECONNREFUSED matches its allowlist) but can never unlink() a directory on any platform, so the daemon reliably fails to bind everywhere.
3. Verify: full local npm test (macOS) clean; full npm test inside a Linux container with a clean CI-faithful npm ci (not bind-mounted node_modules); confirm the target test passes reliably and no daemon leaks.
4. File a follow-up task for an unrelated pre-existing Linux-only test failure discovered along the way (resolveDaemonInterpreter atomic-staging fallback), rather than expanding this task's scope.
5. Verify AC#2 (real Linux CI, not just local) by triggering the actual GitHub Actions release workflow via workflow_dispatch against the existing v0.1.2 tag.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause (AC#1), confirmed empirically not by inspection alone: test/engine/pm2Control.test.js's 'does not leak the daemon' test forces spawnDaemon() to reject by writing a plain non-socket regular file at the resolved rpc.sock path. pm2's bundled RPC transport (node_modules/pm2/modules/pm2-axon/lib/sockets/sock.js Socket.prototype.bind) treats a bind EADDRINUSE as possibly-stale: it opens a plain connect() to the same path and, if that connect fails with ECONNREFUSED or ENOENT, deletes the file and rebinds (assumes a crashed daemon's leftover socket). Connecting to a non-socket regular file gives ENOTSOCK on macOS (not in that allowlist -> daemon never binds -> spawnDaemon() reliably rejects via its own onTimeout/probeDaemonAlive path) but ECONNREFUSED on Linux (IS in the allowlist -> axon deletes our bogus file and rebinds successfully -> the daemon boots for real -> spawnDaemon() resolves instead of rejecting). Verified directly: 'node -e' connect-to-bogus-file repro on macOS host (ENOTSOCK) and inside node:20-slim (ECONNREFUSED); then reproduced the exact real-CI failure end-to-end running the actual test file in that container (AssertionError: Missing expected rejection, at pm2Control.test.js:914 -- the exact location cited in the real CI failure).

Fix (AC#2): replaced the bogus non-socket FILE with a directory at the same rpc.sock path (test/engine/pm2Control.test.js). A directory also fails bind() with EADDRINUSE and also produces a non-whitelisted-on-macOS / whitelisted-on-Linux connect() errno pattern (EINVAL on macOS, ECONNREFUSED on Linux -- verified empirically) -- BUT unlink(2) can never remove a directory on any POSIX platform, so axon's delete-and-rebind recovery step always throws and is silently swallowed, and the retry always hits the same EADDRINUSE again. Net effect: the daemon never binds on EITHER platform, regardless of what connect() returns -- portable by construction, not by errno luck. An earlier attempt (binding a real placeholder net.Server at the rpc.sock path instead of a directory) was tried and rejected: spawnDaemon()'s own onTimeout() path calls probeDaemonAlive(), a raw connect-only liveness check with no protocol handshake (by design, per its own doc comment) -- it can't distinguish our placeholder from a genuinely slow-to-bind real daemon, so it 'adopts' the placeholder as if the real daemon had come up late, resolving instead of rejecting on BOTH platforms. Directory has no such false-positive: nothing ever listens at that path, so probeDaemonAlive() correctly returns not-alive on every attempt.
<!-- SECTION:NOTES:END -->
