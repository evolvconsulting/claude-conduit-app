---
id: NCOW-31
title: 'Serialize config-regeneration''s proxy restart, and retry a failed regeneration'
status: Done
assignee: []
created_date: '2026-08-04 06:27'
updated_date: '2026-08-04 19:24'
labels:
  - pm2
  - packaging
dependencies: []
priority: low
type: bug
ordinal: 44000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found independently by both NCOW-30's opus reviewers (2026-08-04), across
its two review passes.

NCOW-30 added a launch-time stale-config regeneration mechanism
(configGen.js's regenerateStaleConfig(), wired into
src/main/engine-context.js) that, when a currently-running proxy is
detected, calls pm2Control.startOrRestart() in the background to pick up
the regenerated config. Two related gaps in that restart path were
deliberately deferred out of NCOW-30's own fix pass as out of scope for a
single-task fix:

1. **Not serialized behind ipc.js's proxy-domain mutex.** Every other
   proxy-affecting operation in this app (start/stop/restart via the
   renderer) goes through a mutex constructed inside ipc.js at module scope
   (`mutexes` at ipc.js:38). engine-context.js's background restart calls
   pm2Control.startOrRestart() directly, with no shared reference to that
   lock -- engine-context.js cannot simply `require('./ipc')`, because
   ipc.js pulls ipcMain/app/shell from electron at module scope and
   engine-context.js is required directly by several plain `node --test`
   suites that have no Electron runtime. A real fix needs a new
   electron-free mutex module (or equivalent shared primitive)
   engine-context.js and ipc.js can both construct/reuse, not a one-line
   change. Without it, a race is possible: an upgrade launch that finds the
   proxy already running, PLUS a user clicking Stop (or quitting the app)
   inside the up-to-60s health-check window of the background restart,
   could interleave with that restart. Both reviewers judged the practical
   blast radius small and recoverable (e.g. a Stop that doesn't stick,
   visible on the status pill) -- not a data-loss or security issue, but a
   real correctness gap worth closing.

