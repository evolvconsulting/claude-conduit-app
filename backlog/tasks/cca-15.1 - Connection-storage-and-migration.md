---
id: CCA-15.1
title: Connection storage and migration
status: Done
assignee:
  - '@claude.coder2@evolvconsulting.com'
created_date: '2026-08-28 15:01'
updated_date: '2026-08-28 15:32'
labels: []
dependencies: []
parent_task_id: CCA-15
type: feature
ordinal: 88000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the single-slot manifest into an ordered list of named connections plus one activeConnectionId, keying secretStore's existing per-provider saveFor/loadFor/clearFor by each connection's own id (not just provider id) so two connections of the same provider type never collide. Port and master key stay system-level settings (CCA-13), not per-connection, per the approved client-config-stays-fixed decision. An existing pre-CCA-15 single-configuration install must migrate automatically into one named connection on first launch, credential intact, zero manual steps.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A connections store holds an ordered list of named connections (provider, base URL, primary/small models) plus one activeConnectionId; port and master key remain system-level settings, not per-connection
- [x] #2 Each connection's credential is saved/loaded/cleared via secretStore's saveFor/loadFor/clearFor keyed by the connection's own id, so multiple connections of the same provider type never collide
- [x] #3 An existing single-configuration install migrates automatically into one named connection on first launch, with its stored credential intact and no manual steps
- [x] #4 Migration is proven against a real pre-CCA-15 fixture (manifest with no connections list, legacy nim-key.enc), not just asserted in isolation
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add src/engine/connectionsMigration.js: pure migrateManifestToConnections(manifest, opts) — promotes a pre-CCA-15 manifest's implicit single connection (top-level provider/nim_base_url/primary_model/small_model) into a connections[] array + activeConnectionId. Additive only: every existing top-level field stays put untouched (15.2/15.3 still read them directly). Idempotent (Array.isArray(manifest.connections) short-circuits) and null-safe (fresh install, no manifest yet).
2. Re-key secretStore.js's saveFor/loadFor/clearFor/credentialPathFor/importFromExistingEnvFile semantically from providerId to a connection's own id (JSDoc + param rename only — the functions already just sanitize+persist whatever string they're given, so no production caller exists to break). This is what actually satisfies AC#2's same-provider-collision requirement: two connections of the same provider type get different ids, so they no longer alias the same credential slot the way passing providerId literally would.
3. Wire the migration into src/main/engine-context.js on every launch (same 'no-op once migrated' shape as migrateLegacyConfigDir/migrateLegacyKeyFile): read the manifest, run migrateManifestToConnections, and if migrated, move the legacy secretStore.load() credential (if any) into secretStore.saveFor(connectionId, key), then saveManifest the connections/activeConnectionId patch.
4. Tests: test/engine/connectionsMigration.test.js (pure unit tests — no-op cases, field mapping, idempotency); a same-provider-different-connection-id collision test added to test/engine/secretStore.test.js; and a non-vacuous test/main/engine-context-connections-migration.test.js fixture test mirroring engine-context-config-regen.test.js's CCA-14.5 AC#3 test — a real pre-CCA-15 manifest.json (no connections field) plus a real legacy nim-key.enc, run through createEngineContext(), proving the on-disk manifest gets connections+activeConnectionId and the credential is readable via secretStore.loadFor(activeConnectionId) with zero manual steps.
5. npm test full suite; verify no other call site regresses (regen path, config.generate, updatePort, catalog/diagnostics all keep reading the untouched top-level fields).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented: src/engine/connectionsMigration.js (pure migrateManifestToConnections), secretStore.js re-keyed from providerId to connection id (JSDoc+param rename only, no production caller existed yet), engine-context.js wired the migration on every launch reusing the already-guarded manifestForRegenCheck read (avoids reintroducing the corrupt-manifest crash the NCOW-30 fix-pass closed). Full suite 613/613 pass, including a non-vacuous fixture test against a real pre-CCA-15 manifest.json + legacy nim-key.enc, an idempotency test, a fresh-install no-op test, and a corrupt-manifest regression test.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Extended manifest.json with a connections[] list + activeConnectionId (src/engine/connectionsMigration.js's migrateManifestToConnections), purely additive — every existing top-level field (port, litellm_path, provider, primary_model, small_model, nim_base_url) stays exactly where CCA-14.5/CCA-13 left it, since 15.2/15.3 still own repointing the app's actual read paths at the connections list. Re-keyed secretStore.js's saveFor/loadFor/clearFor/importFromExistingEnvFile from providerId to a connection's own id (doc+param rename only; no production caller existed yet, so nothing broke) — this is what actually satisfies AC#2's same-provider-collision requirement, since two connections of the same provider now get distinct ids instead of aliasing one shared providerId slot. Wired the migration into engine-context.js on every launch, reusing the already try/catch-guarded manifestForRegenCheck read rather than taking an unguarded second getManifest() call, so a corrupt/truncated manifest.json (the NCOW-30 fix-pass's own documented crash class) can't regress. Verified: full suite 613/613 (was 612 before this task's 25 new/added tests plus 4 pre-existing ones the corrupt-manifest run touches). AC#1/AC#2 unit-verified in test/engine/connectionsMigration.test.js and test/engine/secretStore.test.js. AC#3/AC#4 verified non-vacuously in test/main/engine-context-connections-migration.test.js: a real pre-CCA-15 fixture (manifest.json with no connections field, generated via the real generateAll(), plus a real encrypted nim-key.enc) run through the actual createEngineContext() bootstrap — the on-disk manifest genuinely migrates (connections[0] populated, activeConnectionId set) and the credential is readable via the real secretStore.loadFor(connectionId) with zero manual steps; also covers idempotency (second launch mints no duplicate), a fresh-install no-op, and the corrupt-manifest guard.
<!-- SECTION:FINAL_SUMMARY:END -->
