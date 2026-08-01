---
id: NCOW-19
title: licenses.test.js is platform-sensitive to optional dependency resolution
status: In Progress
assignee: []
created_date: '2026-08-01 14:32'
updated_date: '2026-08-01 21:59'
labels: []
dependencies: []
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
test/main/licenses.test.js asserts licenses.bundled.length === (a live `npm ls --omit=dev --all` count) + 1. That live count depends on which platform-restricted optional dependencies npm actually installs. NCOW-18 (2026-08-01) fixed a staleness bug by regenerating licenses.json to include `fsevents` — a darwin-only optional dependency of chokidar/pm2 — bringing the count to 79. That is correct on macOS (where this project is exclusively developed today and where `npm run dist` builds all three platforms), but the same assertion would now fail on a genuinely fresh Linux or Windows install, where npm never installs `fsevents` and the live count is 77, not 78. This is the mirror image of the bug NCOW-18 just fixed, discovered by the wave-level integration reviewer while confirming NCOW-17 and NCOW-18 (merged together in the same campaign wave) do not conflict — it is not caused by either task, and nothing is broken today (no CI exists in this repo). Make the tree-coverage assertion platform-aware so it stays correct regardless of which platform-restricted optional dependencies the current OS happens to resolve.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The assertion in test/main/licenses.test.js excludes, from its expected count, any package whose lockfile entry restricts it to an os/cpu that does not match the current platform (so it does not require regenerating licenses.json to drop a legitimately-shipped-on-macOS entry like fsevents)
- [ ] #2 The test passes on this macOS machine with the current licenses.json (79 entries) exactly as it does today
- [ ] #3 The test would also pass if run on a platform where fsevents (or any other platform-restricted optional dependency introduced later) is not installed, verified by reasoning through the logic or by simulating the exclusion rather than requiring an actual non-macOS machine
- [ ] #4 npm test passes
<!-- AC:END -->
