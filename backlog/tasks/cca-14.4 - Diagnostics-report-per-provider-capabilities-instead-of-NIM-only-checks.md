---
id: CCA-14.4
title: 'Diagnostics: report per-provider capabilities instead of NIM-only checks'
status: In Progress
assignee: []
created_date: '2026-08-16 14:45'
updated_date: '2026-08-17 03:40'
labels: []
dependencies:
  - CCA-14.1
parent_task_id: CCA-14
priority: high
type: enhancement
ordinal: 80000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update the diagnostics suite (src/engine/diagnostics.js) to report what the active provider actually supports, per its declared capabilities, instead of failing checks that only ever applied to NIM.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Diagnostics checks are keyed off the active provider's declared capabilities rather than hardcoded NIM assumptions
- [ ] #2 A provider that does not support a given check (e.g. no catalog listing) reports that plainly rather than failing
- [ ] #3 npm test passes
<!-- AC:END -->
