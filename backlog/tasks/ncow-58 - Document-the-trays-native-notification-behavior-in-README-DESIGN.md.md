---
id: NCOW-58
title: Document the tray's native notification behavior in README/DESIGN.md
status: To Do
assignee: []
created_date: '2026-08-06 18:16'
labels: []
dependencies:
  - NCOW-55
ordinal: 71000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-55 introduced this app's first-ever native OS notification (Electron's `Notification` API, used to surface a wedged tray Start/Stop/Restart call). The wave-14 integration review found zero mentions of "notification" anywhere in README.md, DESIGN.md, or CLAUDE.md — the only doc change NCOW-55 itself made was bumping the test count. This is a real user-facing behavior with real platform caveats (see NCOW-57), and this project's README already documents comparable user-facing behavior in detail elsewhere (tray optionality, quit-stops-proxy, the shared Start/Stop/Restart lock).

This task: add a short section to README.md (and DESIGN.md if it has a relevant tray/timeout section already, per its own §7.x tray/pm2-timeout prose) describing that a wedged tray action now raises a native OS notification, and noting the known platform caveats from NCOW-57 (or, if NCOW-57 lands first, linking to its resolution instead of duplicating the caveat).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 README.md documents that a wedged tray Start/Stop/Restart action raises a native OS notification, alongside this project's existing documentation of other tray/proxy user-facing behavior
- [ ] #2 DESIGN.md's existing tray/pm2-timeout section (§7.x) is updated if it needs to reflect the new notification surface, or explicitly left alone with a note why if it doesn't
- [ ] #3 Known platform caveats (Windows AUMID/portable-build gap, macOS DND/permission-denied) are mentioned or linked to NCOW-57's resolution, whichever is accurate at the time this task is done
<!-- AC:END -->
