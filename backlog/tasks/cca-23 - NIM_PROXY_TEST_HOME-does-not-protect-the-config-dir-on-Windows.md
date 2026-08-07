---
id: CCA-23
title: NIM_PROXY_TEST_HOME does not protect the config dir on Windows
status: Done
assignee: []
created_date: '2026-08-02 21:06'
updated_date: '2026-08-03 12:35'
labels:
  - windows
  - safety
dependencies: []
priority: high
type: bug
ordinal: 36000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during CCA-22's wave-6 review (2026-08-02) and independently confirmed live on the real Windows VM by an opus reviewer, not inferred from code.

CLAUDE.md's "Safe manual testing (load-bearing)" section states that NIM_PROXY_TEST_HOME combined with --dev redirects every path the app touches, and calls it 'the only way to click destructive buttons without hitting this machine's real Claude Desktop/Code config'. On Windows that guarantee does not hold for the config dir.

Mechanism: src/main/engine-context.js:53 calls paths.resolveConfigDir({ homedir }), passing ONLY homedir. src/engine/paths.js:41 then resolves opts.appData ?? process.env.APPDATA ?? path.join(homedir, ...). APPDATA is always set on Windows, so the injected homedir is never reached and the app resolves to the real %APPDATA%\\claude-conduit regardless of NIM_PROXY_TEST_HOME.

Confirmed live: a --dev + NIM_PROXY_TEST_HOME run on winvm read the real %APPDATA%\\claude-conduit. The wave-6 worker and reviewer both worked around this by never calling config.generate on Windows, and the reviewer re-hashed all five real config files before and after its run (all SHA-256s byte-identical, only logs/ grew) — so no damage was done, but only because both agents were explicitly warned.

Why this matters beyond tidiness: this is the mechanism that is supposed to make destructive manual testing safe. Any agent or human following CLAUDE.md's documented procedure on Windows is silently operating against the real config dir, including the real Claude Desktop entry and the app's own persisted state. Every future Windows verification task in this project inherits the hazard.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 resolveConfigDir honors an injected homedir/appData override on win32 so that NIM_PROXY_TEST_HOME redirects the config dir on Windows exactly as it does on macOS/Linux
- [x] #2 Verified live on the real Windows VM: a --dev run with NIM_PROXY_TEST_HOME set reads and writes ONLY under the fake home, confirmed by observing the fake path in use and the real %APPDATA%\claude-conduit being untouched (hash or timestamp comparison before/after)
- [x] #3 An audit of the other path resolvers in src/engine/paths.js confirms no sibling function has the same env-var-beats-injected-override bug (or any that do are fixed too)
- [x] #4 A regression test covers the win32 override path using the existing process.platform-injection pattern in test/engine/
- [x] #5 CLAUDE.md's Safe manual testing section is updated if any platform caveat remains after the fix
- [x] #6 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Root cause confirmed: paths.js's resolveConfigDir/resolveLegacyConfigDir/
resolveClaudeDesktopConfigLibraryDir/resolveElectronAppDataDir all resolve win32 paths as
opts.appData ?? process.env.APPDATA ?? path.join(homedir, ...) - correct precedence for a real
Windows run (env can legitimately differ from a bare homedir guess under folder redirection) but
wrong for the NIM_PROXY_TEST_HOME override case, since APPDATA/LOCALAPPDATA are always set on real
Windows. Reversing paths.js's own precedence would break real-Windows correctness, so the fix adds
paths.resolveWindowsAppDataOverrides(homedir) and wires it into engine-context.js and
main/index.js's resolveUserDataPaths() (which had the identical bug via
resolveElectronAppDataDir), gated behind the existing --dev + NIM_PROXY_TEST_HOME condition.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Wave 9 implementation complete, pushed to fix/CCA-23-win32-test-home-config-dir (commits 5fdf28d,
30220e0, 5401d86). Independently verified by the orchestrator: branch/commits exist on origin,
diff vs dev touches exactly src/engine/paths.js, src/main/engine-context.js, src/main/index.js,
test/engine/paths.test.js, CLAUDE.md - no sibling-task files (pm2Control.js, CI/release docs)
touched.

