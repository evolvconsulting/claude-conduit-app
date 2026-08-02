---
id: NCOW-10.1
title: >-
  Implement auto-update mechanism: in-app checker, proxy-restart handling,
  graceful degradation
status: In Progress
assignee: []
created_date: '2026-08-02 01:07'
updated_date: '2026-08-02 01:31'
labels: []
dependencies: []
references:
  - docs/distribution.md
parent_task_id: NCOW-10
priority: high
type: feature
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the core auto-update mechanism for shipped builds: choose and document the update mechanism (electron-updater backed by a GitHub Releases feed, per NCOW-10s own research — electron-builder already emits latest.yml/latest-mac.yml/latest-linux.yml into dist/ per NCOW-9, no extra config needed there), wire an in-app update checker into the app, and define/implement how the running LiteLLM proxy behaves across an app update/restart.

Per the campaign tracker (doc-4, Confirmed at init 2026-08-01): ship this UNSIGNED for now. macOS Squirrel.Mac auto-update requires real code-signing certs, which are not yet available — document macOS as notify-only fallback (link to the release) until certs land. This explicitly supersedes NCOW-10s own earlier implementation note about a fully signed macOS path; the user re-confirmed "queue it now, unsigned" at this campaign rounds init and it is not to be re-litigated. Windows NSIS and Linux AppImage do not strictly require signing for electron-updater to function, so they should get a real working silent-update path (verified separately in the follow-on verification subtask).

Update check failures (offline, rate-limited, GitHub API error, no release found) must degrade gracefully and never block or delay app startup.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Update mechanism chosen and documented (electron-updater + GitHub Releases feed), including a per-platform support matrix and known limitations — explicitly stating macOS is notify-only pending code-signing certificates
- [ ] #2 In-app update check exists and tells the user when a newer version is available
- [ ] #3 On platforms where silent/auto-update is not available (macOS, until signed), the app notifies the user with a link to the GitHub Release instead of failing silently or doing nothing
- [ ] #4 Update check failures (offline, rate-limited, no release found, API error) degrade gracefully and never block or delay app startup
- [ ] #5 Behaviour of the running LiteLLM proxy across an app update/restart is defined and implemented
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
electron-updater + GitHub Releases feed (no build-config changes needed -- electron-builder already infers repositoryInfo from package.json's repository field per NCOW-9, which drives both latest*.yml and the runtime app-update.yml). Split into: (1) src/engine/updateCheck.js -- pure, injected-fetch GitHub Releases API version check, used directly on macOS and as the graceful-degradation backbone; (2) src/main/autoUpdate.js -- Electron-layer orchestrator, platform-branches into either the engine's GitHub check (macOS, notify-only, never touches electron-updater) or electron-updater's silent download path (Windows NSIS/Linux AppImage); (3) IPC channels update:check/update:install/update:status-changed wired from main/index.js, fired once unawaited shortly after launch so it can never block startup; (4) src/renderer/components/update-banner.js -- small dismissible non-blocking banner (never window.confirm/alert); (5) docs/auto-update.md recording the mechanism decision, per-platform matrix, and proxy-restart design (docs/distribution.md deliberately untouched, reserved for NCOW-10.2).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented by worker. npm test: 214/214 passing (178 original + 36 new: 13 test/engine/updateCheck.test.js, 11 test/main/autoUpdate.test.js, 5 test/main/auto-update-wiring.test.js, 7 test/renderer/update-banner.test.js). npm run licenses regenerated src/assets/licenses.json for new dep electron-updater@6.8.9 (MIT, does not affect AGPL-because-of-pm2 reasoning). npm run pack (electron-builder --dir, arm64) succeeds with electron-updater bundled in app.asar; electron-updater lazily required inside app.whenReady() (guarded, regression-tested) since it touches electron.app at module load and would crash under plain node --test otherwise. Live E2E launch under NIM_PROXY_TEST_HOME NOT run (sandbox couldn't background the packed binary) -- acceptable, out of scope for this task (that's NCOW-10.3). Per-AC evidence: AC1 -- docs/auto-update.md (new file, docs/distribution.md untouched) documents decision + per-platform matrix + macOS notify-only-pending-certs. AC2 -- update:check IPC + automatic startup check + update-banner.js renders notify-only/downloaded states. AC3 -- macOS path never calls electron-updater, only the GitHub API check; renderer notify-only branch opens release URL via allowlisted app:open-external channel. AC4 -- every updateCheck.js failure mode (404/403/429/5xx/malformed JSON/network error/timeout) resolves {ok:false} not throw; autoUpdate.js never throws out of checkForUpdates(); startup call is fire-and-forget, never awaited. AC5 -- installUpdateAndRestart() reuses the single existing createProxyShutdown()/stopProxyForShutdown() call site, stops status poller first, sets shuttingDown latch, then quitAndInstall(); autoInstallOnAppQuit explicitly false (avoids racing electron-updater's internal before-quit handler against async proxy-stop). Branch feat/NCOW-10.1-auto-update-mechanism pushed, 4 commits ahead of dev, tree clean. Files touched: docs/auto-update.md, src/engine/updateCheck.js, src/main/autoUpdate.js, src/main/index.js, src/main/ipc-channels.js, src/renderer/app.js, src/renderer/components/update-banner.js, src/renderer/styles/app.css, package.json, package-lock.json, src/assets/licenses.json, test/engine/updateCheck.test.js, test/main/autoUpdate.test.js, test/main/auto-update-wiring.test.js, test/renderer/update-banner.test.js.

REVIEW PASS 1 (opus): request_changes. Confirmed AC indices: [1, 4, 5] (independently verified -- docs/auto-update.md substantive, docs/distribution.md provably untouched; every updateCheck.js failure path resolves not throws; installUpdateAndRestart correctly reuses the single stop-proxy call site with sound ordering, no loop/double-stop). NOT confirmed: AC2/AC3 -- blocking finding: the startup update-status broadcast (src/main/index.js:167-169, fires next microtask after whenReady) can arrive before the renderer subscribes (src/renderer/app.js:55, after 3 awaited IPC round trips including pm2Control.ensureConnected which can take 1s+ on a cold pm2 daemon) with no cached-status replay and no UI path to manually re-check -- so on macOS (the one notify-only platform) the update notification can be silently dropped, which is exactly what AC3 forbids. Minor findings: docs/auto-update.md:72 and a commit body both say the check 'fires after a few seconds' but it actually fires on the next microtask (doc/code mismatch, same root cause); a test name in test/main/autoUpdate.test.js:206 overstates its coverage (does not cover stopProxyForShutdown rejecting, though that path is safe today); update-banner.js:46 install-button handler is {once:true} so an ALREADY_INSTALLING failure leaves it permanently dead with no feedback. Reviewer independently re-ran npm test: 214/214 passing. Fix required before this can re-enter review: cache the last update status in createAutoUpdate and have the renderer request it (or re-check) immediately after subscribing, OR wire a 'Check for Updates' menu item to update:check, OR actually delay the startup check to match the documented 'a few seconds after launch' behavior (e.g. fire on did-finish-load or a real setTimeout). NOTE: test/main/auto-update-wiring.test.js:60 pins the literal startup-check source text and will need updating alongside any fix.
<!-- SECTION:NOTES:END -->
