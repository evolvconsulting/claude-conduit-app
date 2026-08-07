---
id: NCOW-58
title: Document the tray's native notification behavior in README/DESIGN.md
status: To Do
assignee: []
created_date: '2026-08-06 18:16'
updated_date: '2026-08-07 02:23'
labels: []
dependencies:
  - NCOW-55
  - NCOW-56
ordinal: 71000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-55 introduced this app's first-ever native OS notification (Electron's `Notification` API, used to surface a wedged tray Start/Stop/Restart call). The wave-14 integration review found zero mentions of "notification" anywhere in README.md, DESIGN.md, or CLAUDE.md — the only doc change NCOW-55 itself made was bumping the test count. This is a real user-facing behavior with real platform caveats (see NCOW-57), and this project's README already documents comparable user-facing behavior in detail elsewhere (tray optionality, quit-stops-proxy, the shared Start/Stop/Restart lock).

This task: add a short section to README.md (and DESIGN.md if it has a relevant tray/timeout section already, per its own §7.x tray/pm2-timeout prose) describing that a wedged tray action now raises a native OS notification, and noting the known platform caveats from NCOW-57 (or, if NCOW-57 lands first, linking to its resolution instead of duplicating the caveat).

**SCOPE EXTENDED after NCOW-56 landed (wave 15, user-approved).** This task was filed before NCOW-56 merged, so the text above describes only ONE failure class. Two things changed:

1. **The user-visible surface is now two failure classes, not one.** NCOW-56 extended the tray's error surface to cover a RESOLVED `{ok:false}` result (`NOT_CONFIGURED`, `HEALTH_CHECK_TIMEOUT`) in addition to a thrown/rejected call. The `{ok:false}` case is the more common one in practice — clicking tray Start on a fresh, unconfigured install hits it. Documentation that mentions only "wedged" actions would be stale on arrival.

2. **A deliberate behavioral asymmetry currently exists only as a code comment.** NCOW-56's AC#2 decision was that the tray's Start item stays ENABLED whenever status is not `running`, with no manifest check — unlike the dashboard's `#start-btn`, which is `disabled` when `!manifest` (`src/renderer/views/dashboard-view.js:94`). Clicking tray Start with no manifest therefore round-trips through the handler and surfaces a `NOT_CONFIGURED` notification rather than the control being visibly inert. The reasoning lives only in `src/main/tray.js`'s comment block; a user who notices the two Start controls behaving differently has nowhere to read why. The wave-15 integration review flagged this as a real gap.

Also note: the wave-15 integration review's own staleness sweep confirmed that no statement in README.md, DESIGN.md, or CLAUDE.md currently describes what happens when a tray action FAILS — so this task is adding new prose, not correcting existing prose. Nothing in those files has gone stale; the material is simply absent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 README.md documents that a wedged tray Start/Stop/Restart action raises a native OS notification, alongside this project's existing documentation of other tray/proxy user-facing behavior
- [ ] #2 DESIGN.md's existing tray/pm2-timeout section (§7.x) is updated if it needs to reflect the new notification surface, or explicitly left alone with a note why if it doesn't
- [ ] #3 Known platform caveats (Windows AUMID/portable-build gap, macOS DND/permission-denied) are mentioned or linked to NCOW-57's resolution, whichever is accurate at the time this task is done
- [ ] #4 README.md describes BOTH failure classes the tray now surfaces: a wedged/thrown call and a resolved {ok:false} result (e.g. NOT_CONFIGURED on an unconfigured install, HEALTH_CHECK_TIMEOUT), not just the wedged case
- [ ] #5 The deliberate tray-Start-vs-dashboard-#start-btn asymmetry from NCOW-56's AC#2 decision is documented where a user can read it, including why tray Start stays enabled with no manifest and notifies on click instead of being disabled
<!-- AC:END -->
