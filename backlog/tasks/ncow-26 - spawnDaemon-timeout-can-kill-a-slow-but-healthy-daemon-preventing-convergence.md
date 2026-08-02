---
id: NCOW-26
title: 'spawnDaemon timeout can kill a slow-but-healthy daemon, preventing convergence'
status: To Do
assignee: []
created_date: '2026-08-02 21:07'
labels:
  - pm2
dependencies: []
priority: low
type: bug
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Non-blocking finding from NCOW-22's wave-6 review pass 2 (2026-08-02), accepted deliberately at the time as the lesser of two evils.

NCOW-22 fixed a real leak: spawnDaemon() previously never killed the child it spawned on its reject paths, so a persistently-failing bootstrap leaked one Electron-weight pm2 daemon per retry (reproduced live as 3 simultaneous orphans). The fix adds a best-effort child.kill() on every reject path, including the timeout path.

That introduces a narrower opposite failure mode. Pre-fix, a daemon that was simply SLOW — one that bound its sockets at, say, 15.1s, after the timeout had already fired — survived, and the next 5s status-poller tick's probeDaemonAlive() found it and skipped the spawn entirely. The system self-healed. Post-fix, that slow-but-healthy daemon is killed, so every retry restarts from zero and a machine that consistently needs longer than the timeout never converges: it spawns, times out, kills, and repeats indefinitely.

Risk is low in practice and this is why it was accepted rather than fixed inline: measured bootstrap was ~57ms locally and sub-second from the packaged macOS binary, against a 30s ensureConnected timeout. But 'low' is a measurement on fast developer hardware, not a guarantee for a cold, contended, or antivirus-scanned Windows machine — which is precisely the class of environment where this bug family already bit once.

The reviewer identified a clean, targeted mitigation: on the TIMEOUT path only (not onError, not onExit), await probeDaemonAlive() first and treat 'alive' as success instead of killing. That preserves the leak fix for genuinely failed spawns while letting a merely-slow daemon be adopted rather than destroyed.

Two related test-coverage gaps from the same review, worth folding in here rather than tracked separately:
- The new leak regression test (test/engine/pm2Control.test.js:276-295) leaks the very processes it detects when it FAILS: its finally block only rmSync's the PM2_HOME and never kills the pids it collected, so a future regression would leave real God daemons alive pointing at a just-deleted PM2_HOME. The sibling test at :238-244 does clean up its pid and is the pattern to follow.
- Only the timeout reject path is covered; onError and onExit share the same finish() helper so the marginal value is low, but the test's name promises more than it exercises.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The timeout path adopts a slow-but-healthy daemon instead of killing it (probe first, treat alive as success), while genuinely failed spawns are still killed so NCOW-22's leak fix is preserved
- [ ] #2 A regression test proves both halves: a daemon that becomes ready just after the timeout is adopted rather than killed, and a spawn that genuinely fails still leaves no orphan
- [ ] #3 The existing leak test's finally block terminates any pids it collected, so a failing run cannot leave real daemons alive pointing at a deleted PM2_HOME
- [ ] #4 npm test passes
<!-- AC:END -->
