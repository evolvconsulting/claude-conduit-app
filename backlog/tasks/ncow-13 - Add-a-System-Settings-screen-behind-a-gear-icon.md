---
id: NCOW-13
title: Add a System Settings screen behind a gear icon
status: To Do
assignee: []
created_date: '2026-07-31 21:51'
updated_date: '2026-07-31 21:52'
labels: []
dependencies:
  - NCOW-14
priority: medium
type: enhancement
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
There is nowhere to change how the app itself behaves. Add a System Settings screen reached from a standard gear icon in the chrome (sidebar footer or header), separate from the per-connection configuration.

The Prerequisites step is the likely occupant: it is a system-level concern (Node, Python, litellm, litellm version, port availability) that a first-run wizard currently owns but that users need to revisit later, and it fits Settings better than it fits Setup. Decide whether Settings replaces the Prerequisites step outright or Setup keeps a first-run copy of it.

Candidate contents, to be confirmed while planning: prerequisite status with the install action; proxy port; log location and log retention; behaviour on quit (see NCOW-4, which made stopping the proxy unconditional and noted a preference was deliberately deferred until a settings surface existed); update settings once NCOW-10 lands; and a link to Diagnostics.

Coordinate with NCOW-7 (Setup sub-nav) and NCOW-15 (multiple connections): the split between what is a system setting and what belongs to an individual connection has to be decided once and applied consistently, not negotiated per screen.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A gear icon is present in the app chrome and opens System Settings
- [ ] #2 System Settings is reachable from a bare hash route consistent with the existing router scheme
- [ ] #3 Prerequisite checks are available from System Settings and can be re-run on demand, with the litellm install action working from there
- [ ] #4 A documented decision records whether the Setup Prerequisites step is removed, kept for first run only, or replaced
- [ ] #5 The boundary between system-level settings and per-connection settings is written down and followed
- [ ] #6 Every setting the screen exposes persists across an app restart and takes effect without a reinstall
- [ ] #7 Settings that require a proxy restart to take effect say so, and offer the restart
- [ ] #8 Verified by driving the real UI: change each setting, restart the app, confirm it stuck and took effect
<!-- AC:END -->
