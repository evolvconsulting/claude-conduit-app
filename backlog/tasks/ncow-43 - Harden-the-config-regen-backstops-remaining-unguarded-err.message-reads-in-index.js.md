---
id: NCOW-43
title: >-
  Harden the config-regen backstop's remaining unguarded err.message reads in
  index.js
status: Done
assignee: []
created_date: '2026-08-05 03:59'
updated_date: '2026-08-05 13:19'
labels: []
dependencies:
  - NCOW-42
ordinal: 56000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wave-4's integration review of NCOW-42 (auto-update chain hardening) found a previously-unsurveyed sibling site in a DIFFERENT chain: src/main/index.js's config-regen backstop. Line ~97 reads `.catch((err) => console.warn('[config-regen] stale-config regeneration failed unexpectedly:', err.message));` -- the identical shape, identical rationale ('this should never fire'), and identical failure mode as the auto-update startup backstop NCOW-42 just fixed at a different line in the same file. A second, milder instance sits at line ~94: `result.error?.message` -- optional chaining guards nullish but not a throwing getter or Proxy get-trap, exactly the class safeReadProperty() (src/engine/configGen.js) was introduced to close (NCOW-37).

Reachability: engine-context.js already wraps the underlying configRegeneration call in its own .catch((err) => ({regenerated:false, reason:'error', error: err})), so index.js's own catch at ~97 can only fire if the .then() handler itself throws (e.g. destructuring/reading a property off a hostile Proxy result, or line 94's own optional-chained read itself throwing via a hostile getter) -- the same reachability argument NCOW-42 accepted for its own site. If it fires with a null/undefined/hostile value, it produces an unhandled rejection in the main process instead of the safe log line it's assumed to be.

Provenance: NOT a regression from NCOW-41 or NCOW-42. NCOW-37 explicitly scoped itself away from index.js; NCOW-42 scoped itself to the auto-update backstop only. This site belongs to the config-regen/NCOW-30/31 lineage, not the auto-update chain, and has never been surveyed by any task in the NCOW-36/37/40/42 error-guarding chain. Follow the same fix pattern already established there (safeReadProperty()/describeThrownValue() from src/engine/configGen.js) rather than inventing a new one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 src/main/index.js's config-regen backstop (~line 97) no longer interpolates err.message directly; it uses the existing safe-stringification helpers so it cannot itself throw regardless of what rejects into it
- [x] #2 src/main/index.js's line ~94 result.error?.message read is hardened through the same safe-stringification helpers so a throwing getter or hostile Proxy result cannot make the .then() handler itself throw
- [x] #3 A regression test demonstrates a hostile/malformed error surfacing from the config-regen path does not produce an unhandled rejection at this backstop, mirroring NCOW-42's own adversarial test rigor
- [x] #4 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read src/main/index.js (lines 84-97) and confirm the exact unguarded reads: result.error?.message
   in the .then() branch (~line 94) and bare err.message in the .catch() branch (~line 97).
2. Read src/engine/configGen.js's describeThrownValue()/safeReadProperty()/safeStringify() and
   confirm the sibling NCOW-42 fix at line 217 (describeThrownValue(err)).
3. Trace result.error's provenance to engine-context.js's .catch((err) => ({..., error: err})) --
   an arbitrary caught value, not a known-shaped returned failure object (unlike autoUpdate.js's
   result.error case, which uses safeReadProperty/safeStringify for a contractually-shaped
   object). Since it's the same "arbitrary thrown/caught value" case describeThrownValue() was
   built for, and matches NCOW-42's own precedent at the sibling site, use describeThrownValue()
   for both reads rather than inventing a different helper composition.
4. Replace both reads in src/main/index.js with describeThrownValue(result.error) and
   describeThrownValue(err), with a comment explaining the reasoning.
5. Read the existing NCOW-42 tests in test/main/index.test.js (source-text regex assertions
   against INDEX_SOURCE, plus an isolated hostile-value sweep against describeThrownValue()) and
   mirror that structure for the config-regen region, adding a hostile-Proxy case to the
   adversarial-value sweep.
