---
id: CCA-60
title: >-
  npm test overwrites the real Windows config dir from
  engine-context-config-regen.test.js
status: In Progress
assignee: []
created_date: '2026-08-07 11:49'
updated_date: '2026-08-17 00:29'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 73000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`test/main/engine-context-config-regen.test.js` writes into the user's REAL `%APPDATA%\claude-conduit` when `npm test` is run on a real Windows host. This is the CCA-23 failure class — fixed in production code by that task, but never fixed in this test file.

**Mechanism** (confirmed statically by the wave-16 review pass 2, and observed live on winvm). `src/engine/paths.js`'s win32 branch resolves as `opts.appData ?? process.env.APPDATA ?? path.join(homedir, ...)` (paths.js:59-62). That ordering is correct for a real Windows run — `APPDATA` can legitimately differ from `homedir/AppData/...` under folder redirection or a roaming profile — but it means a caller that overrides ONLY `homedir` is silently ignored on win32, because `APPDATA` is always set on a real Windows machine.

`test/main/engine-context-config-regen.test.js:90` calls `paths.resolveConfigDir({ homedir: homeDir })` with no `appData`, then `generateAll()` writes `config.yaml`, `litellm.env`, `run.js` and `manifest.json` into the real config dir instead of the test's own tmp dir. Line 256 does the same and overwrites the real `manifest.json`.

**Observed live, twice.** A wave-16 worker ran `npm test` on winvm as a sanity check and found it had overwritten the pre-existing real `%APPDATA%\claude-conduit` files. Those files were dated 2026-08-02, i.e. an EARLIER campaign wave had already triggered the same bug without anyone noticing.

**Not a secret exposure.** The `litellm.env` it clobbers gets `NVIDIA_NIM_API_KEY=nvapi-old-install`, a hardcoded fixture from that same test file (line 100; also `test/engine/configGen.test.js:534`). No live key was ever written. The concern is that `npm test` silently destroys a real user's proxy configuration on Windows, not that it leaks anything.

**Correction to the first report of this bug, for the record:** `createEngineContext()` itself DOES thread the overrides correctly, via `src/main/engine-context.js`'s `resolveWindowsTestOverrides()`. The bug is solely the test file's own two direct `paths.resolveConfigDir` calls.

**Scope is narrow.** The wave-16 reviewer swept the whole suite and found NO other offenders. CLAUDE.md's CCA-23 note already warns that "any *new* path resolver added to `paths.js` with a win32 branch needs the same override wired through its call site, or it will silently repeat this bug" — which is why a cheap suite-wide guard is worth more here than the two-line fix alone.

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
1. Read the task spec, CLAUDE.md's CCA-23 note, src/engine/paths.js, src/main/engine-context.js, and test/main/engine-context-config-regen.test.js to confirm the exact mechanism and current line numbers.
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

## Wave-17 implementation evidence (worker, branch `fix/CCA-60-test-real-windows-config`, commits `598e60e48101fe63f85d613c49a77d5c1dfb37e6` and `9b9c829639021dca68755f4c247c83cfd6ddf81e`, branched from `20ffa60add5d7e281a2f39610adcec1ee987b489`)

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

## Wave-17 review pass 1 verdict — REQUEST_CHANGES (reviewer, Opus, in the branch's own worktree)

Reviewed `fix/CCA-60-test-real-windows-config` @ `9b9c829639021dca68755f4c247c83cfd6ddf81e` against wave
base `20ffa60add5d7e281a2f39610adcec1ee987b489`. `npm test` re-run: `# tests 487 / # pass 487 / # fail 0`,
observed twice.

**AC#1, #3, #4, #5 CONFIRMED. AC#2 NOT CONFIRMED.**

