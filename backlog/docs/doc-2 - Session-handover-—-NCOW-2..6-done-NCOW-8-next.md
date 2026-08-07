---
id: doc-2
title: 'Session handover — CCA-2..6 done, CCA-8 next'
type: guide
created_date: '2026-07-31 21:57'
updated_date: '2026-07-31 21:57'
---
Read this before doing anything else, then read `CLAUDE.md`. This covers where the
campaign stands, what is decided, and the traps that cost the most time to find.

## Status

Five tasks completed this session: **CCA-2, 3, 4, 5, 6** (all Done, all with full
Implementation Notes — read those rather than re-deriving anything). `npm test` is
**141/141**, up from 101 at the start of the session.

Five new tasks were created from user direction: **CCA-11 through CCA-15**.

**Working order agreed with the user: CCA-8 → CCA-12 → CCA-14 → CCA-15.**

## Git state: NOTHING IS COMMITTED

This is the single most important thing on this page. The entire session's work is
**uncommitted in the working tree** on branch `feat/nim-proxy-manager`. Seventeen modified
files and thirteen new untracked ones, including `LICENSE`, `src/main/shutdown.js`,
`src/assets/licenses.json`, two renderer dialog components, two scripts, and six test
files. No commit was made because none was requested.

Confirm with the user whether to commit before doing anything destructive. `git stash`,
branch switching, or a careless `git checkout` loses a full session of verified work.

## Decisions already made — do not relitigate

1. **The app is AGPL-3.0-or-later.** Not a preference: pm2 is AGPL-3.0, is bundled, and is
   linked through `require('pm2')` rather than a subprocess boundary. The user chose this
   knowingly. A test fails if pm2's license and the app's stop agreeing, so swapping pm2
   forces the question to be reopened deliberately.
2. **Quitting stops the proxy, unconditionally.** No opt-out preference. This reversed a
   documented v1 design decision; DESIGN.md §7.4 and CLAUDE.md were corrected to match.
   A preference was deliberately deferred until a settings surface exists (CCA-13).
3. **CCA-7 (Setup sub-nav) is parked** behind CCA-15, because CCA-13 moves Prerequisites
   into System Settings and CCA-15 turns per-connection config into a connection library.
   The sub-nav requirement is not dropped — satisfy it inside CCA-15.
4. **The app will be code-signed before release.** Plan CCA-10 for a properly signed
   Squirrel.Mac auto-update path, not a macOS notify-only fallback.
5. **Licenses UI is a scrollable dialog with expandable per-package text**, not a sidebar
   route.

## Next task: CCA-8 (model alias rename)

Small, self-contained, and chosen because it survives the CCA-14 provider abstraction
unchanged — the exposed alias names are a client-facing contract regardless of upstream.
Its Implementation Notes list every current occurrence of `nim-large` / `nim-small`.

The real config directory on this machine has a working manifest (port 4000, primary
`meta/llama-3.3-70b-instruct`, small `meta/llama-3.1-8b-instruct`), so the end-to-end check
can start the proxy without running setup first.

## Verification technique that actually works here

Live testing caught three real defects this session that unit tests did not. Use it.

- **Drive the renderer over CDP:** launch with `--remote-debugging-port=9222`, connect to
  the `page` target, `Runtime.evaluate`. Always subscribe to `Runtime.exceptionThrown` or
  renderer errors are completely invisible.
- **Drive the main process over the Node inspector:** launch with `--inspect=9229` and
  connect to the `node` target. `require` is not defined in that context — use
  `process.mainModule.require('electron')`. This is how the live `Menu`, `BrowserWindow`
  and `app` objects get inspected and clicked.
- **Screenshot the renderer** with CDP `Page.captureScreenshot`, not `screencapture` —
  it is independent of where the window sits and of which app is frontmost.
- **Screenshot the macOS menu bar** with `screencapture -x -R 0,0,700,30` after
  `osascript -e 'tell application id "com.github.Electron" to activate'`.
- **Assistive access is denied** in this environment, so System Events keystrokes and menu
  queries fail. Clicking the tray, or sending ⌘Q, is not possible.
- **`menuItem.click()` is a no-op on `role`-based items** (they have no JS handler). Custom
  items with a `click` callback are invokable. Use an Apple Event quit
  (`osascript -e 'tell application id "com.github.Electron" to quit'`) to exercise the
  real quit path instead.
- Kill the **process group**, and prefer `pkill -f "node_modules/electron/dist/Electron.app"`.

## Traps found the hard way this session

- **macOS dev-run naming needs three steps, not one.** Rewriting `CFBundleName` in the
  vendored `Electron.app` does nothing on its own: the bundle must be re-signed (the plist
  is inside the signature seal, and an invalid signature is killed at launch on Apple
  Silicon) **and** `lsregister -f` must run, or macOS serves a stale LaunchServices record
  and the rename has zero visible effect. `npm install` reverts it; `predev` re-applies.
- **A guard placed after an `await` is not a guard.** Two fast clicks on About both sailed
  past `if (openDialog) return` and stacked two modals, because `openDialog` is only
  assigned after the awaited version lookup. Both dialogs now use a separate synchronous
  latch.
- **Never `pm2 kill`.** pm2 uses the shared default `PM2_HOME` (`~/.pm2`). On this machine
  it also supervises an unrelated `spawner` app with days of uptime that a daemon kill
  would have taken down. Stop the `litellm-nim` app only.
- **The shutdown timeout must exceed pm2's `kill_timeout`** (10s in the generated ecosystem
  config), because pm2 is what escalates SIGINT to SIGKILL. It is set to 15s. Timing out
  below that abandons the stop right before pm2's forced kill lands.
- **pm2's `LICENSE` file contains one line: `GNU-AGPL-3.0.txt`** — a pointer to the real
  34KB text beside it. The license collector takes the longest license-ish file, not the
  first.
- **`package.json`'s license field has four historical shapes.** tv4 declares an *array*
  under `license` and initially rendered as UNKNOWN.
- **The renderer CSP sets `connect-src 'none'`**, so it cannot `fetch()` even its own
  bundled files. `licenses.json` therefore comes over IPC.
- **`npm run pack` / `dist` were broken at HEAD** by `linux.desktopName`, removed in
  electron-builder 26 (its `LinuxConfiguration` is `additionalProperties: false`, so the
  whole build failed validation). Fixed under CCA-2 — if packaging breaks again, check the
  schema before anything else.

## Known gaps, deliberately left

- **CCA-3 AC #3 is unchecked**: termination was only verified on macOS. Windows and Linux
  were never booted. The File → Exit item there is covered by a template unit test only.
- **The tray Quit item has never been clicked** — assistive access is denied. Its handler is
  unit-tested and its target (`app.quit()`) was exercised live.
- **Help → Licenses does nothing if clicked in the first second after launch**: the menu
  event is fire-and-forget and the renderer has not yet subscribed. Clicking again works.
  Judged not worth a handshake; revisit if it annoys anyone.
- **One package, `cli-tableau`, shows license UNKNOWN** because it declares nothing in
  `package.json`. It ships an MIT `LICENSE` file, which the UI displays in full. Inferring
  an identifier from text would be guessing.

## Machine state left behind

`litellm-nim` is **stopped** in pm2 — the state it was in before the session. The unrelated
`spawner` pm2 app is untouched and still online. A packaged build sits in
`dist/mac-arm64/`. `~/.config/claude-nim-proxy/` holds a real working configuration.
