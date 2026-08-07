---
id: NCOW-60
title: >-
  npm test overwrites the real Windows config dir from
  engine-context-config-regen.test.js
status: In Progress
assignee: []
created_date: '2026-08-07 11:49'
updated_date: '2026-08-07 14:00'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read the task spec, CLAUDE.md's NCOW-23 note, src/engine/paths.js, src/main/engine-context.js, and test/main/engine-context-config-regen.test.js to confirm the exact mechanism and current line numbers.
2. Grep every call site of the four win32-branching resolvers (resolveConfigDir, resolveLegacyConfigDir, resolveClaudeDesktopConfigLibraryDir, resolveElectronAppDataDir) across src/ and test/ to INDEPENDENTLY confirm the task notes' claim that only engine-context-config-regen.test.js is unsafe.
3. Run baseline npm test: 485/485.
4. Write a new suite-wide guard, test/engine/paths-win32-override-guard.test.js, that recursively scans test/**/*.test.js, strips comments/strings, finds calls to the four resolvers, and flags any call with a homedir override but no explicit platform and no appData/localAppData/spread escape.
5. Verify the guard FAILS against the unfixed file BEFORE touching it.
6. Apply the actual fix: thread paths.resolveWindowsAppDataOverrides(homeDir) into both paths.resolveConfigDir call sites.
7. Verify the guard PASSES post-fix; run the file's own suite and the full suite.
8. Add a dedicated AC#4 test simulating a win32 host (forced platform + realistic APPDATA/LOCALAPPDATA), mirroring paths.test.js's withRealWindowsEnvVars technique.
9. Fix a real bug discovered in the guard itself (see notes) by stripping comments/strings before detection.
10. Re-run the full AC#3 experiment against the FINAL guard: scratchpad backup, revert both call sites, observe FAIL, restore via cp, diff byte-for-byte, observe PASS.
11. Run an adversarial probe: one scratch file with distinct mutation shapes, record per-mutation results, delete the probe, confirm git status clean.
12. Run the full suite once more post-commit, commit in two logical commits, push.
<!-- SECTION:PLAN:END -->

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

## Wave-17 implementation evidence (worker, branch `fix/NCOW-60-test-real-windows-config`, commits `598e60e48101fe63f85d613c49a77d5c1dfb37e6` and `9b9c829639021dca68755f4c247c83cfd6ddf81e`, branched from `20ffa60add5d7e281a2f39610adcec1ee987b489`)

Recorded by the orchestrator from the worker's structured return. NOT yet independently reviewed at the
time of writing.

**AC#1** — both direct call sites now read
`paths.resolveConfigDir({ homedir: homeDir, ...paths.resolveWindowsAppDataOverrides(homeDir) })`
(in `seedStaleInstall()`, originally line 90; and in the corrupt-manifest test, originally line 256).

**AC#2** — new file `test/engine/paths-win32-override-guard.test.js`. Recursively walks `test/` for
`*.test.js` (excluding itself), blanks comments/strings, and flags any call to `resolveConfigDir`,
`resolveLegacyConfigDir`, `resolveClaudeDesktopConfigLibraryDir` or `resolveElectronAppDataDir` whose
options carry `homedir` but no explicit `platform` and no `appData`/`localAppData`/spread escape. One
`test()`, ~10-20ms, no per-file registration, so a new offending file is caught automatically. The
worker deliberately covered ALL FOUR resolvers rather than only `resolveConfigDir`, matching CLAUDE.md's
framing of this as a recurring class rather than a single-function defect.

**AC#3 — NON-VACUITY PROVEN BY EXPERIMENT against the FINAL guard.** Backed the fixed file up to a
scratchpad, reverted both call sites in place, ran the guard:
```
not ok 1 - test suite: no test overrides only `homedir` (with no explicit `platform` and no appData/localAppData escape)
error: Offenders:
  main/engine-context-config-regen.test.js:90: resolveConfigDir({ homedir: homeDir })
  main/engine-context-config-regen.test.js:301: resolveConfigDir({ homedir: homeDir })
# pass 0 / # fail 1
```
(the second offender reports at :301 rather than the task's :256 because the file grew during the fix).
Restore verified EXACT: `diff <backup> <restored>` produced no output. Guard then passed `# pass 1 / # fail 0`.
NOVELTY: not a copy of anything. `test/engine/paths.test.js` tests the resolvers' own return values with
explicit inputs and never reads other files from disk or scans source. `test/engine/configGen.test.js`
never calls any of the four resolvers at all — confirmed by the worker's own grep rather than taken from
the task notes on trust. The guard's mechanism (recursive walk + comment/string-stripped scan +
balanced-paren argument extraction) exists nowhere else in the repo.

**A REAL BUG THE WORKER FOUND IN ITS OWN GUARD, worth preserving as a lesson.** Its first draft's
explanatory comment in `seedStaleInstall` quoted the OLD buggy call shape verbatim for documentation —
and that comment text was itself a textual match for the guard's own call-detection regex, producing a
FALSE POSITIVE that appeared ONLY under the full `npm test` run and not when the guard file ran alone
(order-dependent). Fixed by adding `stripCommentsAndStrings()` and running detection against the
stripped copy while still reporting the original text in the failure message. This is precisely the
class of self-inflicted guard defect this campaign keeps hitting, caught here by the worker itself
because it ran the experiment instead of reading the guard.

**AC#4** — a dedicated test forces `platform: 'win32'` and sets realistic `process.env.APPDATA`/
`LOCALAPPDATA` (mirroring `paths.test.js`'s established `withRealWindowsEnvVars` technique), then
asserts the fixed call resolves to `path.join(homeDir, 'AppData', 'Roaming', 'claude-conduit')` and NOT
to the simulated real `%APPDATA%\claude-conduit`. No Windows host used or required.

**AC#5** — `# tests 487 / # pass 487 / # fail 0`. 487 = 485 baseline + 2 new tests. No existing test
modified other than the two `resolveConfigDir` call sites, which are the in-scope fix itself.

## Adversarial probe — 8 mutations, 5 CAUGHT, 3 SURVIVED (worker's own honest report)

CAUGHT: a different call shape with no `paths.` prefix; a differently-named override variable; the same
omission in a NEW file (the scratch probe file itself, picked up automatically by the recursive walk); a
call spread across multiple lines; a different win32-branching resolver with the same omission.

SURVIVED, all three documented rather than hidden:
1. **Aliased destructured import** (`const { resolveConfigDir: rcd } = require(...); rcd({ homedir })`) —
   the regex matches the literal function name, so an alias evades it.
2. **Explicit `platform: 'win32'` with homedir-only and no appData** — exempted BY DESIGN, on the
   reasoning that forcing `platform` is a deliberate controlled simulation (which is what every
   legitimate case in `paths.test.js` does). The guard cannot distinguish that from a hypothetical
   future call that forces `platform: 'win32'` AND performs a real filesystem write with no appData —
   a real residual risk if this suite were ever run on an actual Windows CI host.
3. **Spread of a variable that does not itself carry appData/localAppData**
   (`{ homedir, ...emptyOverrides }` where `emptyOverrides = {}`) — a text scan cannot see what a spread
   identifier evaluates to at runtime.

The worker's stated rationale for the exemption line ("explicit `platform` key present") is that it
classifies every real call site in the repo today with zero false positives or negatives, mirrors the
actual mechanism of the bug (reliance on real `process.platform`), and matches this repo's existing
precedent of pragmatic regex-only static checks with documented limits (this repo has no parser
dependency). Recorded so review can accept or challenge the line rather than rediscover it.
<!-- SECTION:NOTES:END -->