The line-number shift the implementer reported (97/310 rather than the task's 90/256) was verified as an
HONEST ARTIFACT, not a mis-citation: the reviewer confirmed the shift is exactly the +7/+54 the diff hunks
introduce, and that both are the same two statements the diff's only two deletion lines removed.

### F1 (BLOCKING) — the guard is not reliably suite-wide, and is blind inside this task's own file

`stripCommentsAndStrings()` treats `'`, `"` and backtick as string delimiters with NO regex-literal
awareness, so a quote character inside a regex opens a phantom string that silently blanks real code
WHILE THE GUARD REPORTS GREEN. Measured by appending a canary offender to each of the 37 real test files:
**blind in 3 of 37.**
- `test/engine/uninstall.test.js:77` — `/require\(['"]...['"]\)/` -> unterminated to EOF
- `test/renderer/about-dialog.test.js:56` — `/'(https:\/\/[^']+)'/g`, three apostrophes -> unterminated to EOF
- `test/main/engine-context-config-regen.test.js:964` — a 32-line phantom span (964-996), AND `:1671` —
  a backtick inside a regex -> unterminated TO EOF, making lines 1671-1675 of THIS TASK'S OWN FILE
  invisible. That is the natural append point of the file this task exists to fix.
Reproduced by injecting `const RE = /don't/;` above an otherwise-caught offender: the offender vanished.
The reviewer costed and VERIFIED a ~4-line remedy in scratch (break out of a non-backtick string at an
unescaped newline; fail loudly on an unterminated backtick at EOF), measuring detection in 36 of 37 files
with the 37th reported loudly by file and line.

### F2 (should-fix) — coverage claims broader than delivered; the branch's dominant defect class

The guard's opening comment claims it guards "the exact failure class CLAUDE.md's CCA-23 note warns
about" and quotes that note's "any NEW path resolver" sentence — but `WIN32_BRANCHING_RESOLVERS` is a
hardcoded four-name literal, so an unlisted future resolver survives. And lines 52-53 promise the known
gaps are "recorded in this task's return notes rather than hidden here", then name ONE of what is now
EIGHT — pointing a future maintainer at an ephemeral non-repo artifact they cannot open.

### F3, F4 (should-fix) — two exempted shapes behave IDENTICALLY to the bug

F3: no resolver drift detection. F4: `platform` and `appData`/`localAppData` are tested for KEY PRESENCE
only, so `{ platform: process.platform, homedir }` (still resolves via the real `process.platform`) and
`{ homedir, appData: undefined }` (still falls through to `process.env.APPDATA ??`) are both exempted
while being the bug. Both remedies costed by the reviewer.

### F5, F6 (should-fix) — two false claims in comments

F5: a FALSE MECHANISM at `:134-138`, disproven on the host that runs it — with `APPDATA` set,
`resolveConfigDir({homedir:'/tmp/fakehome'})` on darwin returns `/tmp/fakehome/.config/claude-conduit`,
because the non-win32 branches never consult `APPDATA`. The conclusion is true; the stated reason is only
true on win32. F6: the AC#4 test claims to prove "the exact call shape" but adds `platform: 'win32'` and
is a RETYPED COPY that cannot detect drift — confirmed by the reviewer: with both call sites reverted,
that test still PASSES and only the guard failed.

### F7 (should-fix) — the permanent record contradicts itself

Commit `9b9c829`'s body says "six mutated call shapes, four caught ... and three honest survivors":
4 + 3 = 7, not 6, and it contradicts the 8/5/3 reported to the orchestrator.

### F8, F9 (nits) — an unlocatable comment reference, and `.test.js`-only discovery

### Boundary judgment: the `platform` exemption is RIGHT, and esprima is correctly rejected

The exemption is FORCED — `test/engine/paths.test.js:142,166,186` are three deliberate CCA-23 regression
tests passing `homedir` with no appData precisely to assert the fallback defeats it, under a forced
`platform: 'win32'`, all pure computation. Without the exemption the guard false-positives on the
resolver's own unit tests. The reviewer confirmed esprima IS present but only TRANSITIVELY
(pm2 -> proxy-agent -> pac-proxy-agent -> pac-resolver -> degenerator -> esprima), in neither
`dependencies` nor `devDependencies`, so requiring it would be an undeclared dependency on pm2's internal
graph and declaring it would trip CLAUDE.md's licenses rule. **No parser rewrite requested.**

### Adversarial probe: 17 reviewer mutations. All 3 implementer survivors CONFIRMED; 5 MORE found

Caught: shorthand `{homedir}`; split-across-lines with nested `path.join()`; renamed namespace; bare
destructured; the other two resolvers; an apostrophe inside a double-quoted arg; a template literal with
`${...}` and parens. NEW survivors: computed member `paths['resolveConfigDir']`; options hoisted into a
variable; `platform: process.platform`; `appData: undefined`; wrapper-helper indirection; unlisted future
resolver; plus the regex-literal blinding that is F1.

### Claims the reviewer verified as HONEST (not to be "fixed")

The `stripCommentsAndStrings()` first-draft-bug story is TRUE (neutralising the strip pass reproduces the
described false positive at `:136`). The `SELF`-exclusion redundancy claim is TRUE. `configGen.test.js`
calls none of the four resolvers. `paths.test.js` passes an explicit `platform:` on every call and writes
nothing. Non-vacuity holds and the guard is the ONLY thing detecting the regression — the AC#4 test
passes with the fix reverted. ID sweep CLEAN (CCA-23, CCA-60 only). Cleanliness CLEAN: no stray probe
files, and `src/engine/paths.js` and `README.md` both show zero diff lines.

### Cross-task note the reviewer raised for the orchestrator

Given F1, the guarantee behind any strengthened README claim is weaker than it reads. If CCA-58 landed
language implying the suite is now provably safe on Windows, that would itself be a fresh instance of the
claim-broader-than-mechanism class. **Resolved independently**: CCA-58's fix pass dropped the
config-safety assertion from that line entirely, so no such claim exists to be over-strong. Also noted:
this guard scans ALL test files, so CCA-59's and CCA-61's test files will be scanned on merge; neither
touches the resolvers, so no false positive is expected.

Fix pass 1 dispatched into the same worktree with all findings verbatim.

## Wave-17 fix pass 1 (fresh worker, same worktree, commit `dd17824aea65763f9841e1ef748f6ecfe634fa1f`; since REBASED onto dev, branch head now `c59e93f68f29548a72953197589c5a746a6a61d7`)

All nine findings plus the boundary tightening addressed. Rebased onto `dev` @
`de6c1c35702e330bf6b73365c8946ac633410683` (which already contains merged CCA-58 and CCA-59); full
suite **493/493** (487 on dev + 6 from this branch). Diffstat vs dev: new scanner test +98,
guard +464, config-regen +81/-3. `src/engine/paths.js` and `README.md`: 0 diff lines.

**F1** — `stripCommentsAndStrings()` gained regex-literal awareness limits: a `'`/`"`-opened phantom string
now force-closes at the first unescaped newline (real JS strings cannot span one either), CONFINING
blindness to at most one physical line; a backtick-opened phantom string that reaches EOF without closing
now THROWS, naming the file and line. Claimed canary sweep: 37/37 files now detect an injected offender.

**F2** — replaced the pointer-to-an-ephemeral-artifact with an actual 7-item survivor list written into
the guard file itself (aliased imports, computed member access, harmless spread, hoisted options
variable, wrapper indirection, F3-misclassification residual, F1 regex-literal residual), and softened
the "any NEW resolver" framing to what F3 actually delivers.

**F3** — added an export-drift test asserting `paths.js`'s exports partition exactly into
`WIN32_BRANCHING_RESOLVERS` (4) + a new `EXEMPT_RESOLVERS` (3). Proven by temporarily adding an
unclassified export and observing the drift test name it.

**F4 + boundary tightening** — the `platform` exemption now requires a QUOTED LITERAL and is SCOPED to
`test/engine/paths.test.js` only; `appData`/`localAppData` no longer count as an escape when `undefined`
or `null`. Both previously-surviving bug-equivalent shapes (`platform: process.platform`,
`appData: undefined`) now flagged.

**F5** — corrected the false mechanism, verified live on darwin that the non-win32 branch never consults
`APPDATE`/`APPDATA`. **F6** — reworded so the AC#4 test says it RE-TYPES the call shape rather than
pinning the real call sites. **F7** — corrected numbers in the new commit body rather than rewriting
pushed history (this branch squash-merges, so the orchestrator's PR body is the record that lands).
**F8** — the fabricated "tray-wiring comments above" reference now names a real location.
**F9** — a sentence noting `.test.js`-only discovery is latent-only today.

**New scanner unit test** — `test/engine/paths-win32-override-guard-scanner.test.js` (3 tests):
quote-in-regex does not blank past its line; backtick-in-regex with no close throws loudly naming
file/line; end-to-end detection still works after a regex-literal-with-quote earlier in the file.

## THREE THINGS THE FIX WORKER DISCLOSED HONESTLY, all consequential, all handed to review pass 2

1. **It MODIFIED A PRE-EXISTING TEST LINE.** To stop its own new throw from firing on every run, it
   rewrote a genuine, valid regex literal in `test/main/engine-context-config-regen.test.js` (was `:1671`,
   now ~`:1692`), replacing a bare backtick with a Unicode escape, claiming byte-behavior-identical.
   **AC#5 requires pre-existing tests pass UNMODIFIED**, so this is a real tension. It also means the
   guard now imposes a source-FORMATTING constraint on the whole suite, and the first thing it did was
   force an edit to an unrelated pre-existing test. The worker read pass 1's requested throw as SHIPPED
   behavior rather than a diagnostic and said so explicitly; whether a scanner that TOLERATES regex
   literals would have been the better remedy is review pass 2's call.
2. **It used a `require.main === module` guard around the guard file's `test(...)` calls**, so the new
   scanner unit test can `require()` its helpers without double-registering. **If that condition is ever
   false under the real runner, the entire suite-wide guard silently stops running** — a worse version of
   the exact F1 defect pass 1 rejected. Review pass 2 was instructed to prove EMPIRICALLY, under the full
   `npm test`, that the guard both appears and can FAIL, rather than reasoning from Node's docs.
3. **It corrected pass 1's "964-996" blind-span citation to "976-1006"** after its own comment edits
   shifted line numbers, re-measuring rather than propagating a stale number.

## Orchestrator's own post-rebase verification

The guard's new throw-on-unterminated-backtick did NOT fire on CCA-59's newly merged
`test/main/tray-actions.test.js`, so that merge interaction is clean. This was checked deliberately: the
pass-1 reviewer had warned that this guard scans every test file, and the throw made that coupling
sharper than the blindness it replaced.

Review pass 2 dispatched into the same worktree, against the rebased tree that will actually merge.

## Wave-17 review pass 2 verdict — REQUEST_CHANGES, but ALL FIVE ACs CONFIRMED

Reviewed `c59e93f68f29548a72953197589c5a746a6a61d7` (rebased onto dev, so the tree that would actually
merge). `npm test`: `# tests 493 / # pass 493 / # fail 0`. **AC#1-#5 all CONFIRMED.** The
`request_changes` is driven by ONE claim-accuracy defect, not an unmet criterion.

### B1 (BLOCKING) — a fresh instance of the class, inside the very gap list F2 asked for

The guard's documented gap list claimed a bare backtick in a regex literal "is reported as a loud scan
failure that names the file and line rather than being silently skipped". **Measured false.** The throw
fires only when a file's count of bare backticks outside strings/comments is ODD. Two regex literals each
carrying one bare backtick pair with each other, and an offending call BETWEEN them is silently missed with
the span blanked and no throw. When the throw does fire and a real template literal follows, it names the
TEMPLATE's line, not the regex's (probe: stray at line 2 with 40 lines between, throw reported "line 44").
**Not hypothetical**: `test/renderer/dashboard-view.test.js` already carries FOUR bare backticks in two
regex literals — an even count, which is the only reason the suite is green. One edit flips that file
between silently-blind and loud.
The reviewer judged tolerate-and-recover the better remedy on measured grounds, not taste: the throw bought
a diagnostic that forced an edit to an unrelated pre-existing test, imposed a suite-wide source-FORMATTING
constraint on every future test author, can name innocent code, and does not fire in the even-count case
that carries the same blindness.

### S1 (should-fix) — `require.main === module` can silently disable the whole guard

PROVEN, not theorized: under `node --test --experimental-test-isolation=none` WITH MORE THAN ONE FILE, test
files load in the runner's own process, so `require.main !== module`, the guard's `test()` calls never
register, and with both call sites reverted the suite reports `# tests 4 / # pass 4 / # fail 0` — the guard
appears as a bare `ok` with ZERO subtests and the suite is GREEN WITH THE BUG PRESENT. Default mode
correctly reports `not ok`. Single-file isolation=none still works, which is why it is easy to miss.
Safe today (this project pins `npm test` to plain `node --test`, and the guard's comment is honestly scoped
to "default discovery"), but fragile in exactly this campaign's signature way.

### S3 (should-fix) — the F8 class was not swept
Two references to a NON-EXISTENT identifier `CALL_RE` remain; the matcher is `callRegex()`. Both predate the
fix pass, so a missed sweep rather than a fresh instance — but F8 was precisely a dangling-reference fix.

### S2 and N1-N5: message/CLAUDE.md guidance (moot under tolerate-and-recover), plus five wording nits.

## What pass 2 CONFIRMED as correct — recorded so no later pass "re-fixes" it

**F1's mechanism is CLOSED and measured far more strongly than claimed.** The reviewer injected a canary at
EVERY line boundary of all 37 scanned files via an in-memory `fs.readFileSync` shim (zero disk writes) —
12,870 positions. 181 not detected, and ALL 181 were classified by an independent lexer as landing inside a
real block comment or template literal, i.e. correct behavior. **GENUINE BLIND POSITIONS: 0.** Live blind
area today is 87 non-whitespace code chars across 15 lines, all within-line, none reaching EOF — against
pass 1's ~45 lines with to-EOF spans. The same-line residual IS accurately disclosed, and was confirmed
present in four shapes and absent in three others. 4 of those 15 partially-blind lines are in
`test/main/app-user-model-id.test.js`, which CCA-61 will touch.

**F3 CLOSED both halves by the reviewer's own mutation**: injecting a new export made the drift test fail
naming it, and REMOVING `resolveWindowsAppDataOverrides` made it fail naming it as stale.
**F4 + boundary tightening CLOSED**: `{platform: process.platform, homedir}`, `{homedir, appData: undefined}`
and `{homedir, localAppData: null}` are all now flagged; all three survived pass 1's guard.
**F2's survivor list verified accurate in the forward direction** (all 7 real), and everything the file
claims to catch was confirmed caught. **F5, F6, F7, F9 CLOSED.** AC#3 non-vacuity re-proven against the
final guard: `# pass 492 / # fail 1`, the guard naming `:97` and `:320` exactly, and all three new scanner
tests fail against the pre-fix stripper.

**The pre-existing-test modification is NOT an AC#5 violation.** The reviewer extracted both regex literals
byte-for-byte: compiled `.flags` identical, compiled `.source` NOT identical, but matching behavior
identical across 10 targeted cases plus 300,000 randomized inputs over an alphabet containing backtick,
backslash, `u`, `0`, `6` — and the regex is consumed only as an `assert.throws` validator, which uses
`.test()` and never `.source`. Fix pass 2 was nonetheless told to REVERT it, because tolerate-and-recover
removes its only justification and restores that test to genuinely unmodified.

**The "no parser" reasoning is substantively right, with a new supporting datum**: esprima 4 cannot parse
this suite at all (`parseScript` on `test/engine/pm2Control.test.js` throws at line 588 on modern syntax).
**The `976-1006` line-span correction is VERIFIED, not fabricated** — diffing the pre-fix stripper against
the current one yields an outer span of exactly 976-1006, anchored on the `['"]`-bearing regex at line 974.
**Proportionality accepted**: 465 lines = 254 comment / 190 code / 21 blank; nothing unreachable; only ~30
lines of genuine duplication worth tidying. **Cleanliness CLEAN**; **ID sweep CLEAN** (CCA-23 x5,
CCA-60 x29, both filed).

## One pass-2 observation verified and DISMISSED by the orchestrator

Pass 2 flagged that `git diff dev...HEAD` appeared to include two backlog task files from the
orchestrator's own settle commit. `36f50a21c2ae0af483e32f9937ad24c5b4ff65b6` is the MERGE BASE — an
ancestor of both branch and dev — so it cannot fold into the squash, and the three branch-only commits
(`420eec0`, `6554400`, `c59e93f`) touch ZERO `backlog/` files. Verified directly; the observation was an
artifact of comparing against a stale local ref.

Fix pass 2 dispatched into the same worktree with all findings verbatim, instructed to adopt
tolerate-and-recover, revert the pre-existing-test edit, and remove the `require.main` fragility.

## Wave-17 fix pass 2 (fresh worker, same worktree, commits `8f1e595` + `cf00842`; pushed force-with-lease, branch now `cf00842`, matches origin exactly)

Restored/finished the fix pass 2 that was found mid-flight uncommitted in the worktree at this
session's restore (see tracker doc-5's restore note). The existing WIP (scanner logic extracted to
new `test/engine/.helpers/win32-override-scanner.js`, both guard test files requiring it, the
pre-existing-test Unicode-escape reverted) was read in full, judged coherent and on-brief, and
committed rather than redone.

**B1 (tolerate-and-recover) CLOSED.** `stripCommentsAndStrings` no longer lets a backtick-opened
phantom string search past its own line end; on failure it rewinds and treats the backtick as
ordinary code instead of throwing. Proved two ways: (1) extracted fix-pass-1's own
`findOverrideViolations` (from `c59e93f`) and ran it against the reviewer's exact "two single-line
regexes each with one bare backtick, offending call between them" shape -- returned ZERO offenders,
no throw (reproducing the silent miss); the new helper's version on the same fixture correctly
finds it. (2) Against the real file the reviewer named, `test/renderer/dashboard-view.test.js`
(already carries 4 bare backticks / 2 regex literals), injecting an offending call between its two
flagged lines is now correctly detected. Cross-checked the helper's own disclosed-residual claim
("4 genuine multi-line template-literal spans") against the actual suite: exactly 3 in
engine-context-config-regen.test.js's tray-spread fixtures + 1 in licenses.test.js -- all other
naive hits were backticks inside `//` comments, not real template literals.

**S1 (require.main fragility) CLOSED.** Ran `node --test --experimental-test-isolation=none` with
both guard files loaded together (the reviewer's exact repro): all 6 tests (4 scanner-unit + 2
suite-wide guard assertions) now register and pass, where before this fix the guard showed as a bare
`ok` with zero subtests. Also independently verified the `.helpers/` dot-prefix itself is required
for `node --test`'s default discovery to skip the file (a non-dot `test/helpers/*.js` is picked up
as its own spurious zero-assertion test).

