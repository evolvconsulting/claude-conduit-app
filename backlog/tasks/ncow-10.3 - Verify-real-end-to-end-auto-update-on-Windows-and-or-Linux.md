---
id: NCOW-10.3
title: Verify real end-to-end auto-update on Windows and/or Linux
status: In Progress
assignee: []
created_date: '2026-08-02 01:08'
updated_date: '2026-08-02 03:24'
labels: []
dependencies:
  - NCOW-10.1
  - NCOW-10.2
parent_task_id: NCOW-10
priority: high
type: task
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
With the in-app checker + proxy-restart handling (NCOW-10.1) and the CI release workflow (NCOW-10.2) in place, prove the auto-update path actually works end to end: install an older built version of the app, publish a newer real (unsigned) GitHub Release via the CI workflow from NCOW-10.2, and confirm the older install detects, downloads, and installs the update automatically on at least one of Windows or Linux (neither platform requires signing for electron-updater to function — see NCOW-10.1). Also confirm the LiteLLM proxy behaves as defined across the update/restart.

This step publishes a real, unsigned GitHub Release of this app on evolvconsulting/claude-conduit. That is an explicit, already-confirmed choice by the user at this campaign rounds init (see doc-4, Backlog campaign tracker) — proceed without re-asking, but narrate the release-publish step clearly since it is externally visible.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On a platform where silent/auto-update is possible (Windows and/or Linux), an installed older version actually downloads and installs a newer version end-to-end, observed live rather than inferred from code
- [ ] #2 Verified by installing an older built version and updating it to a newer one on at least one platform, with evidence captured (steps taken, before/after version numbers, logs)
- [ ] #3 The LiteLLM proxys defined restart behavior (from NCOW-10.1) is confirmed to hold across a real update
<!-- AC:END -->
