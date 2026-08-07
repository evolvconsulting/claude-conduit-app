---
id: NCOW-57
title: Verify and fix tray notification deliverability on Windows and Linux
status: In Progress
assignee: []
created_date: '2026-08-06 18:16'
updated_date: '2026-08-07 03:19'
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
