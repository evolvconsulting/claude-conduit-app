---
id: NCOW-34
title: Document the deliberate shutdown-mutex carve-out in README/DESIGN.md
status: To Do
assignee: []
created_date: '2026-08-04 19:29'
labels: []
dependencies:
  - NCOW-31
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-31 deliberately excluded shutdown.js's before-quit proxy stop from the new proxy mutex (queueing it behind a background restart that can hold the lock for up to ~60s+ would risk making the app unquittable while wedged, which CLAUDE.md forbids outright). This was reviewed and accepted as the correct call across two review passes, and is documented in engine-context.js's own code comment (see also NCOW-33 for a comment-accuracy correction), but README.md and DESIGN.md section 7.4 -- which already document related pm2/shutdown/quit behavior in detail -- do not yet mention this carve-out at all.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 README.md and/or DESIGN.md section 7.4 record that the before-quit proxy stop is deliberately NOT serialized against the proxy mutex, and why (never make the app unquittable), consistent with engine-context.js's own comment
<!-- AC:END -->
