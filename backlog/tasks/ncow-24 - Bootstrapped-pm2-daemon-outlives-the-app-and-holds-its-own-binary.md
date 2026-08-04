---
id: NCOW-24
title: Bootstrapped pm2 daemon outlives the app and holds its own binary
status: In Progress
assignee: []
created_date: '2026-08-02 21:06'
updated_date: '2026-08-04 07:33'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Empirically characterize AC#1 on Windows via winvm before assuming the bootstrapped daemon blocks update/uninstall: reproduce the exact daemon-holds-own-binary spawn shape (ELECTRON_RUN_AS_NODE keep-alive against the installed exe) without touching the pre-existing shared pm2 daemon, and observe real copy/del/NSIS-silent-reinstall/NSIS-silent-uninstall behavior against it.
2. Based on empirical findings, decide the AC#3 judgment call (relocate the daemon's interpreter vs. document-only) rather than presupposing the answer.
3. Implement the fix, add regression tests, verify live on Windows against a real rebuilt packaged artifact, update documentation (README/DESIGN/CLAUDE.md/About dialog) to state accurately what persists and why, commit, push.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Worker implementation complete (branch fix/NCOW-24-daemon-outlives-app, commits e5a3fe5 + 67a5434, pushed).

AC#1/#4 (live Windows characterization): built a real dist:win NSIS installer/uninstaller natively on winvm. Reproduced the exact daemon-holds-own-binary spawn shape directly (ELECTRON_RUN_AS_NODE keep-alive holding the installed exe, byte-for-byte the same spawn shape spawnDaemon() uses) rather than fighting winvm's pre-existing shared pm2 daemon (which occupies pm2's hardcoded win32 named pipe regardless of PM2_HOME) -- the shared daemon (pid 8832) was never touched. With that process holding the exe: copy over it fails ('used by another process'), del fails ('Access is denied'), a real silent NSIS reinstall (/S) exits 0 but LastWriteTime never changes (silent no-op reporting success), and a real silent NSIS uninstall (/currentuser /S) exits 0, deletes every other file, deregisters the HKCU uninstall registry entry entirely -- but leaves the 225MB locked exe behind, still running, with no UI path to find it. Confirmed macOS was never functionally blocked (POSIX allows replacing a running executable's file), consistent with the original report.

Fix: resolveDaemonInterpreter() in src/engine/pm2Control.js copies the interpreter plus icudtl.dat/snapshot_blob.bin/v8_context_snapshot.bin (empirically required -- a bare exe copy alone crashed with 'Invalid file descriptor to ICU data received') into <pm2Home>/daemon-interpreter/ on win32/linux; spawnDaemon() hands the daemon that copy instead of the installed binary. Falls back to execPath unchanged on any copy failure. Skipped on darwin (unverified bundle layout, and macOS was never the blocked platform). Never kills anything -- the no-pm2-kill constraint is untouched.

Post-fix live re-verification on a rebuilt winvm artifact: with the keep-alive process running from the relocated copy, the original installed exe could be freely overwritten, and a full silent uninstall removed everything (directory gone entirely) while the still-running process was unaffected throughout. Shared daemon pid 8832 confirmed unchanged (dump.pm2) before and after.

AC#3 judgment call: the daemon still outlives the app (unavoidable given the no-pm2-kill constraint) and is still app-sized (a copy of Electron, not a lightweight helper) -- documentation route taken (README.md, DESIGN.md sec 7.4, CLAUDE.md, About dialog's 'Things to know') stating accurately what persists and why, rather than falsely implying the process is gone.

AC#6: 8 new tests in test/engine/pm2Control.test.js (copy / skip-redundant / re-copy-on-size-change / darwin-noop / failure-fallback for resolveDaemonInterpreter, plus 2 spawnDaemon integration tests). npm test: 290/290 locally (macOS) and on real Windows (18 pm2Control-relevant tests pass; 1 pre-existing unrelated failure caused by winvm's shared daemon occupying an un-guarded probe in that one test -- pre-existing gap, not introduced by this change, not present on a clean CI runner).

Files touched: src/engine/pm2Control.js, test/engine/pm2Control.test.js, README.md, DESIGN.md, CLAUDE.md, src/renderer/components/about-dialog.js.
<!-- SECTION:NOTES:END -->
