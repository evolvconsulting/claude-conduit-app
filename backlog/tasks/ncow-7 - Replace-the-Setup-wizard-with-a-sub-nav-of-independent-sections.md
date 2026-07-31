---
id: NCOW-7
title: Replace the Setup wizard with a sub-nav of independent sections
status: To Do
assignee: []
created_date: '2026-07-31 20:37'
updated_date: '2026-07-31 21:52'
labels: []
dependencies:
  - NCOW-15
priority: high
type: enhancement
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Setup view is currently a linear wizard (`src/renderer/views/setup-view.js`). The forced step-by-step ordering is the wrong model: users want to jump straight to the one thing they need to change, and re-running setup to fix a single field is tedious.

Replace the wizard with a Setup view that has a sub-navigation — one entry per section (prerequisites, API key, models, proxy config, Claude Code, Claude Desktop, or whatever the current step set is) — where each section is directly addressable and independently usable. Each section keeps its own validation and its own save/apply, and shows its completion state so a first-time user can still tell what is left to do.

Constraints: the renderer uses a hash router with BARE route names (`#setup`, not `#/setup`) and plain ES modules with no framework or bundler — keep that.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Setup renders a persistent sub-nav listing every section; sections can be visited in any order
- [ ] #2 Each section is directly linkable via the hash router using bare route names consistent with the existing scheme
- [ ] #3 Each section validates and applies its own changes independently — no forced next/back progression
- [ ] #4 Each sub-nav entry shows completion/health state so a first-run user can see what is still outstanding
- [ ] #5 A first-run user can still complete a full setup end to end without prior knowledge of the ordering
- [ ] #6 No window.confirm/alert/prompt is introduced (renderer-blocking dialogs are forbidden)
- [ ] #7 Existing renderer tests updated; `npm test` passes
- [ ] #8 Verified by driving the real UI through a complete fresh setup under NIM_PROXY_TEST_HOME with --dev
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PARKED pending NCOW-15 (user decision, 2026-07-31). NCOW-13 moves Prerequisites out of Setup into System Settings, and NCOW-15 turns per-connection configuration into a connection library, so rebuilding the wizard structure now would very likely be thrown away. The sub-nav requirement is not dropped - it should be satisfied as part of NCOW-15, where the connection model determines the structure. Revisit this task after NCOW-15 and either close it as covered or scope whatever remains.
<!-- SECTION:NOTES:END -->
