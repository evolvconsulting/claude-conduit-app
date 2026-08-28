---
id: CCA-15.2
title: Connection library CRUD UI
status: Done
assignee:
  - '@claude.coder2@evolvconsulting.com'
created_date: '2026-08-28 15:01'
updated_date: '2026-08-28 16:13'
labels: []
dependencies:
  - CCA-15.1
parent_task_id: CCA-15
type: feature
ordinal: 89000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace setup-view's linear, NVIDIA-only wizard with a connection-library view listing every saved connection, built on CCA-15.1's storage. Create/name/edit/duplicate/delete each go through the same provider validateCredential/listModels path Setup already uses per provider.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A connection-library view lists all saved connections and is the entry point for adding a new one
- [x] #2 Connections can be created, named, edited, duplicated and deleted through this UI, each validated against the provider's own validateCredential/listModels
- [x] #3 Multiple connections of the same provider type coexist in the list without collision
- [x] #4 No window.confirm/alert/prompt is introduced
- [x] #5 npm test passes with new/updated renderer tests
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add src/engine/connections.js: pure CRUD (create/update/duplicate/remove/find) over manifest.connections[], mirroring connectionsMigration.js's shape (manifest in, manifest out, caller persists).
2. Add a new 'connections' IPC domain (ipc-channels.js): list, listProviders, validateCredential, listModels, create, update, duplicate, delete. Wire handlers in engine-context.js resolving providers.getProvider(providerId) (never the hard-pinned activeProvider constant) and secretStore.saveFor/loadFor/clearFor(connectionId) (CCA-15.1's keying). create/update perform real provider.validateCredential before persisting; duplicate copies the credential without re-validating; delete clears the credential slot. Never touches activeConnectionId resolution, config.generate, or proxy.start — that wiring is CCA-15.3's job.
3. Lock the 4 mutating methods (create/update/duplicate/delete) onto the existing 'config' mutex (ipc.js DOMAIN_MUTEX_ALIASES, same shape as apiKey) since they share manifest.json/secretStore state with config.generate; leave the 4 pure reads/network probes (list/listProviders/validateCredential/listModels) unserialized (UNSERIALIZED_METHODS), matching the NCOW-50 precedent so a slow/offline provider can never hold up config.generate or uninstall's multi-lock reservation.
4. Rewrite src/renderer/views/setup-view.js: replace the linear NVIDIA-only wizard with a connection-library view (list + add/edit form with Validate&load-models -> pick primary/small model -> Save; duplicate opens the copy in edit mode instead of a window.prompt; delete goes through the existing confirmDialog component, danger-styled). Keeps the existing Prerequisites gate unchanged.
5. Tests: pure-function unit tests for connections.js; engine-context integration tests driving the real IPC handlers (validation gating persistence, no-collision credentials, update/duplicate/delete credential handling) via the customLocal provider + a mocked fetch; ipc-mutex lock-resolution tests for the new domain; setup-view static/behavioral tests (canSave gating, confirmDialog wiring, escaping, no config.generate/proxy.start calls) replacing the 3 tests for the removed generate+start step (that logic has no caller left in this file; dashboard-view.js already has its own independent copy for the Test Connection button).
6. Fix a real bug found while testing: saveManifest() assumed configDir always pre-exists (true only when reached via config.generate/configGen.generateAll) — the new connections handlers reach it directly on a fresh install, throwing ENOENT. Fixed by mirroring saveAppSettings()'s existing mkdirSync guard.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation: src/engine/connections.js (pure CRUD over manifest.connections[]); new 'connections' IPC domain (list/listProviders/validateCredential/listModels/create/update/duplicate/delete) wired in engine-context.js against providers.getProvider(providerId) and secretStore.saveFor/loadFor/clearFor(connectionId) — never the hard-pinned activeProvider constant, never config.generate/proxy.start. Mutating methods locked onto the existing 'config' mutex (ipc.js); the 4 pure reads/network probes left unserialized, matching the NCOW-50 precedent.

Ran /code-review medium on the full branch diff before opening a PR (per this campaign's lifecycle step 6). It came back with 6 CONFIRMED findings, all fixed:
1. (Correctness, high severity) setup-view.js never pushed the newly-saved manifest into the shared renderer store — app.js's nav guard/sidebar gate every route but setup/settings on getState().manifest, set once at boot from null on a fresh install, so completing the very first 'Add connection' trapped the user on Setup with no way to reach Dashboard short of an app restart. Fixed: setState({manifest}) after every successful create/update/duplicate/delete (mirrors the old wizard's identical call after config.generate).
2. (Correctness) connections.delete cleared the secretStore credential BEFORE writing the manifest patch; a failed manifest write (disk full, EACCES, EBUSY) would leave an orphaned, credential-less connection still listed. Fixed: reordered to write-then-clear.
3. (Correctness) An explicit empty-string Base URL (the UI's 'clear the field to reset to the provider default' affordance) collapsed to undefined in the renderer's payload, which update()'s field-omission convention reads as 'leave unchanged' — clearing the field silently did nothing. Fixed: renderer now always sends the raw value; engine-context.js normalizes '' -> null on both create and update.
4. (Correctness) validateCredential had no {connectionId} fallback to the stored credential (unlike listModels, which already had one) — re-validating after only a base-URL change, with the credential left untouched, had no way to reach the already-saved key. Fixed: added the same {connectionId} resolution path, factored into a shared resolveConnectionDefaults() helper used by both.
5. (Simplification) The provider try/catch resolution block was repeated byte-for-byte across 4 handlers. Fixed: factored into resolveProviderOrError().
6. (Simplification) The configDir mkdirSync guard was duplicated between saveManifest and saveAppSettings. Fixed: factored into ensureConfigDir().

Also found and fixed, before the review even ran (caught by my own tests): saveManifest() assumed configDir always pre-exists (previously true only via config.generate/configGen.generateAll) — the new connections handlers reach it directly on a fresh install, throwing ENOENT. Fixed by giving saveManifest() the same mkdirSync guard saveAppSettings() already had (now the shared ensureConfigDir() helper).

Also found and fixed during my own design review (before the /code-review pass): connections.update let a caller change providerId with no new credential, silently leaving the OLD provider's already-validated key stored under the connection's id while provider now names a DIFFERENT provider. Fixed: a provider change now requires a credential (CREDENTIAL_REQUIRED if omitted), both server-side (the real boundary) and mirrored in the renderer's canSave() gating.

Verification: npm test — 658/658 pass. 44 new/rewritten tests across test/engine/connections.test.js (17, pure CRUD logic), test/main/engine-context-connections.test.js (17, real IPC handlers driven end-to-end via createEngineContext + real secretStore + a mocked global.fetch against the custom-local provider, including regression tests for each of the 6 code-review findings above), and test/renderer/setup-view.test.js (10, static-source + Function-constructor behavioral reproduction of canSave()/the card template, matching this repo's established no-DOM-harness convention), plus 3 new ipc-mutex.test.js tests proving the connections domain's lock resolution (mutating methods serialize against the config lock; list/listProviders/validateCredential/listModels do not, so a slow/offline provider can never hold up config.generate). Scope note: unlike CCA-13/CCA-15.1, this session did not drive the UI through a real Electron process (no CDP harness was built) — verification rests on the engine-level integration tests plus the renderer's established static/behavioral test convention.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced setup-view's linear NVIDIA-only wizard with a connection-library CRUD view over CCA-15.1's manifest.connections[] storage. New src/engine/connections.js (pure CRUD) + a new 'connections' IPC domain in engine-context.js, each create/edit going through the real per-provider validateCredential/listModels (never the hard-pinned activeProvider constant), credentials keyed by connection id via secretStore.saveFor/loadFor/clearFor. Deliberately does not touch activeConnectionId resolution, config.generate, or proxy.start — CCA-15.3's job. A /code-review medium pass found and this fixed 6 real issues before merging (most notably: the renderer never synced the newly-saved manifest into the shared store, trapping a first-time user on Setup after adding their first connection). Verified via 658/658 npm test, including 44 new/rewritten tests covering all 5 ACs: connection-library listing, create/edit/duplicate/delete each validated (duplicate deliberately skips re-validation, a credential copy needs none), same-provider collision-free coexistence, no blocking native dialogs, and the full suite green.
<!-- SECTION:FINAL_SUMMARY:END -->
