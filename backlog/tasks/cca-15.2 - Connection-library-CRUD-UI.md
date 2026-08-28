---
id: CCA-15.2
title: Connection library CRUD UI
status: To Do
assignee: []
created_date: '2026-08-28 15:01'
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
- [ ] #1 A connection-library view lists all saved connections and is the entry point for adding a new one
- [ ] #2 Connections can be created, named, edited, duplicated and deleted through this UI, each validated against the provider's own validateCredential/listModels
- [ ] #3 Multiple connections of the same provider type coexist in the list without collision
- [ ] #4 No window.confirm/alert/prompt is introduced
- [ ] #5 npm test passes with new/updated renderer tests
<!-- AC:END -->
