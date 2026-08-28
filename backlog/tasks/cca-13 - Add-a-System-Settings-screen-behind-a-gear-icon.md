---
id: CCA-13
title: Add a System Settings screen behind a gear icon
status: Done
assignee:
  - '@claude.coder2@evolvconsulting.com'
created_date: '2026-07-31 21:51'
updated_date: '2026-08-28 13:51'
labels: []
dependencies:
  - CCA-14
priority: medium
type: enhancement
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
There is nowhere to change how the app itself behaves. Add a System Settings screen reached from a standard gear icon in the chrome (sidebar footer or header), separate from the per-connection configuration.

The Prerequisites step is the likely occupant: it is a system-level concern (Node, Python, litellm, litellm version, port availability) that a first-run wizard currently owns but that users need to revisit later, and it fits Settings better than it fits Setup. Decide whether Settings replaces the Prerequisites step outright or Setup keeps a first-run copy of it.

Candidate contents, to be confirmed while planning: prerequisite status with the install action; proxy port; log location and log retention; behaviour on quit (see CCA-4, which made stopping the proxy unconditional and noted a preference was deliberately deferred until a settings surface existed); update settings once CCA-10 lands; and a link to Diagnostics.

Coordinate with CCA-7 (Setup sub-nav) and CCA-15 (multiple connections): the split between what is a system setting and what belongs to an individual connection has to be decided once and applied consistently, not negotiated per screen.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A gear icon is present in the app chrome and opens System Settings
- [x] #2 System Settings is reachable from a bare hash route consistent with the existing router scheme
- [x] #3 Prerequisite checks are available from System Settings and can be re-run on demand, with the litellm install action working from there
- [x] #4 A documented decision records whether the Setup Prerequisites step is removed, kept for first run only, or replaced
- [x] #5 The boundary between system-level settings and per-connection settings is written down and followed
- [x] #6 Every setting the screen exposes persists across an app restart and takes effect without a reinstall
- [x] #7 Settings that require a proxy restart to take effect say so, and offer the restart
- [x] #8 Verified by driving the real UI: change each setting, restart the app, confirm it stuck and took effect
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. RECOVERED from a crashed prior session (uncommitted working tree found on feature/CCA-13 at restore, task still To Do, no branch commits) -- verified rather than rewritten. Code: gear icon + #settings hash route (AC1/2); prereqs-panel.js shared component mounted in both setup-view.js and settings-view.js so Setup keeps a first-run copy while Settings re-runs on demand (AC3/4, decision documented in setup-view.js/settings-view.js comments); appSettings.js (quitBehavior, logSizeLimitBytes) as a system-level file deliberately separate from manifest.json's per-connection record, boundary documented in settings-view.js header (AC5); engine-context.updatePort reuses configGen.generateAll and re-applies Claude Desktop/Code config, gated behind a confirm dialog that names the restart up front (AC7); logRetention.js size-based pruning applied at launch and immediately on change.
2. npm test: 602/602 pass as recovered, no code changes needed pre-verification.
3. Live-verify AC6/7/8 by driving the real Electron app (per handover: use the run skill) -- change quit behavior, log limit, and port; restart the app; confirm each persisted and took effect.
4. Record AC evidence, check ACs, mark Done per task-finalization.
5. Commit the recovered + verified work; update claude-conduit-docs tracker (advance cursor to CCA-15, resolve CCA-13); /code-review; push, PR, merge, prune; confirm claude-conduit-app's dev/main lockstep convention before promoting.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
LIVE VERIFICATION (real Electron app, --dev, isolated NIM_PROXY_TEST_HOME, CDP driver — no Playwright dep, hand-rolled WebSocket client): full Setup through a real NVIDIA key (from the repo's gitignored .env, isolated test home only, never touching the real user config at ~/Library/Application Support/Claude Conduit) -> gear icon clicked -> #settings hash route -> prereqs re-check from Settings -> quit-behavior + log-limit + port all changed via the real UI -> REAL app quit -> REAL relaunch -> Settings UI re-read every value from disk correctly (port 4444, quitBehavior leave-running, logSizeLimitBytes 5MB), matching what a second createEngineContext() call in the automated suite already predicted. Also verified the OTHER quitBehavior branch: switched to stop-proxy, quit, confirmed via 'pm2 jlist' that litellm-nim actually stopped (vs. staying online for leave-running) -- both branches of AC#6/#7 exercised for real, not just one.

BUG FOUND AND FIXED by this live verification (would NOT have been caught by npm test — index.js is never require()'d by the suite, see NCOW-10.1's comment): the recovered code's 'before-quit' handler (src/main/index.js) called getAppSettings(), but that name was only destructured inside the app.whenReady().then() callback -- a SIBLING closure to 'before-quit', not an enclosing one. Every real quit (either quitBehavior value -- the crash is on the read, before branching) threw 'ReferenceError: getAppSettings is not defined', which Electron surfaces as a blocking native alert with no visible stack, wedging the whole process (confirmed via 'sample <pid>' showing the main thread stuck in -[NSAlert runModal], then root-caused precisely via Debugger.setPauseOnExceptions over the main process's --inspect port). Fix: hoisted a new 'let getAppSettingsForQuit = null' alongside the file's existing stopProxyForShutdown/stopStatusPoller/shuttingDown hoist-for-cross-closure pattern, assigned it right after the (unchanged, test-asserted-verbatim) destructure, and read getAppSettingsForQuit() from 'before-quit' instead. Re-verified: npm test still 602/602, and a real quit->relaunch round trip (both quitBehavior branches) now completes cleanly with no alert.

AC#3 scope note: 'available from Settings' and 're-run on demand' are live-verified (prereqs-recheck-btn clicked, real check results rendered). The install-litellm sub-clause was NOT freshly triggered live -- this dev machine already has litellm installed, so the Install button never rendered, and uninstalling litellm from a real dev machine to force that branch was judged too disruptive/out of scope for this task. That sub-clause's coverage rests on prereqs-panel.js being the exact same component (not a reimplementation) Setup already exercised pre-CCA-13, plus the unchanged installLitellm() IPC handler.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
System Settings screen behind a gear icon, added System Settings screen behind a gear icon in the sidebar footer (#settings bare hash route). Shares the Prerequisites panel component with Setup (Setup keeps its own first-run gate; Settings re-runs on demand) and adds engine.appSettings.js for quit behavior + log size limit, kept deliberately separate from manifest.json's per-connection record. Port lives in Settings today (documented as a revisit point once CCA-15 decides single- vs multi-proxy). All verified live in a real Electron process (isolated NIM_PROXY_TEST_HOME, real NVIDIA key, no mocks) via a hand-rolled CDP driver: gear icon, hash route, prereqs re-check, and quit-behavior/log-limit/port changes surviving a REAL app quit+relaunch round trip, both quitBehavior branches (proxy left running vs stopped). That live pass caught and fixed a real bug npm test could not see (index.js is never executed by the suite): before-quit referenced getAppSettings from the wrong closure, throwing on every quit and wedging the app behind an invisible native alert -- fixed by hoisting getAppSettingsForQuit the same way stopProxyForShutdown/stopStatusPoller already are. npm test: 602/602 passing after the fix.
<!-- SECTION:FINAL_SUMMARY:END -->
