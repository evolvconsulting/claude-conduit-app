---
id: NCOW-9
title: Decide and document the GitHub install story for end users
status: In Progress
assignee: []
created_date: '2026-07-31 20:38'
updated_date: '2026-08-01 21:59'
labels: []
dependencies:
  - NCOW-12
priority: high
type: spike
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The repo will be published on GitHub. We need a decided, documented answer to "how does a user install this?" before publishing.

`npm run dist` already produces macOS, Windows and Linux artifacts. Open question: are published GitHub Release binaries the primary install path, and is a single curl-pipe `.sh` install script (as the user suggested) worth offering alongside them for macOS/Linux — or does it just add an unsigned-script trust problem on top of already-unsigned binaries?

Evaluate the options and pick one, accounting for: macOS ad-hoc signing means Gatekeeper will warn (no notarisation, no Developer ID) and users need an explicit bypass step; Windows SmartScreen will warn on an unsigned installer; Linux has AppImage/deb/rpm choices. Also cover what an install script would actually need to do beyond downloading (it must not need to install Python/LiteLLM — the app handles prerequisites itself).

Output should be a decision plus user-facing install instructions in the README, and a follow-up task if a script or CI release workflow is needed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Primary install path is chosen and written down with its rationale
- [ ] #2 Decision recorded on whether a shell install script is offered, with the reasoning either way
- [ ] #3 README has copy-paste install instructions for macOS, Windows and Linux
- [ ] #4 Gatekeeper and SmartScreen warnings are documented with the exact steps a user must take to get past them
- [ ] #5 Verified by installing from the chosen path on at least one clean target and launching the app successfully
- [ ] #6 Follow-up implementation tasks created for any release automation or script the decision requires
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Context added 2026-07-31:
1. Now DEPENDS ON NCOW-12 (rebrand). Publishing under the current name then renaming would break download links, the appId and any update feed, so the rename lands first.
2. npm run pack and npm run dist were broken at the schema-validation level (linux.desktopName was removed in electron-builder 26) and were fixed under NCOW-2. Packaging works again, verified by a real macOS build.
3. README already carries an Install section with per-platform Gatekeeper and SmartScreen workarounds and an artifact size table, written for the unsigned case. The user has since confirmed the app WILL be code-signed before release, so much of that section should shrink rather than be written from scratch.
4. dist/ already contains latest.yml, latest-mac.yml and latest-linux.yml - electron-builder emits update metadata by default, which NCOW-10 needs.
<!-- SECTION:NOTES:END -->
