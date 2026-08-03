---
id: NCOW-29
title: >-
  apiKey.validateAndSave silently reports success when secretStore.save() fails
  (ENCRYPTION_UNAVAILABLE)
status: Done
assignee: []
created_date: '2026-08-03 15:26'
updated_date: '2026-08-03 23:12'
labels:
  - secretstore
  - ipc
  - linux
dependencies: []
priority: medium
type: bug
ordinal: 42000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during NCOW-27's opus review while live-verifying the packaged proxy fix on a headless Linux box with no OS keyring backend available. The apiKey.validateAndSave IPC handler (engine-context.js) calls secretStore.save(), which can return {ok:false, ...} when the platform-native encryption backend is unavailable (ENCRYPTION_UNAVAILABLE) -- but the handler discards that failure result and reports success back to the renderer regardless. Reproduced live, twice: window.nimProxy.apiKey.validateAndSave(...) resolved with {savedOk:true}, while a subsequent apiKey.getMasked() returned null and config.generate() failed with NO_KEY -- the key was never actually persisted. This silently misleads the user during first-run setup on any machine whose keyring/encryption backend is unavailable (observed on a headless Linux box; Linux is now a first-class packaged target per NCOW-25, and headless/minimal Linux installs are a realistic case, not just CI).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 validateAndSave surfaces secretStore.save()'s failure to the caller (renderer) instead of reporting {savedOk:true} when save() returns {ok:false}
- [x] #2 The renderer's setup UI shows a clear, actionable error to the user when the key cannot be persisted, rather than silently proceeding as if setup succeeded
- [x] #3 Reproduced live on a machine with no available encryption backend (e.g. a headless Linux box) both before the fix (confirming the silent-success bug) and after (confirming the error now surfaces)
- [x] #4 A regression test covers validateAndSave's handling of a save() failure
- [x] #5 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
apiKey.validateAndSave in src/main/engine-context.js called secretStore.save(key)
without checking its return value, so a {ok:false, error:{code:'ENCRYPTION_UNAVAILABLE'}}
result was discarded and the handler always returned {ok:true}. Fix: capture
secretStore.save()'s result and return {ok:false, error:{code, message}} when it
fails, with the message reworded to "Key validated, but could not be saved: ..."
so it doesn't read as an invalid-key error. No renderer changes needed --
setup-view.js's existing validateApiKey() already branches on result.ok and
renders result.error?.message in the pre-existing .fail span, with
#apikey-continue-btn already gated on wiz.apiKeyValidated. Add a regression
test (new test/main/engine-context-apikey.test.js) covering both the failure
and success paths through the real createEngineContext().
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Worker evidence (fix/NCOW-29-apikey-save-failure-surfaced, commit 8448467):

AC#1 - engine-context.js now propagates secretStore.save()'s {ok:false} instead
of discarding it.

AC#2 - confirmed live via CDP: #api-key-status innerHTML became
<span class="fail">Key validated, but could not be saved: OS-level secret
encryption is not available on this system.</span>, #apikey-continue-btn
stayed disabled:true.

AC#3 - live reproduction on linuxvm (real aarch64 Ubuntu, real NVIDIA key),
both before and after. Confirmed the real ENCRYPTION_UNAVAILABLE precondition
genuinely occurs when Electron can't detect a desktop secret-service backend
(no XDG_CURRENT_DESKTOP / reachable D-Bus session bus): safeStorage.
isEncryptionAvailable() -> false, backend basic_text, even with
gnome-keyring-daemon running, vs true/gnome_libsecret once
XDG_CURRENT_DESKTOP=GNOME was set -- a realistic headless/minimal-Linux
precondition, not artificial.
  BEFORE (engine-context.js temporarily reverted): direct handler call ->
  {"ok":true,"data":{"maskedKey":"nvapi-...H-ks","models":[...102 models...]}}
  while getMasked() returned null and config.generate() failed NO_KEY -- exact
  match to the reported symptom. Full UI level (real Electron window via CDP,
  real click/type events): setup wizard showed a "pass" span with Continue
  ENABLED -- a fully misleading success state.
  AFTER: same call returns {"ok":false,"error":{"code":"ENCRYPTION_UNAVAILABLE",
  "message":"Key validated, but could not be saved: ..."}}; UI shows the .fail
  span and Continue disabled.

AC#4 - new test/main/engine-context-apikey.test.js: one test asserting a
save() failure surfaces as {ok:false, error:{code:'ENCRYPTION_UNAVAILABLE',
message: /validated, but could not be saved/}} and is never persisted
(getMasked() still null), one confirming the success path is unaffected.
Fake safeStorage (mirrors secretStore.test.js) + mocked global.fetch (mirrors
nvidiaKey.test.js) through the real createEngineContext().