Evidence (worker-reported, pending independent reviewer re-verification): npm test 252/252 in the
worktree. Live winvm verification: source transferred and installed fresh on real win32, npm test
251/252 (the 1 failure is a pre-existing pm2Control.test.js flake attributed to the shared pm2
daemon pid 8832 that must never be touched - unrelated file, out of this task's scope). Functional
proof on winvm: hashed the 5 real %APPDATA%\claude-conduit files before touching anything, drove
the real createEngineContext()+config.generate() under --dev + NIM_PROXY_TEST_HOME with a stub
safeStorage, confirmed all resolved paths landed under the fake home and all 5 config files were
written there; re-hashed the real 5 files afterward - all byte-identical, real Electron userData
dir also confirmed untouched by timestamp. AC#3 audit: resolveConfigDir/resolveLegacyConfigDir/
resolveClaudeDesktopConfigLibraryDir/resolveElectronAppDataDir shared the bug (all fixed);
resolveClaudeCodeSettingsPath/getFilePaths have no env lookup, no bug. Noted but deliberately left
untouched: pm2Control.js's PM2_HOME env fallback is a different, documented design choice (shared
daemon architecture), not the same class of bug. AC1-6 all self-reported true; pending independent
reviewer confirmation.

Wave 9 review (opus): approve. All 6 ACs independently confirmed via fresh live evidence on the
real Windows VM (not code reading) - drove the real createEngineContext()+handlers under --dev +
NIM_PROXY_TEST_HOME, observed all resolved paths (configDir, all ctx.files, claudeCode settings
path, Claude Desktop configLibrary dir, Electron userData dir) land under the fake home; hashed the
7 real %APPDATA%\claude-conduit files (5 config + 2 logs) plus the real nim-key.enc and real
%LOCALAPPDATA%\Claude-3p before and after - all byte-identical, same LastWriteTimeUtc, pm2 daemon
pid 8832 untouched. Independently confirmed the gating (--dev + NIM_PROXY_TEST_HOME both required)
does not invert real-Windows precedence in any of 3 non-test combinations, including a simulated
folder-redirection case where a redirected APPDATA still correctly wins over a homedir guess.
Confirmed the main/index.js bug (resolveElectronAppDataDir via NIM_PROXY_TEST_HOME) is real and
distinct - reviewer noted it as arguably MORE severe than the config-dir bug, since pre-fix it
would have pointed secretStore at the REAL userData dir containing the live encrypted NVIDIA key on
a --dev test-home run. npm test 252/252 on macOS; 15/15 native win32 run of paths.test.js.

Non-blocking findings (low/info, no fix required): (1) call-site wiring itself
(engine-context.js/index.js) has no direct test coverage, only paths.js's exported functions do -
matches this repo's pre-existing pattern (resolveHomedir also untested), satisfies AC#4 as written;
(2) the --dev + NIM_PROXY_TEST_HOME gating condition is duplicated across two call sites rather
than derived from one source of truth - correct today, could drift later; (3) PM2_HOME still
resolves via the real homedir on every platform regardless of test-home (pre-existing, deliberate
shared-daemon design, CCA-26's territory not CCA-23's - flagged only so it isn't mistaken for a
gap this task introduced); (4) full npm test was not re-run natively on win32 (would require a pm2
install on the shared VM) - substituted a native win32 run of the specifically affected test file
plus the full macOS suite, no AC required more.

Scope check: clean, exactly the 5 expected files, no overlap with CCA-25 or CCA-26. Winvm scratch
artifacts (including one with a subtle trailing-space directory name) cleaned up, VM verified left
clean. Approved and ready for the merge queue once the rest of wave 9 settles.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed: on win32, NIM_PROXY_TEST_HOME did not protect the config dir because APPDATA/LOCALAPPDATA
always won over an injected homedir in paths.js's resolvers. Added
resolveWindowsAppDataOverrides(homedir) and wired it into the two test-home call sites
(engine-context.js and main/index.js's resolveUserDataPaths(), which had the identical bug -
independently confirmed by the reviewer to point at the real encrypted NVIDIA key on a
--dev + test-home Windows run before the fix). Real-Windows precedence (env wins, for folder
redirection correctness) is preserved outside the test-home gate - independently verified live on
winvm across 3 non-test gating combinations plus a simulated folder-redirection case.

All 6 ACs independently confirmed by an opus reviewer via fresh live evidence on the real Windows
VM, not code reading: before/after SHA-256 hashes of the real 7 %APPDATA%\claude-conduit files,
the real nim-key.enc, and the real %LOCALAPPDATA%\Claude-3p all byte-identical (same
LastWriteTimeUtc too); pm2 daemon pid 8832 untouched throughout. npm test 252/252 (macOS); 15/15
native win32 run of the affected test file. Squash-merged PR #14 -> dev @ 0b2c7ad.
<!-- SECTION:FINAL_SUMMARY:END -->
