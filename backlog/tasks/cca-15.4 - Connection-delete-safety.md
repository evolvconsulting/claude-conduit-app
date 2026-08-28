---
id: CCA-15.4
title: Connection delete safety
status: To Do
assignee: []
created_date: '2026-08-28 15:01'
labels: []
dependencies:
  - CCA-15.3
parent_task_id: CCA-15
type: feature
ordinal: 91000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Deleting a connection must never leave the app with a dangling active reference or an orphaned pm2 app, and must clear that connection's own stored credential.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Deleting the active connection is blocked, or forces an explicit new-active choice first - activeConnectionId is never left dangling
- [ ] #2 Deleting any connection stops/removes its own pm2 app if one was ever started for it, leaving no orphaned pm2 entry
- [ ] #3 Deleting a connection clears its stored credential via secretStore's clearFor
<!-- AC:END -->
