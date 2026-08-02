---
id: NCOW-10.2
title: >-
  Add CI release workflow publishing artifacts + update metadata to GitHub
  Releases
status: In Progress
assignee: []
created_date: '2026-08-02 01:07'
updated_date: '2026-08-02 01:47'
labels: []
dependencies:
  - NCOW-9
references:
  - docs/distribution.md
parent_task_id: NCOW-10
priority: high
type: chore
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a CI workflow (GitHub Actions) that builds this app with electron-builder and publishes the artifacts plus the update-metadata files (latest.yml, latest-mac.yml, latest-linux.yml — already emitted by electron-builder into dist/ per NCOW-9, no extra build config needed) to GitHub Releases on evolvconsulting/claude-conduit.

Follow docs/distribution.md (from NCOW-9) for the existing release checklist, including its documented asset-naming footgun: GitHub's web UI rewrites spaces to periods in uploaded filenames, which silently breaks auto-update if artifacts are ever uploaded by hand instead of via this CI workflow — the whole point of this workflow is to avoid that failure mode by always publishing through CI.

Per the campaign tracker (doc-4): builds are UNSIGNED for now (no code-signing certs yet) — the workflow does not need to invoke a signing step, just produce and publish the same artifacts electron-builder already produces locally.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CI workflow builds all target platforms and publishes the resulting artifacts to a GitHub Release
- [ ] #2 The update-metadata files (latest.yml / latest-mac.yml / latest-linux.yml) are published alongside the artifacts, with filenames intact (no space-to-period corruption)
- [ ] #3 Workflow trigger is defined and documented (e.g. on version tag push)
- [ ] #4 docs/distribution.md is updated to reference the new CI workflow as the recommended release path
<!-- AC:END -->
