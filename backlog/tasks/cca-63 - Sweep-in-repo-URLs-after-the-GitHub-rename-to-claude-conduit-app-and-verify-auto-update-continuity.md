---
id: CCA-63
title: >-
  Sweep in-repo URLs after the GitHub rename to claude-conduit-app and verify
  auto-update continuity
status: To Do
assignee: []
created_date: '2026-08-07 18:09'
labels: []
dependencies: []
priority: high
ordinal: 76000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The GitHub repo was renamed evolvconsulting/claude-conduit -> evolvconsulting/claude-conduit-app on 2026-08-07 (part of the three-repo split recorded in claude-conduit-docs: app / gateway / docs). GitHub serves redirects from the old name and the local git remote is already updated, but in-repo references still say claude-conduit: REPO_URL, package.json repository/publish config, README, CLAUDE.md, DESIGN.md where applicable. Existing installed builds reach releases through the redirect — that continuity must be verified live, not assumed, per the CCA-10.3 precedent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No in-repo URL or slug still points at evolvconsulting/claude-conduit except deliberate historical references
- [ ] #2 An existing packaged install (built before the rename) still detects and applies an update published after the rename, verified live
- [ ] #3 A fresh packaged build publishes and auto-updates against the renamed repo, verified live
<!-- AC:END -->