6. Add two behavioral-reproduction tests using new Function(...) to execute the actual extracted
   configRegeneration.then().catch() source statement (technique already established in
   test/engine/configGen.test.js's runGeneratedLauncher()), confirming no unhandledRejection
   fires for a hostile Proxy result.error and a null rejection.
7. Run full npm test; prove non-vacuity via git stash (reverting only index.js, keeping new
   tests) and confirming failures including a genuinely reproduced unhandledRejection.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
IMPLEMENTED (worker report). Baseline before fix: npm test 388/388 passing. After fix: npm
test 394/394 passing (6 new tests). Non-vacuity: with only src/main/index.js reverted (new
tests kept), node --test test/main/index.test.js -> 4 pass / 5 fail, including an ACTUAL
unhandledRejection (TypeError: Cannot read properties of null (reading 'message')) surfacing
from the behavioral .catch()-branch test -- exactly the failure mode AC#3 exists to prevent.
Restoring the fix brought all 9 (and the full 394) back to passing.

Files touched: src/main/index.js, test/main/index.test.js only -- confirmed via git diff
dev...HEAD --stat, no touches to src/main/ipc.js or src/engine/uninstall.js, keeping this
conflict-free with NCOW-45's parallel work in a different worktree.

Judgment call: chose describeThrownValue() over safeStringify(safeReadProperty(...)) for the
.then() branch's result.error read. Picked based on provenance -- result.error here is an
arbitrary caught value from a generic .catch(), not a contractually-shaped returned failure
object like autoUpdate.js's result.error (which uses safeReadProperty/safeStringify because
updateCheck.js guarantees a {code, message} shape). This also keeps both branches symmetric
and matches the sibling NCOW-42 fix exactly. No changes needed to configGen.js -- its existing
exports were sufficient, confirming the task description's own claim.

Branch fix/NCOW-43-config-regen-backstop-hardening pushed to origin. Two commits: fix(main)
hardening the two reads; test(main) adding the regression coverage.

REVIEW (opus, independent): verdict APPROVE. All 4 ACs independently confirmed:
- AC#1/#2: traced describeThrownValue() line by line (safeReadProperty wraps every property
  read in try/catch, safeStringify() is total, an outer try/catch backstops all of it) and
  independently ran a 21-case adversarial sweep (null, undefined, Object.create(null), throwing
  message getter, throwing-everything Proxy, Proxy with throwing ownKeys/has/
  getOwnPropertyDescriptor, Symbol .message, throwing toString/valueOf/Symbol.toPrimitive,
  unstringifiable constructor.name, revoked Proxy, etc.) -- zero throws, always returns a
  string. Also executed the real extracted statement against 7 hostile result.error shapes for
  AC#2 specifically -- all logged safely; the Proxy and throwing-getter cases both escaped the
  .then() handler on unpatched dev.
- AC#3: reviewer's OWN reproduction (not the worker's claim) -- replaced index.js with dev's
  version, kept the new tests: 4 pass / 5 fail, with the exact same unhandledRejection
  ("Cannot read properties of null (reading 'message')") independently reproduced. A separate
  standalone harness against the unpatched block produced 4 genuine unhandled rejections across
  4 hostile shapes; the patched block produced 0 across 14 scenarios. Restored the worktree and
  verified byte-identical to the worker's committed state.
- AC#4: reviewer's own npm test run: 394/394 passing.

Scope confirmed: exactly 2 files (index.js, index.test.js), zero overlap with NCOW-45's
footprint (ipc.js/uninstall.js/mutex.js all absent from this diff).

Non-blocking findings (none require a branch change): (1) a sibling unhardened read
(result?.reason at index.js:112) remains, but is unreachable in practice (result always comes
from a controlled object literal, never an arbitrary value) and is already absorbed by the
chained .catch() even in the adversarial case reviewer tested -- confirmed no unhandled
rejection results either way; (2) one existing test's discriminating assertion is actually its
branch-attribution check, not its unhandled===null check -- still a correct signal, just a
minor characterization note; (3) the source-text extraction regex is format-sensitive but fails
loudly with a clear message rather than silently skipping; (4) a 20-line comment for a 2-line
change is verbose but every factual claim in it was independently verified accurate; (5)
incidental diagnostic improvement noted (hostile shapes now log a real description instead of
the literal string "undefined"). No injected-instruction pattern encountered on this worktree
(slot 1).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Hardened src/main/index.js's config-regen backstop: result.error?.message (~line 94) and bare err.message (~line 97) both now route through describeThrownValue() (src/engine/configGen.js), the same helper NCOW-42 used at the sibling auto-update backstop. Verified by independent opus review: all 4 ACs confirmed via a 21-case adversarial sweep of describeThrownValue() (null, undefined, throwing getters, hostile Proxies, unstringifiable constructors, etc. -- zero throws) plus the reviewer's own reproduction of the exact unhandledRejection the fix prevents (reverting only index.js reproduces TypeError: Cannot read properties of null (reading 'message')). npm test 388 -> 394 passing, then 400 after NCOW-45's sibling merge, then 400 unchanged after the wave-6 doc cleanup pass. Merged as PR #39 (5287a3a). Zero overlap with NCOW-45's parallel work confirmed by both reviews and the wave-6 integration review.
<!-- SECTION:FINAL_SUMMARY:END -->
