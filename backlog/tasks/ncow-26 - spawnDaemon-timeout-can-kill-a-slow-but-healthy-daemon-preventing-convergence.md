---
id: NCOW-26
title: 'spawnDaemon timeout can kill a slow-but-healthy daemon, preventing convergence'
status: In Progress
assignee: []
created_date: '2026-08-02 21:07'
updated_date: '2026-08-03 02:26'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
On the spawnDaemon() TIMEOUT path only (not onError/onExit), await probeDaemonAlive({pm2Home})
before rejecting. If alive, adopt the daemon via the same resolve path onMessage uses (disconnect,
unref, resolve {pid: child.pid}) instead of killing it, preserving NCOW-22's leak fix for genuine
failures. Add an opts.spawn test-only override so tests can deterministically drive both branches
of the state machine without relying on real timing. Fix the existing leak regression test's
finally block to kill collected pids (matching the sibling test's pattern) and add two new tests
covering timeout-adopt and timeout-genuine-failure.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Wave 9 implementation complete, pushed to fix/NCOW-26-adopt-slow-daemon (commits ad4e232, 3739c67).
Independently verified by the orchestrator (not just the worker's self-report): both commits and
the branch exist on origin, diff vs dev touches only src/engine/pm2Control.js and
test/engine/pm2Control.test.js (147 lines, 2 files - no scope creep).

Evidence: npm test 246/246 passing (run twice for stability); node --test on the pm2Control test
file alone 16/16 passing including the two new tests, both completing in ~34ms deterministically
(a real net.createServer() bound on the resolved rpc.sock path, real probeDaemonAlive() exercised,
fake injected child so no real timing race) - one proves a daemon that's alive by the timeout is
adopted (resolves with the real pid, kill never called on the fake child), the other proves a
genuinely-dead spawn still gets killed and rejects (leak fix preserved). Manually confirmed no
orphaned daemon left running after the suite (the one "God Daemon" process found belongs to this
machine's real pre-existing ~/.pm2 daemon, ppid 1, unrelated to any temp PM2_HOME - left untouched
per project rules). AC1-4 all self-reported true; pending independent reviewer confirmation.

Note: the worktree has an unrelated, uncommitted package-lock.json diff (version string 0.1.0 ->
0.1.1, a pre-existing known drift noted since wave 3) left uncommitted by the worker as
out-of-scope - correct call, will not be merged.

Wave 9 review pass 1 (opus): request_changes. AC1-4 all independently confirmed via mutation
testing (disabling the adopt branch fails the new adopt test; forcing always-adopt fails both the
new "still kills" test AND the pre-existing real-process leak test, proving the leak test genuinely
routes through the new onTimeout branch) and two full local npm test runs (246/246 both times).

Blocking finding (medium): the leak regression test's finally block only populates `leaked` on the
happy path (after `assert.rejects` succeeds at :286) - if that assertion itself throws ("Missing
expected rejection"), finally runs with `leaked` still empty, killing nothing before deleting
PM2_HOME, so real daemons survive pointing at a deleted directory - exactly what AC#3 exists to
prevent. Reviewer reproduced this live 3 times via mutation testing (real orphaned "God Daemon"
processes at pids 40487/41629/42597, each pointing at an already-deleted PM2_HOME), killed them by
hand, confirmed clean afterward. Fix: have the finally block re-derive the live set via the
existing liveDaemonChildren() helper (ppid-filtered, so it can never touch the user's real shared
daemon) unioned with `leaked`, rather than trusting a variable only assigned on the success path.

Two low-severity non-blocking polish items also noted: (1) the new adopt test's comments overstate
the scenario timing (server.listen() actually completes before spawnDaemon is even called, not
mid-flight as the comment implies - AC#2 still holds since spawnDaemon only ever probes at timeout,
but the comment should be reworded); (2) the adopt path resolves with a bare child.pid rather than
following onMessage's `msg?.pid ?? child.pid` precedence - inert today (only caller discards the
value) but worth a comment for future callers.

Scope check: clean, exactly the 2 expected files, no drive-by changes. No overlap with sibling wave
tasks' files; reviewer flagged one semantic (not textual) adjacency to watch post-rebase -
engine-context.js (NCOW-23's territory) is the sole production wiring point for spawnDaemon, so
re-run the full suite after rebase rather than assuming file-disjointness alone is sufficient.

Fix pass 1 complete, pushed (commit b3f1682, verified against origin). Blocking finding addressed:
leak test's finally now kills the union of `leaked` and liveDaemonChildren() (ppid-filtered, cannot
touch the real shared daemon) instead of trusting `leaked` alone. Worker reproduced the exact
failure mode via a standalone repro (spawnDaemon resolving instead of rejecting, triggering
assert.rejects to throw "Missing expected rejection" before `leaked` gets populated) and confirmed:
old logic left a real orphan daemon running pointing at a deleted PM2_HOME; new logic killed it via
liveDaemonChildren(). Both polish items also addressed (test comment accuracy, pid-fidelity
comment on the adopt path). npm test 246/246. Pending review pass 2.

Wave 9 review pass 2 (opus): approve. All 4 ACs re-confirmed. Blocking finding from pass 1
independently verified fixed via two separate reproductions: (1) copy-based A/B from the exact
committed pre-fix vs post-fix finally blocks - pre-fix left a real orphan daemon pointing at a
deleted PM2_HOME every time, post-fix left zero; (2) a stronger source-mutation 2x2 directly
against the on-disk files (mutating pm2Control.js's alive-check with each of the two historical
test-file versions in place) - causally isolates the fix as the only variable, confirms the
ppid-filter in liveDaemonChildren() genuinely matches at finally-time (not a no-op), and rules out
a process.title race against pm2's Daemon.js (title is set at module load, well before any
ready-signal). Both polish items confirmed addressed in the actual current text. npm test 246/246
(run twice). Scope unchanged: exactly 2 files across all 3 commits. Reviewer's own test artifacts
and orphan processes fully cleaned up, machine left in its original state (only the user's real
pid 1479 ~/.pm2 daemon remains, untouched throughout both review passes).

Approved and ready for the merge queue once the rest of wave 9 settles.
<!-- SECTION:NOTES:END -->
