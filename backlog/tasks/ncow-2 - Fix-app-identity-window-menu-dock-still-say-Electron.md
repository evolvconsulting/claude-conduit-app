---
id: NCOW-2
title: 'Fix app identity: window/menu/dock still say ''Electron'''
status: Done
assignee:
  - '@claude'
created_date: '2026-07-31 20:36'
updated_date: '2026-07-31 21:01'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The macOS application menu, the dock tooltip/mouseover, and the window title show "Electron" instead of "NIM Proxy Manager". This is the default Electron app name leaking through because the app name is not set early enough in the main process (and/or the packaged bundle metadata is not applied when running from source).

Users see a generic "Electron" app rather than the product, both when running from source and when checking the running app in the dock/taskbar.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 macOS application menu title reads "NIM Proxy Manager"
- [x] #2 Dock icon mouseover / taskbar entry reads "NIM Proxy Manager"
- [x] #3 Window title reads "NIM Proxy Manager"
- [x] #4 Tray tooltip reads "NIM Proxy Manager"
- [x] #5 Correct name shows both in `npm run dev` (from source) and in a packaged build from `npm run pack`
- [x] #6 Verified by launching the real app, not by code reading
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Diagnosis (verified empirically): a packaged build is already correct - the .app bundle has CFBundleName = NIM Proxy Manager and macOS reports the process by that name. A dev run reports the process as Electron because on macOS the menu-bar title and dock tooltip come from the running bundle Info.plist (node_modules/electron/dist/Electron.app), not from package.json or app.setName(). app.getName() already returns NIM Proxy Manager in dev.
2. Add scripts/patch-dev-bundle-name.js: macOS-only, idempotent, no-op elsewhere. Rewrites CFBundleName and CFBundleDisplayName in the local Electron.app Info.plist to productName, then re-signs ad-hoc because editing Info.plist breaks the seal and an invalid signature will not launch on Apple Silicon. Reverts the plist if re-signing fails.
3. Wire as npm predev/prestart; keep it safe to run by hand for the documented electron --dev workflow.
4. Confirm window title and tray tooltip already read correctly.
5. Document in CLAUDE.md that npm install wipes the patch and predev re-applies it.
6. Verify by launching the real app and reading back the macOS process name.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification evidence (all from the running app, screenshots taken with screencapture and read back):
- Dev run BEFORE: menu bar read "Electron"; lsappinfo LSDisplayName = Electron.
- Dev run AFTER: menu bar screenshot reads "NIM Proxy Manager"; window title bar reads "NIM Proxy Manager"; lsappinfo LSDisplayName (the string macOS uses for the dock mouseover) = "NIM Proxy Manager".
- Packaged build from npm run pack (dist/mac-arm64): Info.plist CFBundleName and CFBundleDisplayName = NIM Proxy Manager; launched it and the menu bar screenshot plus LSDisplayName both read "NIM Proxy Manager".
- Tray tooltip: literal in src/main/tray.js and asserted by test/main/tray.test.js (setToolTip receives "NIM Proxy Manager - <status>"). Not screenshot-verified because the tooltip only renders on a real mouse hover, which this environment cannot drive.
- npm test: 105 passing, 0 failing (was 101 before; 4 added in test/main/app-identity.test.js).

Two findings worth keeping:
1. Re-signing after editing Info.plist is mandatory - the plist is inside the code-signature seal and an invalid signature is killed at launch on Apple Silicon.
2. lsregister -f is equally mandatory and was NOT obvious: with the plist correctly rewritten and re-signed, the menu bar still showed "Electron" until the bundle was re-registered with LaunchServices. Verified by screenshot both before and after the refresh.

Scope addition approved by the user mid-task: npm run pack and npm run dist were already failing schema validation on the committed electron-builder.yml (linux.desktopName was removed in electron-builder 26, whose LinuxConfiguration is additionalProperties:false), so no artifact could be built at all. Replaced it with syncDesktopName plus desktop.entry.StartupWMClass, preserving the original WM_CLASS intent. npm run pack now succeeds.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A packaged build was already named correctly; the "Electron" the user saw was a macOS source run, where the menu-bar title and dock tooltip come from the vendored node_modules Electron.app Info.plist rather than package.json or app.setName(). Added scripts/patch-dev-bundle-name.js (macOS-only, idempotent, reverts on failure) which rewrites CFBundleName/CFBundleDisplayName, re-signs ad-hoc so the bundle still launches on Apple Silicon, and refreshes LaunchServices - without that last step the rename has no visible effect at all. Wired it into npm predev/prestart and documented the constraint in CLAUDE.md. Also fixed electron-builder.yml, which had been failing schema validation outright (removed linux.desktopName in favour of desktop.entry.StartupWMClass), so packaging works again. Verified by launching both the source run and a fresh npm run pack build and screenshotting the menu bar and window title, plus lsappinfo for the dock name; npm test 105/105.
<!-- SECTION:FINAL_SUMMARY:END -->
