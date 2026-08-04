---
id: NCOW-24
title: Bootstrapped pm2 daemon outlives the app and holds its own binary
status: In Progress
assignee: []
created_date: '2026-08-02 21:06'
updated_date: '2026-08-04 06:36'
labels:
  - pm2
  - windows
  - release
dependencies: []
priority: high
type: bug
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during NCOW-22's wave-6 review (2026-08-02), verified live on macOS (packaged) and Windows, and deliberately left out of NCOW-22's scope.

Since NCOW-22, when no pm2 daemon exists this app bootstraps one itself by spawning pm2's own lib/Daemon.js via ELECTRON_RUN_AS_NODE. That daemon is detached and long-lived by design (pm2's model), but it runs THIS APP'S OWN BINARY as its interpreter, and it outlives the app indefinitely:

- macOS, verified from a real packaged artifact: after quitting the app, the daemon reparented to pid 1 and lsof still showed it holding .../Claude Conduit.app/Contents/Frameworks/Electron Framework.framework/.../Electron Framework.
- Windows, verified: Win32_Process showed the daemon as electron.exe ...\\node_modules\\pm2\\lib\\Daemon.js.

Two consequences, neither yet tested:

1. NCOW-4 established 'closing the window hides it; quitting stops the proxy'. That is still true of the proxy, but it no longer implies no app-sized process is left running — one persists indefinitely, including after the app is uninstalled. This is a user-visible surprise (an Electron-weight process attributed to this app, still running long after 'quitting' it) and arguably a promise the README/DESIGN.md no longer keeps.

2. On Windows a running image is locked. This plausibly interferes with NCOW-10's auto-update path and with NSIS uninstall, both of which must replace or remove Claude Conduit.exe. The installer would have to kill the daemon to proceed — which would silently orphan litellm on port 4000, since stopping the supervisor is not the same as stopping what it supervises. Note NCOW-22 was itself discovered during NCOW-10.3's auto-update verification, so this is the same intersection that has already produced one real defect.

Relevant constraint: CLAUDE.md forbids 'pm2 kill' from this app, because pm2 runs against the shared default PM2_HOME (~/.pm2) and killing the daemon would stop every unrelated app the user supervises. Any fix must respect that — stopping OUR app only, never the shared daemon.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The behavior is characterized on Windows: determine empirically whether a running bootstrapped daemon actually blocks (a) an electron-updater/NSIS update that replaces Claude Conduit.exe and (b) an NSIS uninstall, rather than assuming either way
- [ ] #2 If it does block them, the update/uninstall path handles it without ever killing a daemon this app did not start, and without silently orphaning a running litellm on port 4000
- [ ] #3 The user-facing promise is made accurate: either the app no longer leaves an app-sized process running after quit/uninstall, or README/DESIGN.md and any in-app wording are corrected to state what actually persists and why
- [ ] #4 Whatever is decided is verified live on Windows against a real packaged build (the platform where the image-locking risk exists), not by code reading
- [ ] #5 CLAUDE.md's no-pm2-kill constraint is respected by the fix, and any new nuance is documented there
- [ ] #6 npm test passes
<!-- AC:END -->