AC#5 - npm test 260/260 locally (macOS worktree), before and after push. Also
sanity-ran the full suite on linuxvm: 259/260 -- the one failure ("spawnDaemon:
a rejecting attempt does not leak the daemon it spawned") is pre-existing,
environment-specific to that VM, in a file byte-identical to dev, untouched by
this change. Flagged as a possible follow-up, not addressed here.

All live-testing artifacts (checkout, temp key file, test homes, Xvfb/Electron
processes) removed from linuxvm; no stray processes or leftover files remain.

Awaiting opus review.

Opus review verdict: APPROVE. All 5 ACs independently confirmed with fresh
live evidence, not the implementer's claims.

AC#1/#4 - reviewer built two trees on linuxvm sharing node_modules (branch vs
a dev-baseline swap of engine-context.js, sha-checked). New test file against
pre-fix engine-context: 1 fails ("surfaces secretStore.save() failure"), 1
passes; against fixed engine-context: 2/2 pass. validateAndSave confirmed to
have exactly one consumer (setup-view.js:157), no other caller regressed.

AC#2 - read setup-view.js directly (not trusted): validateApiKey() branches on
result.ok, sets wiz.apiKeyError = result.error?.message on failure;
renderApiKeyStep() renders it in an escaped .fail span and gates
#apikey-continue-btn on wiz.apiKeyValidated. Confirmed live below.

AC#3 - live A/B on linuxvm (real aarch64 Ubuntu, Electron 43.2.0), both halves
independently reproduced. First established ENCRYPTION_UNAVAILABLE is a
genuine unforced precondition: a standalone probe with real inherited env
(live D-Bus session, running gnome-keyring-daemon) reported
isEncryptionAvailable:false / backend basic_text / encryptString actually
throwing; control with XDG_CURRENT_DESKTOP=GNOME -> gnome_libsecret,
available:true. Then drove the real Electron window over CDP:
  BEFORE (dev engine-context): pass span, Continue enabled, while
  getMasked()->null and generate()->NO_KEY -- silent-success bug reproduced
  firsthand.
  AFTER (branch): fail span "Key validated, but could not be saved: OS-level
  secret encryption is not available on this system.", Continue disabled,
  getMasked/generate still null/NO_KEY.
  HAPPY-PATH CONTROL (branch + XDG_CURRENT_DESKTOP=GNOME): pass span, Continue
  enabled, nim-key.enc written inside the fake home, generate() ok -- fix
  doesn't break the success path; test-home redirection held (real
  ~/.config/claude-conduit never created).

AC#5 - npm test 260/260 (macOS worktree), run independently.

Blocking-dialog rule: grepped the added diff lines for window.confirm/alert/
prompt -- none introduced.

Non-blocking findings (not addressed in this task):
- The flagged linuxvm-only pm2Control.test.js failure ("spawnDaemon: a
  rejecting attempt does not leak the daemon it spawned") independently
  confirmed genuinely pre-existing and environmental: fails identically on
  the dev baseline AND on an untouched Aug-2 build tree that predates this
  branch entirely; pm2Control.js/its test are byte-identical (sha256) across
  dev and branch; suite is 260/260 on macOS. Root cause: pm2 v7.0.3 on Linux
  doesn't reject spawnDaemon() against a non-socket file at rpc.sock the way
  the test expects. A real orphaned God Daemon this run left behind was
  killed by the reviewer.
- Adjacent, same bug class, out of scope: secretStore.js's
  importFromExistingEnvFile() also calls this.save(key) and discards the
  result, returning the key as if persisted -- the identical swallow this
  task fixed elsewhere. Candidate follow-up task, pending user decision.
- Minor nit: new code reads saveResult.error.code unguarded; safe today since
  secretStore.save() always pairs ok:false with error, but a ?. would be free
  insurance. Not required.
- Unrelated: one live validate attempt hit nvidiaKey.js's 10s AbortController
  timeout against integrate.api.nvidia.com even though a raw curl to the same
  endpoint returned 200 in 0.13s -- pre-existing, untouched by this diff.

Cleanup: linuxvm review artifacts (branch/devbase trees, fake homes, run logs,
probe config) removed; reviewer's Xvfb + orphaned pm2 daemon (and its temp
PM2_HOME) killed. Untouched: the pre-existing ncow25-build tree, the user's
real ~/.pm2 daemon, Claude Desktop's config.

Ready for merge queue.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
apiKey.validateAndSave in engine-context.js now propagates secretStore.save()'s {ok:false, error} instead of discarding it and always reporting success. No renderer change needed -- setup-view.js already branched on result.ok and rendered result.error?.message. Opus review independently reproduced the bug and fix live on a headless Linux box (linuxvm) with a genuine, unforced ENCRYPTION_UNAVAILABLE precondition (no desktop D-Bus session): before the fix, the setup UI showed a misleading pass state with Continue enabled despite the key never being persisted; after, a clear .fail error with Continue disabled; a happy-path control confirmed normal key persistence still works. npm test 260/260 (261/261 after rebase onto NCOW-28). Squash-merged PR #19 -> dev @ 230ca0d. Two adjacent findings recorded on the task but out of scope: an identical swallowed-failure pattern in secretStore.js's importFromExistingEnvFile() (confirmed dead code, zero production callers) and a pre-existing, environment-specific flaky pm2Control test on Linux (confirmed unrelated to this change).
<!-- SECTION:FINAL_SUMMARY:END -->