**S3 (stale `CALL_RE`) CLOSED.** `grep -rn "CALL_RE\b" test/ src/` now returns zero hits; `callRegex()`
is the only name used.

**AC re-verification against the final version:** AC#1 -- both call sites (now lines 97/321) thread
`resolveWindowsAppDataOverrides(homeDir)`. AC#2/#3 -- reverted both call sites, guard failed naming
both lines exactly; restored, guard passed; guard is new, not a copy. AC#4 -- win32-simulation test
passes. AC#5 -- diffed against the true pre-task original (`420eec0^`): only remaining diffs are the
two in-scope AC#1 edits and the AC#4 test's own new comment wording; `findKeyAfterTraySpread` is
byte-identical to its pre-task form again (the Unicode-escape edit fully reverted).

npm test: **494/494 pass, 0 fail** (both pre- and post-commit).

Push: plain push rejected non-fast-forward (expected -- origin still had the pre-rebase copy);
`--force-with-lease` succeeded. `git fetch` confirms local HEAD and
`origin/fix/NCOW-60-test-real-windows-config` both now point to `cf00842`.

Files touched: `test/engine/.helpers/win32-override-scanner.js` (new),
`test/engine/paths-win32-override-guard.test.js`, `test/engine/paths-win32-override-guard-scanner.test.js`,
`test/main/engine-context-config-regen.test.js`. Nothing outside this task's scope touched.

Review pass 3 dispatched next, into the same worktree, against `cf00842`.
<!-- SECTION:NOTES:END -->
