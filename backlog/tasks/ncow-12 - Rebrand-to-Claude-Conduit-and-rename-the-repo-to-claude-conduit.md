---
id: NCOW-12
title: Rebrand to Claude Conduit and rename the repo to claude-conduit
status: To Do
assignee: []
created_date: '2026-07-31 21:50'
labels: []
dependencies: []
priority: high
type: task
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rename the product from "NIM Proxy Manager" to "Claude Conduit", and the repository from nvidia-nim-proxy (GitHub remote evolvconsulting/nvidia-cowork) to claude-conduit.

SEQUENCING: this should land BEFORE NCOW-9 (publish and install story) and NCOW-10 (auto-update). Renaming after publishing means broken download links, a moved repo URL, a changed appId, and an update feed that no longer matches installed builds. It is also a natural fit alongside NCOW-14, which drops the NVIDIA-specific framing from the product itself.

The rename reaches further than strings. At minimum it touches: package.json name and productName; electron-builder appId (com.evolvconsulting.nimproxymanager), productName, dmg title, and the Linux desktopName and StartupWMClass; the app icon and the icon source; the REPO_URL constant shared by the menu, the About dialog and the IPC external-URL allowlist; the macOS dev-bundle rename script; the tray tooltip and menu labels; README, DESIGN.md and CLAUDE.md; and the generated licenses.json.

It also touches things with USER DATA behind them, which need a migration decision rather than a find and replace: the config directory (~/.config/claude-nim-proxy and the Windows equivalent), the pm2 app name (litellm-nim), the Electron userData directory (which is derived from productName and holds the encrypted API key), and the dedicated entry this app writes into Claude Desktop configLibrary. Decide for each whether to migrate an existing install, leave it on the old path, or require a reinstall, and say so in the README.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Product name reads Claude Conduit everywhere the user can see it: window title, macOS menu bar, dock and taskbar, tray tooltip, About dialog, installer and desktop entry
- [ ] #2 The repository is renamed to claude-conduit and every hardcoded URL in the app, tests and docs points at the new location
- [ ] #3 electron-builder appId, productName, dmg title and Linux desktop identifiers are updated, and a packaged build carries them
- [ ] #4 A documented decision covers each piece of persisted state (config directory, pm2 app name, Electron userData holding the encrypted key, Claude Desktop entry): migrate, leave, or reinstall
- [ ] #5 Whatever migration is chosen is implemented and verified against a real pre-rename install, including that the stored API key is still readable afterwards
- [ ] #6 No occurrence of the old product name or repo slug remains in src, tests, docs or build config except where deliberately retained for migration
- [ ] #7 README documents what existing users must do, if anything
- [ ] #8 `npm test` passes and a packaged build launches under the new identity
<!-- AC:END -->