2. **A failed restart is never retried.** regenerateStaleConfig() stamps
   manifest.json's `generated_by_version` BEFORE attempting the restart, so
   if the restart fails (or times out), the next app launch sees the
   manifest as already current and skips regeneration entirely --
   permanently, until something else changes the running app's version
   again. Compounding this, the current failure-logging (added in NCOW-30's
   fix pass) only fires on a genuine throw from pm2Control.startOrRestart();
   it does NOT inspect that function's other failure shape, a normal
   returned `{ ok: false, error: { code: 'HEALTH_CHECK_TIMEOUT' } }` (see
   pm2Control.js's startOrRestart(), ~line 404) -- so a health-check timeout
   during a background restart is currently silent AND non-retried.

Fixing these together makes sense since both live in the same
regenerateStaleConfig()/startOrRestart() call path and a shared "did the
restart actually succeed" signal is useful for both (only stamp
generated_by_version -- or otherwise mark regeneration complete -- after a
confirmed-successful restart, and log/distinguish a timeout-shaped failure
from a thrown error).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The background restart triggered by stale-config regeneration is serialized against the same proxy-domain mutex ipc.js already uses for user-initiated start/stop/restart, so the two can never interleave
- [x] #2 A failed or timed-out restart (both the thrown-error shape and pm2Control.startOrRestart()'s {ok:false, error} return shape) is logged distinctly from success, and does NOT cause generated_by_version to be stamped -- so the next app launch retries regeneration instead of silently treating it as done
- [x] #3 A regression test covers: (a) the mutex actually prevents an interleaved user-initiated proxy operation during a background restart, (b) a failed/timed-out restart is retried on the next launch rather than silently skipped
- [x] #4 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Verify the mutex.js extraction left by a crashed prior worker session is complete and correct (electron-free FIFO per-domain mutex module) -- do not rewrite it.
2. Finish wiring src/main/ipc.js: accept an injected mutex set via opts.mutexes; invert the prior worker's SERIALIZED_METHODS allowlist to an UNSERIALIZED_METHODS denylist (proxy.getStatus/getRecentLogs only) so any proxy method added later is serialized by default rather than silently unlocked -- the allowlist form would have shipped a real regression (unlocking start/stopLogTail, which mutate engine-context's single logTailUnsubscribe slot).
3. Wire src/main/index.js to actually pass the shared mutex set through to registerIpcHandlers -- without this the whole mechanism is inert in the real app (registerIpcHandlers would build its own private lock set).
4. engine-context.js creates the shared mutexes, exposes them (context.mutexes), and injects a runProxyOperation bound to mutexes.proxy.run into configGen.regenerateStaleConfig() -- the status read (getStatus) is inside the SAME critical section as the restart, not just the restart, so a Stop landing between the read and the restart can't race it.
5. configGen.js: stamp generated_by_version only after a confirmed-successful restart; recognize and distinctly log both failure shapes (a thrown error, and pm2Control.startOrRestart()'s {ok:false,error} return, e.g. HEALTH_CHECK_TIMEOUT) instead of only the thrown-error shape.
6. Deliberately leave shutdown.js's before-quit proxy stop UNSERIALIZED against this lock -- queueing it behind a background restart that can hold the lock for up to 60s would make the app unquittable while wedged, which CLAUDE.md forbids outright. Documented as a deliberate choice, not a silent gap.
7. Regression tests for both ACs, including a negative control proving the pre-fix code actually interleaves (so the test measures the lock, not luck), and mutation-testing 10 distinct reverts against the new tests.
8. npm test, commit in 2 logical commits, push.

9. Fix pass 1 (responding to review pass 1's request_changes): wrap the tray's Start/Stop/Restart callbacks in src/main/index.js with the same mutexes.proxy.run(...) lock already shared between ipc.js and engine-context.js's background restart (fixes blocking finding B1). Correct the shutdown.js-exclusion comment in engine-context.js to describe the actual inverted worst case (proxy can outlive quit, not just 'a Stop that doesn't stick'). Guard the thrown-value logging in configGen.js's regenerateStaleConfig() so a thrown non-Error no longer logs '(undefined)'. Add regression coverage for the tray path and mutation-test it; reword rather than delete the old negative-control test now that no real call path is unlocked.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented on fix/NCOW-31-serialize-config-regen-restart (dev @ 6d0c0ce), commits 5e263eb (mutex extraction) + ec4e676 (serialization + retry fix), pushed. Continued a prior worker session that crashed mid-implementation on a connection error -- its src/main/mutex.js was verified complete/correct and kept as-is; its in-progress ipc.js wiring was finished and hardened (allowlist inverted to a fail-safe denylist).

AC#1 (mutex serialization): npm test 331/331 (295 baseline + 36 new), 5 consecutive clean runs, no flake. test/main/ipc-mutex.test.js seeds require.cache with a fake electron so the REAL registered ipc.js handlers are driven, not a source regex -- proves start/stop/restart serialize against each other and against a background op holding an injected lock, while getStatus/getRecentLogs still resolve mid-restart (the blank-window requirement). test/main/engine-context-config-regen.test.js drives the real createEngineContext end-to-end: a user-initiated stop cannot interleave with an in-flight background restart (asserted exact event order), and a lock pre-held before createEngineContext runs blocks regeneration from even reaching getStatus until released. A NEGATIVE CONTROL confirms the identical scenario against the pre-fix handler actually interleaves, so the test measures the lock, not luck.

AC#2 (retry-safe stamping, both failure shapes): thrown-error path logs reason 'restart-error', never calls saveManifest, manifest.json on disk stays unstamped; the {ok:false,error:{code:'HEALTH_CHECK_TIMEOUT'}} shape (previously never even inspected) logs 'restart-failed' with the error code preserved, also unstamped; a third falsy-ok-with-no-error shape logs 'RESTART_FAILED' rather than any 'undefined' string. Retry verified at both configGen and engine-context level across three successive fresh contexts reading the same manifest.json back off disk (fail -> still stale -> retry succeeds -> up-to-date). Retry idempotency pinned: a failed restart's already-regenerated files are byte-identical on the successful retry and LITELLM_MASTER_KEY is preserved (a rotation here would silently break Claude Desktop/Code configs carrying the old key).

AC#3 (regression tests): see AC#1/#2 evidence above -- both (a) and (b) covered with negative controls. Mutation-tested 10 distinct reverts (ipc.js ignoring injected mutexes; unlocking proxy start/stop; locking getStatus/getRecentLogs; unlocking testConnection/log-tail; configGen bypassing runProxyOperation; engine-context omitting the injection; restamping before the restart -- the original bug; ignoring the {ok:false} shape -- the other half of the bug; the mutex chain dropping its .catch(()=>{}) error-swallow; index.js stopping passing mutexes through) -- each caught by a specific test, none silent.

AC#4: npm test 331/331.

Reviewer-anticipating checks already run: confirmed a thrown error during the restart still releases the mutex (no explicit release to leak, via .catch(()=>{}) on the chain) across async throw, sync throw, .run() rejection, and a throwing IPC handler not wedging a queued background op. Confirmed mutex.js imports with ZERO require() calls (asserted programmatically, comments stripped first since the header prose legitimately names 'electron' while explaining why the module itself never may) and that requiring engine-context.js never puts an electron entry in require.cache.

Two items flagged transparently by the implementer for reviewer attention:
1. src/main/index.js was touched (8 lines) despite being outside the task's stated file scope -- necessary because without it registerIpcHandlers builds its own private lock set and the entire mechanism is inert in the real app.
2. shutdown.js's before-quit proxy stop was deliberately left UNSERIALIZED against this lock -- queueing it behind a background restart holding the lock for up to 60s would make the app unquittable while wedged, which CLAUDE.md forbids outright. Left as a documented deliberate choice in engine-context.js, not a silent gap; covering quit too would need its own task and a different mechanism (cancel the in-flight restart rather than queue behind it).

Also fixed two pre-existing test fakes that returned undefined from startOrRestart() (which the new {ok:false} handling correctly read as failure) to return the real {ok:true} contract instead of accommodating the wrong shape, per CLAUDE.md's standing warning about a fake masking a real bug.

No live proxy/winvm run -- pure concurrency/logic fix, tested via the same mocking patterns pm2Control.test.js/engine-context-config-regen.test.js already use.

Opus review pass 1: request_changes. Independently confirmed AC#2/#3/#4 with fresh evidence (own 7-mutation negative-control battery, own npm test run 331/331, 13 adversarial AC#2 failure-shape probes including throw null/undefined/bare-string/0, {} with no .error, a rejected promise with no .error, getStatus throwing -- all correctly left the manifest unstamped and the lock free). AC#1 confirmed for the IPC/window surface but NOT for the tray: BLOCKING finding B1 -- src/main/index.js wires the tray's Start/Stop/Restart directly to handlers.proxy.*(), bypassing ipcMain and therefore the mutex entirely; tray.js only enables Stop/Restart while status is running, i.e. exactly when the background regeneration restart's precondition holds, so a tray Stop inside the restart's health-check window still interleaves. The branch's OWN negative-control test (asserting interleaving without the shared lock) calls the exact same code path the tray uses, unnoticed. Pre-existing on dev, but AC#1 says 'can never interleave' and the fix is ~3 lines (wrap the three tray callbacks in mutexes.proxy(...)) in a file already touched this task.

Both implementer-flagged items resolved: (1) index.js scope expansion verified TRUE and proportionate -- reverting it alone drops ipc-mutex.test.js to 10/11, and confirmed createDomainMutexes() is called inside registerIpcHandlers (not module scope), so no accidental second-instance risk. Accepted. (2) shutdown.js exclusion accepted as the correct call (probed a permanently-hung startOrRestart(): the quit path still settles in 402ms via its own timeout, serializing it would violate CLAUDE.md's unquittable-app prohibition outright) -- but flagged non-blocking that the code comment understates the residual: the real worst case is inverted from what's documented (if shutdown's stop() lands between the restart's deleteAppIfPresent() and pm2.start(), the proxy can outlive the quit, contradicting NCOW-4) -- a millisecond window, recoverable, pre-existing on dev, worth a follow-up task + comment correction, not a blocker for this task.

Other non-blocking findings: UNSERIALIZED_METHODS confirmed load-bearing (renderer/app.js awaits proxy.getStatus() before routing; locking it would blank the window for the whole ~90s+ worst-case hold on exactly the upgrade launch this feature exists for) -- not defensive complexity. No watchdog on the background restart itself (pre-existing property of the mutex primitive, not introduced by this task). A thrown non-Error logs literal '(undefined)' -- cosmetic, pm2Control only ever throws real Errors. DESIGN.md/README don't yet record the deliberate shutdown carve-out -- no docs touched this pass.

Live verification (project standard): seeded a stale pre-NCOW-30 install under a fake home, launched real electron --dev under NIM_PROXY_TEST_HOME, observed no blank window and the new '[config-regen] regenerated config...' log line firing for real; fake-home manifest gained generated_by_version with all other fields intact; real config dir SHA-256-identical before/after that run.

INCIDENT (surfaced to and acknowledged by the user separately, recorded here for the task's own audit trail): during an EARLIER, separate manual verification step in this same review pass, a node -e invocation passed a variable as a shell argument instead of an env var, so NIM_PROXY_TEST_HOME was silently not applied and generateAll() ran against the REAL ~/.config/claude-conduit/ directory, rewriting config.yaml/ecosystem.config.cjs/run.js/litellm.env and manifest.json. No proxy was running before or during (confirmed no litellm-nim pm2 entry existed). Restored via the app's own generateAll()/writeManifest() using parameters recovered from the app's own historical logs; LITELLM_MASTER_KEY preserved by design (resolveMasterKey() reuses whatever's on disk); NVIDIA_NIM_API_KEY (which WAS clobbered with a fake value mid-incident) restored from the repo .env. generated_by_version deliberately left absent in the restored manifest (harmless -- self-heals on next launch, which is NCOW-30's own designed behavior). logs/, the Electron-userData encrypted key, and Claude Desktop/Code configs (never wired) were never touched. Orchestrator independently spot-verified the restored directory afterward (file presence/timestamps, manifest field values, litellm.env key presence) rather than trusting the report alone; user reviewed and confirmed satisfied. The later live-verification run above was redone correctly under NIM_PROXY_TEST_HOME with a hard path assertion.

Fix pass 1 evidence: wrapped all three tray proxy callbacks in index.js with mutexes.proxy.run(...). New behavioral test in engine-context-config-regen.test.js reproduces the tray's exact call shape against a real createEngineContext() and asserts it serializes against an in-flight background restart. New static source-check test asserts index.js's actual createTray({...}) call site uses the wrapping (index.js itself can't be required under plain node --test, same electron-at-module-scope constraint as existing index.js source-check tests). Mutation-tested: reverting just the tray-wrapping change makes the new static-check test fail (not ok 17), nothing else. The old negative-control test (previously mislabeled as testing 'the pre-NCOW-31 world' / the tray's real path) was reworded rather than deleted -- it now documents itself as a pure methodology check, since no real app call path is unlocked anymore post-fix. npm test 333/333 (331 baseline + 2 new); mutex.test.js and ipc-mutex.test.js specifically re-confirmed green. Non-blocking fix #1: engine-context.js's shutdown-exclusion comment corrected to describe the actual inverted worst case (deleteAppIfPresent() -> pm2.start() gap can let the proxy outlive quit, contradicting NCOW-4 -- not merely 'a Stop that doesn't stick'), comment-only, no behavior change. Non-blocking fix #2: configGen.js's regenerateStaleConfig() thrown-value logging now guarded via attempt.thrown?.message ?? String(attempt.thrown), so a thrown non-Error no longer logs the literal '(undefined)'. Commits b08e7c4 (tray fix + tests) + e1c467b (the two comment/logging fixes), pushed. No backlog CLI run by the worker; no live app run needed.

Opus review pass 2 (final -- approve, all 4 ACs independently confirmed): verified the tray mutex fix (B1) is genuinely closed via two independent live harnesses beyond the branch's own tests -- a bidirectional lock-sharing probe against the real ipc.js (tray-shaped Restart blocks IPC Stop and vice versa, in both orders, while getStatus still resolves mid-hold) and a 120-iteration randomized-interleaving fuzz against the real createEngineContext + shared lock with ZERO interleaves (negative control on the pre-fix unwrapped call interleaves on iteration 5). Structural reason it's airtight: regenerateStaleConfig()'s runProxyOperation() call happens synchronously before its first await, so the background restart is already enqueued in the FIFO during createEngineContext() itself, before createTray() even exists -- a tray click structurally cannot get to the front of the queue first. Confirmed the fix-pass-1 mutation claim (not ok 17 on reverting the tray wrap) is real, and additionally found the new static source-check test, while real, has one residual identity gap: a contrived mutation that shadows the mutex set in a nested scope around createTray({...}) passes all 333 tests on genuinely broken (fully unlocked) code. Confirmed no other pm2-proxy-mutating call path was missed by the tray-only fix regarding the ORIGINAL blocking finding (shutdown.js's exclusion was already reviewed/accepted as deliberate) -- but surfaced a real non-blocking finding while sweeping: the 'uninstall' and 'update' IPC domains have NO mutex at all (MUTEX_DOMAINS is only proxy/config/claudeDesktop/claudeCode), so Uninstall and the auto-update's own proxy-stop call are both unserialized against the background restart, arguably worse blast-radius than the shutdown carve-out (Uninstall's pm2Control.remove() racing an in-flight pm2.start() could leave a running proxy behind after 'uninstall complete'). Both pre-existing on dev, outside AC#1's literal user-initiated-start/stop/restart wording -- non-blocking, good follow-up-task candidate.

Also found the fix-pass-1 comment correction (engine-context.js's shutdown-exclusion) got the RIGHT conclusion (proxy can outlive quit, contradicting NCOW-4) via a slightly WRONG mechanism -- shutdown.js's stop() actually checks getStatus() first and is skipped entirely (not errored-and-swallowed) when landing in the delete-to-start gap, since getStatus() reports not-installed there; and the real window is wider than 'milliseconds' (spans the full getStatus+delete round-trip against the pm2 daemon, which autoUpdate.js's own comments elsewhere note can take 1s+). Non-blocking, comment-only nuance. The (undefined)-logging fix (F5) was independently probed with 12 adversarial thrown values -- genuinely fixed for every real case pm2Control can produce, with one contrived-edge-case regression noted (throw Object.create(null) now makes String() itself throw, rejecting regenerateStaleConfig() rather than logging a cosmetic string) -- harmless in practice since engine-context.js's own .catch() absorbs it and the manifest still correctly stays unstamped, but flagged as a one-line residual (util.inspect() would be more robust than String()). DESIGN.md/README still don't record the shutdown carve-out (pass 1's finding, still open, no docs touched either pass).

Integration check (light, campaign-final): confirmed the fix-pass delta (~13 changed source lines total) doesn't touch any NCOW-21/24/23/30 code paths -- npm test 333/333, re-run independently twice plus once more under a mutation. Real ~/.config/claude-conduit/ SHA-256-verified identical before and after every live-harness run this pass (all harnesses stayed in scratchpad, none written to the repo, all hard-asserted their resolved config dir was the fake mkdtemp home before writing anything).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Extracted the per-domain proxy mutex from ipc.js into a new electron-free shared module (src/main/mutex.js) so both ipc.js and engine-context.js's launch-time stale-config regeneration can construct/share the same lock -- closing the race where a background restart (triggered by NCOW-30's regeneration mechanism) could interleave with a user-initiated proxy start/stop/restart. generated_by_version is now stamped only after a confirmed-successful restart; both failure shapes (a thrown error, and pm2Control.startOrRestart()'s {ok:false,error} return e.g. HEALTH_CHECK_TIMEOUT) are distinctly logged and correctly leave the manifest unstamped so the next launch retries. Two opus review passes: pass 1 request_changes -- found the tray's Start/Stop/Restart bypassed the mutex entirely (index.js wired them directly to the handlers, no lock), a real reachable interleave; fix pass wrapped the tray callbacks in the same lock plus corrected two non-blocking comment/logging issues. Pass 2 approve, all 4 ACs independently confirmed, including a 120-iteration randomized-interleaving fuzz against the real shared lock (zero interleaves; the pre-fix negative control interleaves reliably) and 12 adversarial thrown-value probes for the retry-logging fix. npm test 333/333, re-verified after rebase. Squash-merged PR #23 -> dev @ d0e2362. Non-blocking follow-ups surfaced by review, not yet filed pending user decision: the uninstall/update IPC domains have no mutex at all (Uninstall's pm2Control.remove() could race an in-flight background restart); a comment-only nuance on the shutdown-race window's actual mechanism; README/DESIGN.md don't yet record the deliberate shutdown-mutex carve-out.
<!-- SECTION:FINAL_SUMMARY:END -->
