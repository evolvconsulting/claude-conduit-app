---
id: NCOW-36
title: Harden configGen's thrown-value logging guard against unstringifiable throws
status: Done
assignee: []
created_date: '2026-08-04 19:30'
updated_date: '2026-08-04 21:47'
labels: []
dependencies:
  - NCOW-31
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-31's fix pass corrected regenerateStaleConfig()'s thrown-value logging so a thrown non-Error no longer logs the literal string '(undefined)', using attempt.thrown?.message ?? String(attempt.thrown). Review pass 2 probed 12 adversarial thrown values and found this genuinely fixes every real shape pm2Control can produce, but introduces one narrow regression: throw Object.create(null) makes String(attempt.thrown) itself throw ('Cannot convert object to primitive value'), so regenerateStaleConfig() rejects instead of logging a readable failure message. This is harmless in practice -- engine-context.js's own .catch((err) => ({regenerated:false, reason:'error', error: err})) absorbs the rejection and the manifest correctly stays unstamped either way, so the retry-safety guarantee is not affected -- but the log line is lost for this edge case, and it's a contrived-but-real regression versus the pre-fix behavior (which at least logged something, if unhelpfully).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A thrown null-prototype object (or any other value String() can't safely stringify) produces a readable log message instead of causing regenerateStaleConfig() to reject
- [x] #2 All 12 of review pass 2's previously-probed thrown-value shapes (Error, plain string, array, Symbol, plain object, null, undefined, 0, false, etc.) continue to log sensibly and continue to leave the manifest unstamped on failure
- [x] #3 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read regenerateStaleConfig() in configGen.js and the existing attempt.thrown?.message ?? String(attempt.thrown) line.
2. Read test/engine/configGen.test.js's existing thrown-value tests and NCOW-31's review-pass-2 commit for the exact regression description.
3. Add a describeThrownValue(thrown) helper: try .message, then String(), then util.inspect() (survives null-prototype objects and hostile stringifiers without invoking user toString/valueOf/Symbol.toPrimitive), then a final type/constructor-name fallback -- every layer wrapped so the function itself can never throw.
4. Swap the inline expression for a call to this helper.
5. Add tests: dedicated null-prototype-object regression test, hostile-toString/Symbol.toPrimitive test, and a table-driven sweep reconstructing review pass 2's 12 adversarial shapes.
6. Run npm test, commit, push.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Worker implementation complete on branch fix/NCOW-36-configgen-thrown-value-guard (commit 428d62c), pushed to origin.

Evidence:
- npm test: 336/336 passed (333 baseline + 3 new tests).
- Adversarial thrown-value shapes exercised through the full regenerateStaleConfig() path, each asserted non-rejecting, sensibly logged, and manifest-unstamped: Error, plain string, array, Symbol, plain object with .message, plain object without .message, null, undefined, 0, false, NaN, null-prototype object (Object.create(null) -- the specific regression), object with throwing toString, object with throwing Symbol.toPrimitive (with throwing toString fallback too).
- Verified in isolation that String(Object.create(null)) and String() on hostile toString/Symbol.toPrimitive objects genuinely throw pre-fix, and the new describeThrownValue logic produces readable output post-fix (e.g. "[Object: null prototype] {}").

Noted but out of scope (pre-existing, not a regression): "if (attempt.thrown)" is a truthiness check that predates this task, so falsy thrown values (null/undefined/0/false/NaN) don't enter the THREW branch -- they fall through to the separate "restart reported failure, no error object" branch, already covered by an existing test and still leaving the manifest unstamped. Table-driven test asserts the correct differing reason/message shape for those five cases.

Status: implemented, ready for review.

Review verdict (pass 1): request_changes. All 3 ACs confirmed as literally written (reviewer independently ran the full suite, reproduced 333 baseline vs 336 with new tests, confirmed the 3 new tests fail against pre-fix source, verified Object.create(null) genuinely throws pre-fix and is readable post-fix, and ran a 19-shape adversarial probe plus 7-shape live run through the real regenerateStaleConfig() confirming the manifest is NEVER stamped across all shapes including the ones that still reject) -- but flagged two blocking-but-small findings that undermine the helper's own "can never throw" guarantee:

Finding A (blocking, small): describeThrownValue()'s layer 1 (`if (message != null) return message;`) has no type check, so a non-string .message (e.g. {message: Symbol('x')}, {message: Object.create(null)}, {message: {toString(){throw}}}) is returned verbatim, and the CALLER's template interpolation then throws -- regenerateStaleConfig() still rejects and the warn line is lost. Confirmed live against the real exported function for all 3 sub-cases.

Finding B (blocking, small): the deep fallback's own template literal (`[unstringifiable thrown value: typeof ...${ctorName ...}]`) is unguarded -- a value with a throwing util.inspect.custom AND Symbol.toPrimitive AND a constructor.name that is itself unstringifiable (Symbol or null-proto) reaches this line and throws, falsifying the "every layer wrapped so the function itself can never throw" claim. Confirmed live for two variants.

Reviewer's recommended fix (1-3 lines): type-check layer 1 output and funnel every return path through one safe stringifier, or wrap the whole function body in an outer try/catch returning a fixed fallback string on any internal throw -- turning "handled shapes we thought of" into a total guarantee. Care needed: don't naively require typeof message === 'string' and reject non-string -- must still coerce falsy-but-present messages like '' or 0 (NCOW-31's own deliberate behavior), not downgrade them to a generic fallback.

Also flagged nits (non-blocking): 3 dead "eslint-disable" comments referencing a linter that doesn't exist anywhere in this repo (no config, no dependency, no lint script) -- should be removed; AC#1's null-prototype test only asserts absence-of-badness, not the actual rendered message content -- consider asserting the message text itself (e.g. matches /Object: null prototype/).

Confirmed pre-existing, correctly out of scope, NOT a gap: the "if (attempt.thrown)" truthiness check (git blame: NCOW-31's own commit d0e2362, already on dev before this branch) -- falsy thrown values fall through to a different, already-safe "restart-failed" branch and stay unstamped; this is a no-regression AC and is satisfied.

Retry-safety guarantee (manifest never stamped) confirmed preserved even for the shapes that still reject.

Dispatching a fresh worker fix pass with these findings verbatim (fix-cycle 1 of 2 allowed retries).

Fix pass 1 complete on branch fix/NCOW-36-configgen-thrown-value-guard (commit d830627, on top of 428d62c), pushed to origin.

Fix: added a safeStringify(value) helper (typeof-string passthrough -> String() -> util.inspect() -> fixed fallback, structurally cannot throw) and routed every return path in describeThrownValue() through it (layer 1's coerced .message fixes Finding A; the deep fallback's ctorName fixes Finding B). Wrapped the whole function body in an outer try/catch as a structural backstop -- this is a closed-form fix, not another special case: every interpolation site now consumes an already-guaranteed-string value, and the outer try/catch means even a future edit adding one more raw interpolation can't reopen this class of bug.

Evidence:
- npm test: 339/339 passed (49 in configGen.test.js).
- Verified live against the reviewer's exact adversarial values: {message: Symbol('x')} -> "Symbol(x)"; {message: Object.create(null)} -> "[Object: null prototype] {}"; {message: {toString(){throw}}} -> readable fallback; the compound throwing-inspect.custom + throwing-Symbol.toPrimitive + unstringifiable-constructor.name shape (both Symbol and null-proto constructor.name variants) -> readable "[unstringifiable thrown value: ...]" message. None throw.
- Added 4 new test blocks reproducing the reviewer's exact shapes for Finding A, Finding B, and falsy-message preservation ({message: 0} still logs "(0)", {message: ''} still logs "()" -- NCOW-31's deliberate behavior preserved).
- Strengthened the null-prototype test and the "plain object without .message" sweep row to assert actual rendered content, not just absence-of-badness (addresses reviewer's nit D).
- Removed the dead eslint-disable comments (found 2 in the repo, not 3 as the review estimated -- removed both; no eslint config/dependency exists either way, addresses nit C).
- Confirmed the pre-existing 12-shape AC#2 sweep and retry/no-stamp guarantees still pass unmodified in logic.

Status: fix pass 1 implemented, ready for review pass 2.

Review verdict (pass 2): approve. All 3 ACs independently confirmed. Findings A and B from pass 1 are genuinely CLOSED -- reviewer confirmed this is a structural fix, not a moved goalpost: the function's return-type contract changed from "returns whatever .message was" to "returns a genuine typeof === 'string'" via the new safeStringify() helper, plus an outer try/catch backstop. Reviewer actively tried to falsify the "structurally cannot throw" claim with 27 direct + 33 end-to-end adversarial shapes (hostile Proxies, throwing traps, stack-overflowing toString, self-referential inspect output, etc.) -- zero throws, zero non-string returns across all of them.

Non-vacuity proof: reviewer replayed the new tests against the pre-fix source (428d62c) and confirmed 8 rejections there that all pass at HEAD (d830627) -- the tests genuinely discriminate, not passing vacuously.

AC#2 re-verified for ALL 12 original adversarial shapes end-to-end (not spot-checked) -- all correct, manifest unstamped in every case. Falsy-message preservation ({message: 0} -> "0", {message: ''} -> "", {message: false} -> "false", {message: NaN} -> "NaN") confirmed for real, not just claimed.

npm test: 339/339 (reviewer's own independent run).

Non-blocking findings for future follow-up (not required for this task):
- minor: orphaned JSDoc block for regenerateStaleConfig -- the doc comment now sits ~105 lines above the function it documents, since pass 1 inserted two helper functions between them. Cosmetic.
- minor: the adjacent "restart-failed" branch (a different code path, not touched by this task) still has an unguarded `${error.code}: ${error.message}` interpolation that can reject the same way for a hostile pm2Control-returned error object -- reviewer confirmed live (Symbol code, null-proto message, throwing code getter all reject with no log line). Out of scope for NCOW-36 (that branch handles a RETURNED error object, not a THROWN value, and pm2Control's own output is far less arbitrary than an arbitrary thrown value) but safeStringify() now makes it a one-line fix if wanted.
- nit: identical unhardened pattern at src/main/autoUpdate.js:100 (`err?.message ?? String(err)` in an error handler that promises "never throw").
- One residual theoretical limit noted explicitly as non-blocking: an infinitely-LOOPING (not recursing) toString would hang inside String() -- a try/catch can't fix a hang, but the claim made ("cannot throw") still stands; the recursive/stack-overflow case was tested and degrades cleanly.

Approved for merge. Suggested (not yet created, needs user approval per campaign convention): a small follow-up task to harden the restart-failed branch and autoUpdate.js:100 with the same safeStringify() pattern -- will propose to user before creating.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Hardened regenerateStaleConfig()'s thrown-value logging guard with a safeStringify()/describeThrownValue() helper that structurally cannot throw for any input (typeof-string passthrough -> String() -> util.inspect() -> fixed fallback, plus an outer try/catch backstop), replacing a version that still threw on Object.create(null) and similar unstringifiable shapes. Went through two review rounds: the first fix pass (a single null-prototype special case) was found by review to still leak on adjacent shapes (non-string .message, unstringifiable constructor.name); the merged version is a structural fix, not another special case. Verified by independent review (model: opus, 2 passes): 60+ adversarial probes (hostile Proxies, throwing traps, stack-overflowing toString, self-referential inspect output) found no remaining gap; non-vacuity confirmed by replaying the new tests against the pre-fix source (8 genuine failures there, 0 at HEAD); all 12 of the original adversarial thrown-value shapes re-verified end-to-end with the manifest confirmed unstamped in every case; falsy-message preservation ({message: 0} -> "0", not a generic fallback) confirmed. npm test: 339/339 passed at final review (343/343 after later rebase). Two non-blocking follow-up candidates noted (not created as tasks): the same unguarded-interpolation pattern in the adjacent restart-failed branch, and in autoUpdate.js:100.
<!-- SECTION:FINAL_SUMMARY:END -->
