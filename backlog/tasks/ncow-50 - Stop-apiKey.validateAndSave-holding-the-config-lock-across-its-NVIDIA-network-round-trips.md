---
id: NCOW-50
title: >-
  Stop apiKey.validateAndSave holding the config lock across its NVIDIA network
  round trips
status: In Progress
assignee: []
created_date: '2026-08-05 17:04'
updated_date: '2026-08-05 23:13'
labels:
  - concurrency
dependencies:
  - NCOW-47
ordinal: 63000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The wave-8 integration review of NCOW-47 measured an emergent hazard NCOW-47 introduced, and proved it causal with a pre-NCOW-47 counterfactual probe (deleting only DOMAIN_MUTEX_ALIASES.apiKey and re-running the identical sequence makes the freeze vanish entirely). NCOW-47 correctly identified that secretStore.save()/clear() must serialize against config.generate's secretStore.load(). But it took the lock around the WHOLE handler, and apiKey.validateAndSave (src/main/engine-context.js:263-289) awaits nvidiaKey.validateApiKey BEFORE it writes anything — up to two sequential 10s AbortController windows (src/engine/nvidiaKey.js:55 fetchModels, then :80 probeCompletion). That makes config the first lock in this app with a network-bound holder. Composed with NCOW-45's deliberate hold-and-wait in withLocks (src/main/ipc.js:315-338 — reserve every slot synchronously, hold all of them until fn settles, which is the right call for multi-lock fairness), a long hold on ANY ONE of uninstall's three locks becomes a hold on ALL THREE. Reproducing case, measured: a configured user re-enters #setup and clicks Validate Key while offline or against a slow endpoint; validateAndSave holds config for up to ~20s; they navigate to #uninstall and confirm; uninstall:run reserves claudeCode+config+proxy synchronously and holds claudeCode+proxy for the entire remaining network window. Observed dead for the duration: window AND TRAY Start/Stop/Restart (the reviewer built the real createTrayActions to confirm the tray is dead too — that is the interface a user reaches for precisely when the window looks stuck), proxy:testConnection, proxy:start/stopLogTail, update:install, all of claudeCode:configure/remove/getStatus, and the Uninstall they just clicked — with no feedback. Timing verified against the REAL nvidiaKey.validateApiKey with a hanging fetch, scaled to timeoutMs 100: every downstream domain's unblock time is gated exactly on the network timeout. CLAUDE.md itself records NIM models observed genuinely slow upstream on this account, so multi-second real holds are not hypothetical. Nothing guards navigation either: validateApiKey() in src/renderer/views/setup-view.js:151-165 disables only its own button, and src/renderer/app.js:31-36's nav guard only blocks non-setup routes when there is no manifest yet. Bounded (it self-releases at the network timeout), non-corrupting, and the app stays quittable — before-quit bypasses these locks — so this is UI-deadness, not an unquittable-app regression. The validation step touches NO shared state at all (a pure fetch plus a local mask), so moving it outside the lock and keeping only secretStore.save() inside preserves 100% of NCOW-47's guarantee while collapsing the hold from ~20s to microseconds: a strict improvement to NCOW-47's own intent, not a reversal. The mechanism already exists — mutexes is in scope at engine-context.js:224, and configGen.regenerateStaleConfig's injected runProxyOperation at :234 is the established precedent for an engine-side critical section — but the fix necessarily moves validateAndSave out of the IPC-level lock, so test/main/ipc-mutex.test.js:1106-1142 will need rework rather than being left untouched. Two smaller findings ride along because both are the same question (what should the config lock actually hold): config.getManifest (src/main/ipc.js:50-72, src/main/engine-context.js:354) is an equally pure read of the same key file yet is NOT in UNSERIALIZED_METHODS while apiKey.getMasked is, so NCOW-47's own stated exemption standard is applied inconsistently on the very lock it joined — no live harm today (verified: exactly one caller at src/renderer/app.js:38, createMainWindow early-returns if a live window exists, and menu.js has no viewMenu role so there is no reload accelerator, meaning a second boot cannot race an in-flight validateAndSave), but it became costly the moment a ~20s holder appeared; and src/main/mutex.js:4-6's header enumerates the state these locks guard without nim-key.enc, which is not inside the config directory but is now guarded by the config lock (the file's own NCOW-47 paragraph at :69-76 states this correctly; the header above it does not). Structural note for whoever plans this: the alias table encodes only WHICH lock a domain needs, never HOW LONG it will hold it, and there is nowhere in the merged design that would prompt someone adding a fourth alias to ask who transitively waits on it. That is the gap NCOW-47 fell into in good faith.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 apiKey.validateAndSave's NVIDIA validation round trips no longer occur while the config lock is held; only the secretStore write itself remains inside the critical section
- [ ] #2 NCOW-47's guarantee is preserved and still proven: a clear or validateAndSave write is still serialized against config.generate's secretStore.load(), demonstrated by a test that still fails if the serialization is removed
- [ ] #3 A test demonstrates the freeze is gone: with a validateAndSave whose validation step hangs, an uninstall:run issued afterwards no longer blocks the proxy and claudeCode domains for the validation's duration — and the test fails against current merged source (non-vacuity reproduced and reported)
- [ ] #4 The tray path is covered too, not just the renderer path: Start/Stop/Restart via createTrayActions are shown to stay live during a slow validateAndSave
- [ ] #5 config.getManifest's exemption status is decided explicitly (added to UNSERIALIZED_METHODS as a pure read, or documented as deliberately serialized) rather than left inconsistent with apiKey.getMasked; if it changes, test/main/ipc-mutex.test.js:344-351 is updated accordingly
- [ ] #6 src/main/mutex.js:4-6's header enumeration of the state these locks guard is corrected to include the encrypted key file, matching the file's own NCOW-47 paragraph
- [ ] #7 Any test rendered obsolete by moving validateAndSave out of the IPC-level lock (test/main/ipc-mutex.test.js:1106-1142) is reworked rather than deleted, and the reason is recorded
- [ ] #8 All other pre-existing tests continue to pass unmodified and npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Root cause: apiKey.validateAndSave (engine-context.js) awaits nvidiaKey.validateApiKey() -- up to two sequential 10s network round trips -- BEFORE touching secretStore, but ipc.js locked the entire method around mutexes.config. Composed with NCOW-45's uninstall alias (reserves claudeCode+config+proxy synchronously, holds all three until settled), a slow/offline NVIDIA endpoint turns one Validate-Key click into a ~20s freeze of window, tray, and every claudeCode/proxy method once Uninstall is clicked.
2. Fix: list validateAndSave in ipc.js's UNSERIALIZED_METHODS.apiKey (IPC layer no longer wraps it), and have engine-context.js acquire mutexes.config itself, scoped to only the secretStore.save() call -- mirroring configGen.regenerateStaleConfig's runProxyOperation precedent. apiKey.clear untouched (no network component, whole-handler lock via the alias remains correct).
3. AC#5 decided explicitly: added config.getManifest to UNSERIALIZED_METHODS as a pure read, matching the apiKey.getMasked standard, with test/main/ipc-mutex.test.js:344-351 reworked accordingly.
4. AC#6 verified, not re-fixed: mutex.js:4-8 already names nim-key.enc from an earlier wave's cleanup PR -- confirmed no change needed.
5. AC#4 (tray path) proven via real createTrayActions({mutexes, handlers}) construction in a test harness, no live Electron app needed.
6. AC#7: the obsoleted ipc-mutex.test.js:1113-1149 test reworked in place (not deleted), reason recorded in an adjacent comment block.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented on fix/NCOW-50-move-validation-outside-config-lock (2 commits, pushed to origin). Test counts: 435 before, 439 after (435 pre-existing unmodified + 4 net new/reworked). Non-vacuity: worker stashed just the 3 source files (engine-context.js, ipc.js, mutex.js) and confirmed 5 key tests fail against unfixed source (AC#5 getManifest rework, IPC-layer no-longer-locks test, AC#1 IPC-routed test, AC#1+#2 serialization test, AC#3+#4 end-to-end freeze test), then restored and confirmed 439/439.

AC-by-AC per worker: #1 config lock free during validation (direct handler call + real invoke()). #2 validateAndSave's write still queues behind a config-lock-holding stand-in for config.generate; fails if the internal lock is removed. #3 proven end-to-end with real createEngineContext+registerIpcHandlers+fake pm2Control -- uninstall:run and claude-code:get-status stay live during a hanging validation. #4 proven via real createTrayActions({mutexes, handlers}) -- no live Electron app needed. #5 decided and implemented -- config.getManifest now exempt in UNSERIALIZED_METHODS, ipc-mutex.test.js:344-351 reworked. #6 verified already correct (mutex.js:4-8 already names nim-key.enc from an earlier wave's cleanup) -- no change needed there; separately, mutex.js DOES have a new comment elsewhere (~line 75+) documenting the new self-acquisition pattern for validateAndSave vs the alias table -- this is a distinct, legitimate addition, not a contradiction of the AC#6 claim (confirmed by orchestrator via git diff before dispatching review). #7 obsoleted ipc-mutex.test.js:1113-1149 test reworked in place, reason recorded in an adjacent comment. #8 full npm test passes 439/439.

Did not touch setup-view.js/app.js (the optional nav-guard finding noted in the task description) -- explicitly out of AC scope, backend fix eliminates the freeze regardless of renderer navigation.

Files touched: src/main/engine-context.js, src/main/ipc.js, src/main/mutex.js, test/main/ipc-mutex.test.js. Worker also reported a harness "file modified externally" notice during its own git-stash experiment, independently verified via git status/diff as the expected stash side effect (not an injected attack) before proceeding.
<!-- SECTION:NOTES:END -->
