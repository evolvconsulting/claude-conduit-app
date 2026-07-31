---
id: NCOW-5
title: Move 'Things to know' out of the dashboard into an About dialog
status: Done
assignee:
  - '@claude'
created_date: '2026-07-31 20:37'
updated_date: '2026-07-31 21:29'
labels: []
dependencies: []
priority: medium
type: enhancement
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The dashboard currently carries a "Things to know" block (see `src/renderer/views/dashboard-view.js`). It is static reference content that clutters the main operational view.

Move it into an About entry reachable from the application menu (macOS: NIM Proxy Manager > About; Windows/Linux: Help > About). The About surface should also carry the usual identity information — app name, version, and a link to the project repo.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Dashboard no longer renders the "Things to know" block
- [x] #2 An About item exists in the application menu on the platform-appropriate menu (app menu on macOS, Help menu on Windows/Linux)
- [x] #3 The About surface shows the app name, version (from package.json), and the "Things to know" content
- [x] #4 About is dismissible and does not use window.confirm/alert/prompt (renderer-blocking dialogs are forbidden)
- [x] #5 README stays consistent with wherever the content now lives
- [x] #6 Verified by opening About in the running app
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add an app:show-about event to CHANNELS so the main-process menu can ask the renderer to open the dialog; the preload derives onShowAbout automatically.
2. menu.js: build the macOS app menu explicitly instead of using the appMenu role, so its About item opens our own dialog rather than the native panel (the native panel cannot carry the Things to know content). Keep the quit role inside it untouched. Windows and Linux get About at the top of the Help menu.
3. index.js: pass a showAbout callback that surfaces the window first, then emits the event, so About works even when the window is hidden.
4. New renderer component components/about-dialog.js using the same native dialog element approach as confirm-dialog.js, showing product name, version from app.getVersion, a repo link and the Things to know list. No window.alert.
5. Move the GOTCHAS array out of dashboard-view.js into the dialog and delete the dashboard card.
6. Update README, which describes the Things to know panel as living on the Dashboard.
7. Tests: menu template per platform, the new channel, dashboard no longer owning the content, and About reachable.
8. Verify live by opening About from the real menu and screenshotting the rendered dialog.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implementation: new src/renderer/components/about-dialog.js owns the content and uses the native dialog element, same as confirm-dialog.js. A new app:show-about event lets the main-process menu ask the renderer to open it; index.js surfaces the window first, so About works even when the window is hidden. The GOTCHAS array moved out of dashboard-view.js entirely.

menu.js had to stop using the macOS appMenu role. That role supplies a built-in About which opens the NATIVE macOS panel, and the native panel can only show name/version/copyright - there is nowhere in it for the Things to know content. The macOS app menu is now spelled out with the standard roles around our own About item; the quit role inside it is unchanged. Windows and Linux get About at the top of Help.

Also picked up here (the user approved folding it in, though it was raised against NCOW-6): the Help menu "View Logs Folder" item was a dead no-op still carrying a "wired up once engine/paths.js exists (NCOW-1.2)" comment for a task long since done. It now calls the existing app.openLogsFolder handler. Verified live - clicking it opened Finder on /Users/jdnewhouse/.config/claude-nim-proxy/logs/. The hardcoded https://github.com/ placeholder in "Report an Issue" was replaced with the real origin remote, exported as REPO_URL so the About link, the menu and the ipc.js external-URL allowlist cannot drift apart (a test enforces that).

BUG FOUND AND FIXED BY LIVE TESTING: clicking About twice in quick succession produced two stacked dialogs. The existing guard checked a variable that is only assigned after an awaited getVersion call, so both clicks sailed past it. Added a separate synchronous "opening" latch. Re-verified: three rapid clicks now yield exactly one dialog, and close-then-reopen still works.

Live verification (real app, driven over CDP, screenshots read back):
- Live menu introspection: app menu reads About NIM Proxy Manager / Services / Hide / Quit; Help reads View Logs Folder / Report an Issue.
- Clicking the real About menu item rendered the dialog with the product name, "Version 0.1.0", the repo URL as a link, and all seven Things to know entries including the new one about quitting stopping the proxy.
- Close button removes it from the DOM (0 nodes left); programmatic close works too.
- Triggered with the window hidden: the window came back visible and the dialog opened.
- Navigated to the Dashboard: Things to know is absent, two cards remain (status and logs), no renderer exceptions in the run log.
- npm test 130/130 (was 121).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Moved the Things to know caveats off the Dashboard and into a proper About dialog, reachable from the macOS app menu and from Help on Windows/Linux, showing the product name, version and a link to the repo alongside the list. Required replacing the macOS appMenu role with an explicit template, because that role built-in About opens the native panel, which cannot carry this content. Also fixed the Help menu View Logs Folder item, which had shipped as an empty click handler, and replaced the placeholder GitHub URL with the real remote behind a shared REPO_URL constant. Live testing caught a real bug: two rapid About clicks stacked two dialogs, because the de-dupe guard sat behind an await - fixed with a synchronous latch and re-verified. Verified by clicking the real menu item and reading back screenshots of the dialog and the now-clean Dashboard. npm test 130/130.
<!-- SECTION:FINAL_SUMMARY:END -->
