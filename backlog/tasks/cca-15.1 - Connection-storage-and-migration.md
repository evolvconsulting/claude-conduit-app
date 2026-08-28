---
id: CCA-15.1
title: Connection storage and migration
status: To Do
assignee: []
created_date: '2026-08-28 15:01'
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
- [ ] #1 A connections store holds an ordered list of named connections (provider, base URL, primary/small models) plus one activeConnectionId; port and master key remain system-level settings, not per-connection
- [ ] #2 Each connection's credential is saved/loaded/cleared via secretStore's saveFor/loadFor/clearFor keyed by the connection's own id, so multiple connections of the same provider type never collide
- [ ] #3 An existing single-configuration install migrates automatically into one named connection on first launch, with its stored credential intact and no manual steps
- [ ] #4 Migration is proven against a real pre-CCA-15 fixture (manifest with no connections list, legacy nim-key.enc), not just asserted in isolation
<!-- AC:END -->
