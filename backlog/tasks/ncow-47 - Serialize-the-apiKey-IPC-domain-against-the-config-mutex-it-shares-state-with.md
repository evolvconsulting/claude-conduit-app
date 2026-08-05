---
id: NCOW-47
title: Serialize the apiKey IPC domain against the config mutex it shares state with
status: In Progress
assignee: []
created_date: '2026-08-05 15:27'
updated_date: '2026-08-05 15:40'
labels: []
dependencies:
  - NCOW-46
ordinal: 60000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The wave-7 integration review of NCOW-46 enumerated lock resolution for every CHANNELS domain against merged src/main/ipc.js and found apiKey is the last IPC domain with a real mutating concern and no lock at all. apiKey.validateAndSave and apiKey.clear persist and delete the encrypted NVIDIA key via secretStore, but resolveDomainLocks() returns ZERO locks for the apiKey domain (it has no MUTEX_DOMAINS entry of its own and no DOMAIN_MUTEX_ALIASES entry). That same key is read INSIDE the config lock at src/main/engine-context.js:320 (config.generate -> const apiKey = secretStore.load(), which aborts with NO_KEY if absent) and again by diagnostics.run at engine-context.js:502. Reproducing case: clicking Clear Key while a config:generate is in flight — generate either bakes a just-deleted key into litellm.env or fails NO_KEY mid-write, with nothing serializing the two. Real-world impact is low (both paths are user-driven clicks and the Setup wizard is sequential) and there is no deadlock or data loss, but this is precisely the gap class NCOW-32 (uninstall/update unmutexed) and NCOW-45 (uninstall also touches config and claudeCode) have been burning down one instance at a time — apiKey is the remaining one. The other two unlocked domains were checked and are genuinely clean, so this closes the family: diagnostics is explicitly and accurately documented as unlocked (engine-context.js:504-514, a comment that already reflects NCOW-45's three-lock aliasing), and prereqs.installLitellm installs via uv tool install / pipx install / pip install --user (src/engine/prereqs.js:190-193), outside the config dir, so it cannot collide with the config lock or a purge-uninstall. Related doc defect to fix in the same change: src/main/mutex.js:62-64 says 'The domains with a mutating concern. Domains that only ever read (app, catalog, diagnostics-read) do not need one.' — apiKey appears in neither list, so the comment reads as exhaustive when it is not (prereqs is likewise absent). NCOW-46's wave-7 doc cleanup (PR #43) deliberately left this comment alone precisely because whether apiKey needs a lock is the question this task settles.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 apiKey's mutating methods (validateAndSave, clear) are serialized against the same lock that guards config.generate's secretStore.load() read, via whichever existing mechanism fits (a DOMAIN_MUTEX_ALIASES entry resolving apiKey to config, or an equivalent) rather than a new parallel mechanism
- [ ] #2 apiKey.getMasked is considered explicitly and, if left unserialized as a pure read, is documented as such alongside the existing UNSERIALIZED_METHODS precedent rather than left silently unlocked
- [ ] #3 A test demonstrates the previously-unserialized interleaving is now prevented: a clear (or validateAndSave) issued while a config:generate is in flight no longer runs concurrently with it, and the test genuinely fails against unpatched source (non-vacuity reproduced and reported)
- [ ] #4 src/main/mutex.js:62-64's comment is corrected so its list of domains without a mutating concern is accurate and no longer reads as exhaustive while omitting apiKey and prereqs
- [ ] #5 diagnostics and prereqs are confirmed to still need no lock, with the reasoning recorded (so a future reader does not re-litigate the whole family)
- [ ] #6 All pre-existing tests continue to pass unmodified and npm test passes
<!-- AC:END -->
