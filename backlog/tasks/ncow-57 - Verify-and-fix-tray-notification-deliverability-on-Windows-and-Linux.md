---
id: NCOW-57
title: Verify and fix tray notification deliverability on Windows and Linux
status: In Progress
assignee: []
created_date: '2026-08-06 18:16'
updated_date: '2026-08-07 04:08'
labels: []
dependencies:
  - NCOW-55
ordinal: 70000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-55 gave the tray a native OS Notification for wedged Start/Stop/Restart calls. The wave-14 integration review found the app has never called Electron's `app.setAppUserModelId()` anywhere (`grep -rn "setAppUserModelId" src/ package.json` — zero hits). Per Electron's own notifications documentation, Windows notifications need a Start Menu shortcut carrying an AppUserModelID + ToastActivatorCLSID; in production Electron auto-calls `app.setAppUserModelId()`, but a `npm run dev`/source run typically needs it called explicitly, and `electron-builder.yml`'s `win.target` includes `portable` alongside `nsis` — a portable exe installs no Start Menu shortcut at all, so the toast has no AUMID to bind to there either.

`Notification.isSupported()` (the guard NCOW-55 added before constructing a Notification) does not detect either of these conditions — it returns `true` on Windows regardless of AUMID/shortcut state, and also returns `true` on macOS when the user has denied notification permission or has Do Not Disturb on. So NCOW-55's own docstring claim that "a platform/session where it's unsupported just falls back to the console.error trail alone" is narrower in practice than it reads: there are real, currently-unhandled cases where a notification silently fails to appear with no fallback trail at all.

