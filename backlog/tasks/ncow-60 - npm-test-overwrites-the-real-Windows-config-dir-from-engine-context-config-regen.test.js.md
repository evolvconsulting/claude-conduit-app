---
id: NCOW-60
title: >-
  npm test overwrites the real Windows config dir from
  engine-context-config-regen.test.js
status: To Do
assignee: []
created_date: '2026-08-07 11:49'
updated_date: '2026-08-07 13:25'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 73000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`test/main/engine-context-config-regen.test.js` writes into the user's REAL `%APPDATA%\claude-conduit` when `npm test` is run on a real Windows host. This is the NCOW-23 failure class — fixed in production code by that task, but never fixed in this test file.

**Mechanism** (confirmed statically by the wave-16 review pass 2, and observed live on winvm). `src/engine/paths.js`'s win32 branch resolves as `opts.appData ?? process.env.APPDATA ?? path.join(homedir, ...)` (paths.js:59-62). That ordering is correct for a real Windows run — `APPDATA` can legitimately differ from `homedir/AppData/...` under folder redirection or a roaming profile — but it means a caller that overrides ONLY `homedir` is silently ignored on win32, because `APPDATA` is always set on a real Windows machine.

`test/main/engine-context-config-regen.test.js:90` calls `paths.resolveConfigDir({ homedir: homeDir })` with no `appData`, then `generateAll()` writes `config.yaml`, `litellm.env`, `run.js` and `manifest.json` into the real config dir instead of the test's own tmp dir. Line 256 does the same and overwrites the real `manifest.json`.

**Observed live, twice.** A wave-16 worker ran `npm test` on winvm as a sanity check and found it had overwritten the pre-existing real `%APPDATA%\claude-conduit` files. Those files were dated 2026-08-02, i.e. an EARLIER campaign wave had already triggered the same bug without anyone noticing.

**Not a secret exposure.** The `litellm.env` it clobbers gets `NVIDIA_NIM_API_KEY=nvapi-old-install`, a hardcoded fixture from that same test file (line 100; also `test/engine/configGen.test.js:534`). No live key was ever written. The concern is that `npm test` silently destroys a real user's proxy configuration on Windows, not that it leaks anything.

**Correction to the first report of this bug, for the record:** `createEngineContext()` itself DOES thread the overrides correctly, via `src/main/engine-context.js`'s `resolveWindowsTestOverrides()`. The bug is solely the test file's own two direct `paths.resolveConfigDir` calls.

**Scope is narrow.** The wave-16 reviewer swept the whole suite and found NO other offenders. CLAUDE.md's NCOW-23 note already warns that "any *new* path resolver added to `paths.js` with a win32 branch needs the same override wired through its call site, or it will silently repeat this bug" — which is why a cheap suite-wide guard is worth more here than the two-line fix alone.

This is agent-resolvable without a Windows host: the fix and its guard are both verifiable on any platform, since the defect is a missing argument, not platform-specific behavior.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 test/main/engine-context-config-regen.test.js threads paths.resolveWindowsAppDataOverrides(homeDir) into BOTH direct paths.resolveConfigDir call sites (currently lines 90 and 256), so the test resolves to its own tmp dir on win32
- [ ] #2 A guard exists that fails if any test calls paths.resolveConfigDir (or another paths.js win32-branching resolver) with a homedir override but no matching appData/localAppData override — cheap and suite-wide, so this recurring class is caught automatically rather than by inspection
- [ ] #3 The guard is proven non-vacuous: reverting the line-90 and line-256 fix makes it fail, and it is demonstrated NOT to be a verbatim copy of an existing test that already passed
- [ ] #4 npm test passes on macOS, and the win32 resolution path is proven correct by a test that simulates a win32 environment (a real Windows host is not required)
- [ ] #5 All pre-existing tests continue to pass unmodified
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Note from the wave-16 cleanup review (2026-08-07) — relevant to this task's scope

`README.md:331` reads `npm test              # 485 tests, no network or real config touched`. The
wave-16 cleanup branch edited that exact line (to bump the count) and left the second half standing.
**That second half is false on Windows, and this task is why** — the review recommends this task's
fix restore the claim's truth rather than leave a doc line asserting a protection that does not hold.
Consider whether that belongs in this task's acceptance criteria; it is recorded here rather than
added to them unilaterally.

Also confirmed at wave-16 settlement, independently of the original report: the wave-16 integration
review swept the whole suite and found NO other offenders — only three test files reference
`src/engine/paths` at all (`test/main/engine-context-config-regen.test.js`, `test/engine/paths.test.js`,
`test/engine/configGen.test.js`), and the latter two are safe (`paths.test.js` passes an explicit
`platform:` on every win32 case and performs no filesystem writes; `configGen.test.js` uses
`fs.mkdtempSync` roots with no platform branch). The other three `createEngineContext` consumers are
safe because `engine-context.js`'s own `resolveWindowsTestOverrides()` applies the override
internally. **This task's scope as filed is correct.**
<!-- SECTION:NOTES:END -->
