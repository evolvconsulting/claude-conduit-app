---
id: CCA-1.10
title: 'Package and document distribution for macOS, Windows, and Linux'
status: Done
assignee:
  - '@claude'
created_date: '2026-07-31 15:27'
updated_date: '2026-07-31 19:56'
labels: []
dependencies:
  - CCA-1.8
parent_task_id: CCA-1
type: task
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add electron-builder config producing macOS dmg/zip (universal), Windows NSIS installer plus portable exe, and Linux AppImage plus deb, for unsigned personal-distribution builds (no paid Apple Developer ID or Windows code-signing cert assumed). Write README documentation covering: the unsigned-app Gatekeeper workaround on macOS (right-click Open, or xattr -dr com.apple.quarantine) and the SmartScreen workaround on Windows (More info, Run anyway), the approximately 150-200MB per-platform artifact size as an accepted tradeoff, prerequisites (Python for litellm auto-install), and basic usage. Use whichever Electron version is current-stable at implementation time rather than a pinned guess.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 npm run dist (or per-platform dist:mac/dist:win/dist:linux) produces installable artifacts for all three OS targets
- [x] #2 At least the macOS build has been smoke-tested launching via the documented Gatekeeper workaround
- [x] #3 README documents the unsigned-app workarounds, prerequisites, and basic usage
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. electron-builder config in electron-builder.yml (not package.json's build key, so the non-obvious reasoning can be recorded as real comments — the schema rejects '//' keys): mac dmg+zip universal, win nsis+portable, linux AppImage+deb, output to dist/, buildResources build/.
2. Guard the two packaging hazards specific to this app: an allowlist 'files' so the gitignored .env holding a real NVIDIA key can never be packaged, and asarUnpack for pm2 (it spawns its daemon by real script path, which is not executable from inside app.asar — the proxy could never start otherwise).
3. macOS signing: ad-hoc (identity '-') because a fully unsigned binary will not launch on Apple Silicon, plus build/entitlements.mac.plist with disable-library-validation, without which the hardened runtime rejects Electron's own dylibs.
4. Generate the icon assets the targets need from build/icon.svg via npm run icons.
5. Build all three platforms, verify the artifacts and that no secret leaked.
6. Smoke-test the PACKAGED macOS app: launch it, drive it over CDP, and start a real proxy from inside the bundle to prove the asar-unpacked pm2 path works. Separately prove the documented Gatekeeper workaround on a deliberately quarantined copy.
7. Write README covering prerequisites, per-platform install with the Gatekeeper/SmartScreen workarounds, real measured artifact sizes, usage, gotchas, building from source, and uninstall.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built and verified on macOS 25.6.0 (Apple Silicon) with electron-builder 26.15.3 and Electron 43.2.0 (current stable at implementation time, already the project's devDependency).

CONFIG LOCATION: electron-builder.yml rather than package.json's 'build' key. Tried package.json first; electron-builder's schema validator rejects unknown '//'-prefixed comment keys outright, and the reasoning below is exactly the kind that must not be lost. YAML lets it live next to the settings.

TWO PACKAGING HAZARDS SPECIFIC TO THIS APP, both handled deliberately:
1. Secret leakage. electron-builder packs from the FILESYSTEM, not from git, so the gitignored .env holding a real working NVIDIA API key would otherwise have been a candidate for inclusion. 'files' is an allowlist (src/**/* + package.json; production node_modules are always added automatically) with explicit !**/.env negations on top. VERIFIED: 'find' over the built .app returns no .env, and an asar listing greps clean for .env, test/, backlog/ and DESIGN.md.
2. pm2 inside asar. pm2 starts its daemon by SPAWNING a real script path (God.js / Daemon.js). Paths inside app.asar are readable through fs but cannot be executed as a child process, so the proxy would never start from a packaged build. Fixed with asarUnpack '**/node_modules/pm2/**'. VERIFIED both statically (God.js and Daemon.js present under Contents/Resources/app.asar.unpacked/node_modules/pm2/lib/) and dynamically (the packaged app started a real pm2-supervised litellm proxy, status running, pid 81682).

MACOS SIGNING — two non-obvious constraints, neither optional:
- identity '-' (ad-hoc), not unsigned. A completely unsigned binary does not launch AT ALL on Apple Silicon. Ad-hoc satisfies the loader while still tripping Gatekeeper, which is what the README workaround addresses.
- build/entitlements.mac.plist with com.apple.security.cs.disable-library-validation. electron-builder emits an explicit warning that ad-hoc + hardenedRuntime without this entitlement causes launch failures, because library validation rejects Electron's own dylibs (signed by a different team). Also includes allow-jit and allow-unsigned-executable-memory for V8 under the hardened runtime. VERIFIED applied: 'codesign -d --entitlements -' on the built app lists all three keys; signature reports flags=0x10002(adhoc,runtime). Note electron-builder prints that warning unconditionally whenever identity is '-' and hardenedRuntime is on, even when the entitlement IS present — confirmed by inspecting the actual signature rather than trusting the log.

LINUX: added desktopName + syncDesktopName after electron-builder warned that without them desktop environments cannot associate the running window with the .desktop entry via app_id/WM_CLASS. That matters more than usual here because closing the window only HIDES it, so the user needs the taskbar entry to map back to the app to restore it.

AC#1 EVIDENCE — all three targets cross-built from macOS, six artifacts in dist/:
  NIM Proxy Manager-0.1.0-universal.dmg        224 MB
  NIM Proxy Manager-0.1.0-universal-mac.zip    224 MB
  NIM Proxy Manager Setup 0.1.0.exe (NSIS)      97 MB
  NIM Proxy Manager 0.1.0.exe (portable)        97 MB
  NIM Proxy Manager-0.1.0.AppImage             128 MB
  nim-proxy-manager_0.1.0_amd64.deb             98 MB
The mac build is genuinely universal: 'lipo -archs' on the bundle executable reports 'x86_64 arm64'. Windows and Linux artifacts were produced on macOS (electron-builder downloads the nsis/fpm/appimage toolchains itself) but were NOT launch-tested — no Windows or Linux machine is available here. AC#2 only requires the macOS smoke test; flagging the gap explicitly rather than implying broader coverage. Actual sizes (97-224 MB) are documented in the README instead of the task description's 150-200 MB estimate; the mac artifacts exceed it because universal carries two architectures.

AC#2 EVIDENCE — the PACKAGED app (dist/mac-arm64/NIM Proxy Manager.app), not a source run, driven over CDP:
  - Gatekeeper: copied the bundle, set com.apple.quarantine on it, and 'spctl -a -vv' REJECTED it — i.e. the warning users will hit is real and reproduced. Then 'xattr -dr com.apple.quarantine' cleared the attribute (reads <none> afterwards), which is exactly the README's documented workaround.
  - Launched the packaged binary: window rendered, first launch routed to Setup, IPC bridge alive (app.getVersion -> 0.1.0).
  - Real NVIDIA key validated through the packaged app: 102 models.
  - Config generated and a REAL proxy started from inside the bundle: status running. Test Connection returned three passes (NIM upstream 45ms, completion 736ms, tool calling 464ms).
  - Note for users: first launch of the packaged app took ~34s while macOS verified the large unsigned bundle; documented in the README so it is not mistaken for a hang.

AC#3 EVIDENCE — README.md written covering: prerequisites (Python only needed for the litellm auto-install; Node and pm2 are bundled; the blocked litellm 1.82.7/1.82.8 malware releases), per-platform install with the macOS right-click-Open and xattr workarounds and the Windows SmartScreen More info -> Run anyway path, real measured artifact sizes as the accepted tradeoff, full usage walkthrough, the hide-vs-quit behaviour and why the proxy deliberately outlives the app, where files live, the DESIGN.md section 12.2 gotchas, the best-effort/unsupported nature of the Claude Desktop writer, building from source, the NIM_PROXY_TEST_HOME safe-testing override, and uninstall. Factual claims were checked against the source rather than written from memory (blocked litellm versions, the --dev gating of NIM_PROXY_TEST_HOME, the entitlements reference).

REGRESSION CHECK: npm test 101/101 throughout, and a third consecutive clean full end-to-end run of the app from source (50/50 assertions, 0 failures) after the tray refactor from CCA-1.8.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added electron-builder packaging (electron-builder.yml) producing six artifacts across all three platforms, cross-built from macOS: universal macOS dmg + zip (224 MB, lipo-verified x86_64+arm64), Windows NSIS installer + portable exe (97 MB), and Linux AppImage (128 MB) + deb (98 MB). Two app-specific packaging hazards were found and fixed: the 'files' allowlist keeps the gitignored .env holding a real NVIDIA API key out of every artifact (verified by searching the built bundle and asar), and pm2 is asar-unpacked because it starts its daemon by spawning a real script path, which is not executable from inside app.asar — without it the proxy could never start from a packaged build. macOS uses ad-hoc signing plus a disable-library-validation entitlement, both required: a fully unsigned binary will not launch on Apple Silicon, and the hardened runtime otherwise rejects Electron's own dylibs; the applied entitlements were confirmed with codesign rather than trusted from build logs. Smoke-tested the packaged macOS app for real: reproduced the Gatekeeper rejection on a deliberately quarantined copy, cleared it with the documented xattr command, then launched the bundle and drove it to validate the live NVIDIA key and start a genuine pm2-supervised proxy from inside the app, with Test Connection passing all three checks. Wrote README.md covering prerequisites, per-platform install with the Gatekeeper and SmartScreen workarounds, real measured sizes, usage, gotchas, building from source and uninstall, with its factual claims checked against the source. Windows and Linux artifacts were built but not launch-tested — no such machine is available here, and AC#2 scopes the smoke test to macOS. npm test 101/101.
<!-- SECTION:FINAL_SUMMARY:END -->
