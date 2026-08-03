---
id: NCOW-29
title: >-
  apiKey.validateAndSave silently reports success when secretStore.save() fails
  (ENCRYPTION_UNAVAILABLE)
status: In Progress
assignee: []
created_date: '2026-08-03 15:26'
updated_date: '2026-08-03 22:54'
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
- [ ] #1 validateAndSave surfaces secretStore.save()'s failure to the caller (renderer) instead of reporting {savedOk:true} when save() returns {ok:false}
- [ ] #2 The renderer's setup UI shows a clear, actionable error to the user when the key cannot be persisted, rather than silently proceeding as if setup succeeded
- [ ] #3 Reproduced live on a machine with no available encryption backend (e.g. a headless Linux box) both before the fix (confirming the silent-success bug) and after (confirming the error now surfaces)
- [ ] #4 A regression test covers validateAndSave's handling of a save() failure
- [ ] #5 npm test passes
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
<!-- SECTION:NOTES:END -->
