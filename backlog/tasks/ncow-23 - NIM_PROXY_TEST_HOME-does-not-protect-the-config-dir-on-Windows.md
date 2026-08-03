---
id: NCOW-23
title: NIM_PROXY_TEST_HOME does not protect the config dir on Windows
status: In Progress
assignee: []
created_date: '2026-08-02 21:06'
updated_date: '2026-08-03 02:11'
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
Found during NCOW-22's wave-6 review (2026-08-02) and independently confirmed live on the real Windows VM by an opus reviewer, not inferred from code.

CLAUDE.md's "Safe manual testing (load-bearing)" section states that NIM_PROXY_TEST_HOME combined with --dev redirects every path the app touches, and calls it 'the only way to click destructive buttons without hitting this machine's real Claude Desktop/Code config'. On Windows that guarantee does not hold for the config dir.

Mechanism: src/main/engine-context.js:53 calls paths.resolveConfigDir({ homedir }), passing ONLY homedir. src/engine/paths.js:41 then resolves opts.appData ?? process.env.APPDATA ?? path.join(homedir, ...). APPDATA is always set on Windows, so the injected homedir is never reached and the app resolves to the real %APPDATA%\\claude-conduit regardless of NIM_PROXY_TEST_HOME.

Confirmed live: a --dev + NIM_PROXY_TEST_HOME run on winvm read the real %APPDATA%\\claude-conduit. The wave-6 worker and reviewer both worked around this by never calling config.generate on Windows, and the reviewer re-hashed all five real config files before and after its run (all SHA-256s byte-identical, only logs/ grew) — so no damage was done, but only because both agents were explicitly warned.

Why this matters beyond tidiness: this is the mechanism that is supposed to make destructive manual testing safe. Any agent or human following CLAUDE.md's documented procedure on Windows is silently operating against the real config dir, including the real Claude Desktop entry and the app's own persisted state. Every future Windows verification task in this project inherits the hazard.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 resolveConfigDir honors an injected homedir/appData override on win32 so that NIM_PROXY_TEST_HOME redirects the config dir on Windows exactly as it does on macOS/Linux
- [ ] #2 Verified live on the real Windows VM: a --dev run with NIM_PROXY_TEST_HOME set reads and writes ONLY under the fake home, confirmed by observing the fake path in use and the real %APPDATA%\claude-conduit being untouched (hash or timestamp comparison before/after)
- [ ] #3 An audit of the other path resolvers in src/engine/paths.js confirms no sibling function has the same env-var-beats-injected-override bug (or any that do are fixed too)
- [ ] #4 A regression test covers the win32 override path using the existing process.platform-injection pattern in test/engine/
- [ ] #5 CLAUDE.md's Safe manual testing section is updated if any platform caveat remains after the fix
- [ ] #6 npm test passes
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
Wave 9 implementation complete, pushed to fix/NCOW-23-win32-test-home-config-dir (commits 5fdf28d,
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
<!-- SECTION:NOTES:END -->
