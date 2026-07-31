---
id: NCOW-3
title: Add an explicit Quit/Exit action to the app
status: Done
assignee:
  - '@claude'
created_date: '2026-07-31 20:37'
updated_date: '2026-07-31 21:09'
labels: []
dependencies: []
priority: high
type: enhancement
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
There is currently no visible way to exit the app. Closing the window only hides it (by design, per DESIGN.md), and the tray menu has no clear exit affordance, so users are left with no obvious way to actually quit NIM Proxy Manager.

Add a discoverable Quit action: an application-menu item with the platform-standard accelerator, a tray-menu "Quit" entry, and (if appropriate) an in-app control. Quit behaviour with respect to the proxy is covered by a separate task.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Application menu has a Quit item with the platform-standard accelerator (Cmd+Q on macOS, Alt+F4 / File > Exit on Windows and Linux)
- [x] #2 Tray context menu has a clearly labelled Quit entry
- [ ] #3 Choosing Quit fully terminates the app process on all three platforms (no lingering hidden window or background Electron process)
- [x] #4 Closing the window still only hides it — that existing behaviour is unchanged
- [x] #5 Verified by launching the real app and quitting from each entry point
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Research findings: macOS already gets Quit for free from the appMenu role in menu.js, but Windows and Linux have NO quit item at all (menu.js builds only editMenu, windowMenu and help there), and the only other exit is a tray entry that a user may never look for. There is also no in-app control anywhere in the renderer.
2. Introduce a single requestQuit() path in src/main/index.js and route the tray, the menus and a new IPC call through it, so NCOW-4 has exactly one place to hook proxy shutdown into.
3. menu.js: add a File submenu carrying an Exit item on Windows and Linux; keep the macOS appMenu role as the Cmd+Q source.
4. Add app.quit to CHANNELS in ipc-channels.js and an app-domain handler, so the preload bridge exposes window.nimProxy.app.quit() automatically. Defer the actual quit past the IPC reply so the renderer promise still settles.
5. Renderer: add a visible Quit button to the sidebar footer next to the status pill, wired to the bridge call. No window.confirm.
6. Verify by launching the real app and quitting from each entry point, checking no Electron process survives each time.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design decision: rather than give each exit route its own callback, every route now funnels into app.quit(), and the before-quit event in src/main/index.js is the single choke point. That is what makes the macOS dock Quit and a system logout behave identically to the in-app routes, and it is the hook NCOW-4 will use to stop the proxy.

Changes: menu.js grew a File > Exit item for Windows and Linux (macOS keeps Quit from the appMenu role) and was refactored to export buildMenuTemplate(platform) so the non-macOS branch is testable from a macOS box; ipc-channels.js gained app.quit, which the preload derives automatically; index.js supplies the handler and defers the quit past the IPC reply with setImmediate so the renderer promise settles; the sidebar footer gained a visible Quit button next to the status pill.

Live verification (real app, NIM_PROXY_TEST_HOME dev run, driven over CDP):
- Main-process menu introspection returned: "NIM Proxy Manager" > "Quit NIM Proxy Manager [CommandOrControl+Q] <quit>". Observed on the live Menu object, not from source.
- Sidebar Quit button clicked through the renderer: process list went from one Electron pid to none.
- Apple Event quit (the same path as the dock Quit and a logout): process list went to none.
- Window close with the app still running: window count 1, isVisible false, isDestroyed false, process alive - closing still only hides.
- Quit with the window already hidden (exactly what the tray item invokes) terminated the process cleanly.
- CDP screenshot of the renderer confirms the Quit button renders in the sidebar footer beside the status pill.
- npm test 112/112.

Verification gaps, deliberately not papered over:
- AC 3 left UNCHECKED: only macOS could be executed here. Windows and Linux were not booted, so "terminates on all three platforms" is not proven. The Windows/Linux File > Exit item is covered by a template unit test only.
- The tray Quit item was not clicked: driving the macOS menu-bar tray needs mouse control, and this environment is denied assistive access. Its click handler is unit-tested (test/main/tray.test.js) and the app.quit() it calls was exercised live.
- Electron role-based menu items carry no JS click handler, so menuItem.click() on the Quit role is a no-op by design - that is why the menu was verified by introspection plus the Apple Event path rather than by a synthetic click.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a discoverable exit: a File > Exit item on Windows and Linux (macOS already had Cmd+Q from the appMenu role), and a visible Quit button in the sidebar footer backed by a new app:quit IPC channel. All routes funnel into app.quit() so the before-quit handler in index.js is the single shutdown choke point, which also covers the macOS dock Quit and a logout - and gives NCOW-4 one place to hook proxy shutdown. Closing the window still only hides it. Verified live over CDP: menu introspection showed the real Quit item and accelerator, the sidebar button and an Apple Event quit each left no Electron process, and a window close left the window hidden but alive. npm test 112/112. Not verified: Windows and Linux termination (AC 3, left unchecked - neither platform can be booted here) and a real tray click (assistive access denied; its handler is unit-tested and its target exercised live).
<!-- SECTION:FINAL_SUMMARY:END -->
