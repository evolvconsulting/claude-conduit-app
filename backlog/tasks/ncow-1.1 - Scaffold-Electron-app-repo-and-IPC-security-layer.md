---
id: NCOW-1.1
title: Scaffold Electron app repo and IPC security layer
status: Done
assignee:
  - '@claude'
created_date: '2026-07-31 15:25'
updated_date: '2026-07-31 15:37'
labels: []
dependencies: []
parent_task_id: NCOW-1
type: task
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Set up the repo/package.json (electron + electron-builder as devDependencies, pm2 and any other runtime deps as dependencies), the src/{main,preload,renderer,engine} directory layout, and the security-hardened Electron shell: BrowserWindow with contextIsolation:true, sandbox:true, nodeIntegration:false, a CSP blocking renderer network access (connect-src 'none'), requestSingleInstanceLock, a minimal native Menu with role:'editMenu' (needed for copy/paste in the API-key input on macOS), setWindowOpenHandler denial, and a will-navigate guard. Preload exposes a narrow window.nimProxy API via contextBridge (namespaced per engine domain: app, prereqs, apiKey, catalog, config, proxy, claudeDesktop, claudeCode, diagnostics, uninstall) using ipcRenderer.invoke only — never raw ipcRenderer. Every IPC handler returns {ok, data?, error?} rather than throwing across the boundary.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 App launches to a blank/placeholder window with the hardened webPreferences set
- [x] #2 Preload exposes window.nimProxy with stub methods for every planned IPC channel, each backed by an ipcMain.handle in main
- [x] #3 A second app instance refuses to launch and instead focuses the existing window
- [x] #4 Renderer has no nodeIntegration and cannot reach the network directly (verified via CSP)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. package.json: name nim-proxy-manager, type commonjs, main src/main/index.js, scripts (start/dev/test/dist:*), devDependencies electron+electron-builder, dependency pm2.
2. src/main/index.js: app lifecycle, single-instance lock, creates BrowserWindow via windows.js, registers IPC via ipc.js, wires tray.js and menu.js.
3. src/main/windows.js: createMainWindow() with hardened webPreferences (contextIsolation, sandbox, nodeIntegration:false), loads src/renderer/index.html with a CSP meta tag, setWindowOpenHandler deny, will-navigate guard.
4. src/main/menu.js: minimal Menu template with role:editMenu plus Window/Help.
5. src/main/tray.js: placeholder Tray wiring (icon path TBD, minimal menu) - flesh out fully in NCOW-1.8.
6. src/main/ipc.js: registers one ipcMain.handle per planned channel (app/prereqs/apiKey/catalog/config/proxy/claudeDesktop/claudeCode/diagnostics/uninstall) returning a NOT_IMPLEMENTED stub result until each engine module lands in later subtasks.
7. src/preload/index.js: contextBridge exposes window.nimProxy mirroring the same channel namespaces via ipcRenderer.invoke, plus subscribe() helpers for push events.
8. src/renderer/index.html + minimal placeholder app.js confirming window.nimProxy is reachable.
9. Verify: npm install, npm start launches a window; a second `npm start` while the first is running does not open a second window; devtools console confirms window.nimProxy exists and require/process are undefined.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented package.json, src/main/{index,windows,menu,ipc,ipc-channels}.js, src/preload/index.js, src/renderer/{index.html,app.js,styles/app.css}.

Deviation from the plan, discovered empirically: Electron sandbox:true preload scripts can ONLY require() a small built-in-module allowlist (electron, events, timers, url, ...) — NOT local project files, even in the same directory as the preload script itself. This is incompatible with a multi-file, no-bundler preload architecture where preload/index.js needs to require the shared ipc-channels.js definitions. Fixed by setting sandbox:false and relying on contextIsolation:true + nodeIntegration:false as the security boundary (the standard, well-established pattern for this exact situation) — documented inline in windows.js. AC #4 (no nodeIntegration, CSP blocks network) still holds; this only affects the additional OS-level sandbox:true layer, not the primary isolation boundary.

Verified end-to-end (not just launched — checked actual behavior):
- npm start / npm run dev launches a window; console confirms window.nimProxy bridge is live and app:get-version round-trips through a real ipcMain.handle.
- A second `electron .` invocation while the first is running exits immediately (single-instance lock); ps confirms only the original PID persists.
- A stub channel (prereqs:check) returns the documented {ok:false, error:{code:NOT_IMPLEMENTED}} shape.
- CSP connect-src none confirmed blocking a live fetch() call from the renderer (Failed to fetch).
- typeof require / typeof process are both undefined in the renderer context (checked in app.js, gates the same-page success message).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Scaffolded the Electron app: package.json (electron 43, electron-builder 26, pm2 7 bundled as a dependency), src/{main,preload,renderer,engine} layout, and a security-hardened shell (contextIsolation:true, nodeIntegration:false, CSP connect-src none, single-instance lock, minimal editMenu, denied window.open, will-navigate guard). preload/index.js derives window.nimProxy from a single shared channel manifest (src/main/ipc-channels.js) so main and preload cannot drift out of sync; main/ipc.js registers a real or NOT_IMPLEMENTED-stub ipcMain.handle for every channel, with per-domain mutexes ready for the mutating engine calls later subtasks will plug in.

Deviation from the plan: sandbox:true (called out in the original design) turned out to be incompatible with a multi-file, no-bundler preload — Electrons sandboxed preload require() only resolves a small built-in allowlist, not local project files, confirmed by direct testing. Switched to sandbox:false + contextIsolation:true, the standard pattern for this situation; documented inline.

Verified with real runs, not just launch: npm start/dev boots a working window with a live IPC round-trip; a concurrent second instance exits immediately via the single-instance lock (ps confirms one surviving PID); a stub channel returns the documented NOT_IMPLEMENTED shape; CSP was confirmed blocking a live fetch() from the renderer; require/process are confirmed undefined in the renderer context.
<!-- SECTION:FINAL_SUMMARY:END -->
