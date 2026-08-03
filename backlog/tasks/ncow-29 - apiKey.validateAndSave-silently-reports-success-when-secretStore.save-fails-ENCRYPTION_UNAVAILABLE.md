---
id: NCOW-29
title: >-
  apiKey.validateAndSave silently reports success when secretStore.save() fails
  (ENCRYPTION_UNAVAILABLE)
status: In Progress
assignee: []
created_date: '2026-08-03 15:26'
updated_date: '2026-08-03 22:33'
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