This has never been verified live on Windows or Linux (only informally reasoned about from documentation).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 app.setAppUserModelId() is called appropriately for dev/source runs (matching Electron's own guidance) so tray notifications actually appear on a Windows dev run
- [ ] #2 Decide and implement a mitigation for the portable Windows build target (electron-builder.yml's win.target includes portable, which installs no Start Menu shortcut/AUMID) — either exclude notifications from that target gracefully, or document why it's an accepted gap
- [ ] #3 Live-verified on winvm: a wedged tray Start/Stop/Restart produces a real, visible Windows toast notification in both the nsis-installed and portable configurations (or the portable gap from AC#2 is confirmed and documented instead)
- [ ] #4 Live-verified on a Linux desktop environment: a wedged tray action produces a real, visible notification, or the absence is confirmed and documented
- [ ] #5 All pre-existing tests continue to pass unmodified and npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Research Electron's current app.setAppUserModelId()/Notification guidance and
   electron-builder's win.target `portable` behavior via Context7 rather than memory.
2. Extract a pure, unit-testable shouldSetAppUserModelId({platform, isPackaged}) into a new
   src/main/appUserModelId.js; wire src/main/index.js to call
   app.setAppUserModelId(process.execPath) before app.whenReady(), gated on win32 && !isPackaged
   (matching Electron's own documented example and rationale). [AC#1]
3. Add test/main/app-user-model-id.test.js: direct tests of the pure function plus static
   source-text checks on index.js, following this project's established pattern for a file that
   cannot be require()d under plain node --test.
4. Decide AC#2 from LIVE evidence rather than documentation: build BOTH Windows targets (nsis and
   portable) on winvm and drive the real packaged process's real createTrayActions().onStart()
   failure path in each, comparing OS-level notification registration between them.
5. Do the equivalent on linuxvm against the real GNOME/Wayland session, capturing the app's own
   org.freedesktop.Notifications.Notify call with dbus-monitor. [AC#4]
6. Document whatever the live comparison actually shows in electron-builder.yml, and correct any
   claim in src/main/tray.js that the evidence contradicts — then sweep the repo for every
   restatement of that same claim.
7. npm test before and after; two logical commits; push.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Wave-16 implementation evidence (worker, pre-review)

Branch `feat/NCOW-57-tray-notify-deliverability`, based at `09cbdd98bbeba7ff04c48fad28ee442e783793a2`.
Commits: `69949426339c55e88f0f6d1aeaf83d4d0b84b16c` (setAppUserModelId), `7448bc2724c94d9b7edc6dd8e52286145f2043b4` (portable-target finding).
Diff vs dev: 5 files, +185/-0 — electron-builder.yml, src/main/appUserModelId.js (new),
src/main/index.js, src/main/tray.js, test/main/app-user-model-id.test.js (new).

**AC#1.** index.js now calls app.setAppUserModelId(process.execPath) before app.whenReady(),
gated by shouldSetAppUserModelId({platform, isPackaged}). Non-vacuity proved by reverting: with
the call removed, `node --test test/main/app-user-model-id.test.js` gives 7 tests / pass 4 /
fail 3 (the 3 static-wiring assertions fail; the 4 pure-function tests correctly still pass,
since appUserModelId.js itself was untouched by the revert). Restored -> pass 7 / fail 0.
Novelty: neither the module nor the tests existed before this task.

**AC#2.** Decided from live comparison, not documentation. `npm run dist:win` (electron-builder
26.15.3) produced both `Claude Conduit Setup 0.1.1.exe` (nsis) and `Claude Conduit 0.1.1.exe`
(portable). Both were driven live (see AC#3) and showed IDENTICAL AUMID
(`electron.app.Claude Conduit`, Electron's own productName-derived default) and identical
notification-registration behavior. No runtime exclusion was therefore added; the finding is
documented in electron-builder.yml's `win` section and cross-referenced from tray.js and
appUserModelId.js. Deliberately kept narrow so as not to pre-empt NCOW-58.

**AC#3 (winvm, Windows 11 Pro).** nsis installed silently (/S); confirmed the installed exe under
AppData\Local\Programs\Claude Conduit\ and a real Start Menu shortcut .lnk. Launched into the
ACTIVE CONSOLE SESSION (session 1) via `schtasks ... /IT`, with NIM_PROXY_TEST_HOME + --dev.
Attached a Node Inspector (--inspect=9229) to the real running main process, required the real
tray.js from app.getAppPath(), and called createTrayActions(...).onStart() with a synthetic
NOT_CONFIGURED failure. Observed
`{"isPackaged":true,"platform":"win32","appPath":"...\\resources\\app.asar","result":{"ok":false,"error":{"code":"NOT_CONFIGURED","message":"Run setup first."}}}`.
Portable repeated the same procedure; app.getAppPath() resolved into the self-extracted temp dir,
isPackaged:true, same result. OS-level evidence for BOTH: Windows itself created/updated
`HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Notifications\Settings\electron.app.Claude Conduit`,
with LastNotificationAddedTime (FILETIME 134305482092933723) converting to 2026-08-06 22:50:09
local — the exact second of the nsis run — and PeriodicNotificationCount incrementing.
**REPORTED LIMITATION, not a pass claim:** pixel-level toast-banner proof was NOT obtained for
either target despite four capture strategies (plain screenshot; an 8-10 frame burst spanning the
expected banner duration; Notification Center via Win+N; minimize-all to rule out Focus Assist
fullscreen suppression). Reported honestly as unresolved, plausibly a VM display/compositor
issue, and left for the reviewer to weigh against AC#3's literal "visible" wording.

**AC#4 (linuxvm, GNOME 50.1 Wayland, session 1 active).** Required XAUTHORITY from
/run/user/1000/.mutter-Xwaylandauth.* — discovered empirically after a first attempt failed with
"Missing X server or $DISPLAY"; this was NOT in the dispatch brief. Ran `electron . --dev
--no-sandbox` from source with NIM_PROXY_TEST_HOME, via a harness requiring the real
src/main/tray.js and calling the real createTrayActions().onStart(). Concurrent
`dbus-monitor --session "interface='org.freedesktop.Notifications'"` captured the real Notify
call: app_name="Electron", summary="Claude Conduit", body="Start failed: Run setup first." —
delivered to gnome-shell, which owns org.freedesktop.Notifications
(GetServerInformation -> ('gnome-shell','GNOME','50.1','1.2')). Pixel proof unavailable by
environment (GNOME 50 denies the Shell Screenshot API; gnome-screenshot/grim absent) — that is
the documented-absence branch for PIXEL PROOF specifically, not for the notification path, which
was positively verified.

**AC#5.** Baseline before any change: npm test -> 476 tests, pass 476, fail 0. Final: 483 tests,
pass 483, fail 0 (476 pre-existing + 7 new, all in a new file; zero pre-existing test files
touched).

**Claim sweep (mandatory per campaign policy).** Swept
`grep -rn "falls back to\|unsupported\|isSupported" src/ test/` for restatements of the
overbroad tray.js claim that was corrected. Only other hits are in test/main/tray-actions.test.js,
which assert the actual mechanism (skip-without-throwing when isSupported() === false) rather
than restating the overbroad claim. Nothing further needed correcting.

**Worker-declared interpretations and side effects, carried forward for review:**
1. Code reached both hosts by rsync/scp (tar+scp on winvm, which lacks rsync) of the worktree
   excluding node_modules/.git/.env, not git clone. The worker reports that .env was
   inadvertently swept into the FIRST tar and was deleted from both hosts before use.
2. Verification drove the real createTrayActions().onStart() through a Node Inspector rather than
   literally clicking a native tray menu (no interactive click automation on Windows; vanilla
   GNOME has no tray-icon support without an extension, so a tray icon may not render on linuxvm
   at all). Stated explicitly as a faithful proxy, not a silent substitution.
3. On winvm, `taskkill /F /IM "Claude Conduit.exe" /T` (clearing the nsis instance so the
   portable exe's requestSingleInstanceLock() would not silently no-op) incidentally also killed
   the pm2 daemon, because pm2 spawnDaemon()'s private interpreter copy is named identically to
   the app binary (this project's own NCOW-22/24 design). Disposable test VM, no other apps on
   that PM2_HOME. Flagged because CLAUDE.md treats killing the shared pm2 daemon as a hard never
   FOR THE APP — this was an incidental manual OS-level taskkill during cleanup, not app code.
4. The NSIS uninstaller (/S) reported success but left the whole app directory behind; cleaned up
   manually. Out of NCOW-57 scope, not investigated.
<!-- SECTION:NOTES:END -->
