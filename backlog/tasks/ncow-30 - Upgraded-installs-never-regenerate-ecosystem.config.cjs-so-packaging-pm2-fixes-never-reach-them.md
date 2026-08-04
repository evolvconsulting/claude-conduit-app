---
id: NCOW-30
title: >-
  Upgraded installs never regenerate ecosystem.config.cjs, so packaging/pm2
  fixes never reach them
status: In Progress
assignee: []
created_date: '2026-08-04 00:45'
updated_date: '2026-08-04 03:22'
labels:
  - pm2
  - packaging
  - release
dependencies: []
priority: high
type: bug
ordinal: 43000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found independently by both NCOW-28's and NCOW-29's opus reviewers during wave 11
(2026-08-03), and confirmed by that wave's integration review.

configGen.js's generateAll() (which renders ecosystem.config.cjs, run.js, and
manifest.json for the managed litellm-nim pm2 entry) has exactly one caller in
the entire codebase: engine-context.js's config.generate(), invoked only from
the first-run setup wizard. Nothing else in the app ever regenerates these
files -- not configDirMigration.js or userDataMigration.js (both only rewrite
path prefixes on a directory/name migration, never re-render content), not
pm2Control.js's startOrRestart() (which just does pm2.start() against
whatever ecosystem.config.cjs already exists on disk), and nothing runs on an
app version change or auto-update.

Net effect: an install that completed setup once keeps whatever
generateAll()-produced content it got at that moment, forever, across every
subsequent app upgrade -- including auto-updates via NCOW-10's mechanism. Any
fix that lives inside generateAll()'s output (NCOW-27's interpreter:
process.execPath + ELECTRON_RUN_AS_NODE, NCOW-28's PYTHONIOENCODING=utf-8, and
any future fix of the same shape) silently never reaches a user who set up
before that fix shipped, even after they update to a build that contains it.
Both v0.1.0 and v0.1.1 (the only two real published releases) predate NCOW-27
entirely, so every real user who has ever completed setup against a published
build is currently exposed to this gap.

This intersects with NCOW-24 (bootstrapped daemon persistence across
app/proxy lifecycle) and NCOW-10's auto-update mechanism -- coordinate scope
if picked up alongside either.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The app detects when its own generated ecosystem.config.cjs/run.js/manifest.json are stale relative to the currently-running app version (or otherwise out of date) and regenerates them, verified live: an install that completed setup on an older build and is then upgraded in place ends up with fresh, current-version generated files without the user re-running setup
- [ ] #2 The regeneration is safe against a currently-running proxy: it does not corrupt or orphan a live litellm process, and any necessary restart to pick up the new config is handled the same way this app already handles other proxy-affecting changes
- [ ] #3 Coordinate with NCOW-24 if the fix touches the same daemon-lifecycle code, and with NCOW-10's auto-update path if regeneration should be triggered by (or verified across) an auto-update rather than only at every app launch
- [ ] #4 A regression test covers the stale-detection and regeneration logic
- [ ] #5 npm test passes
<!-- AC:END -->
