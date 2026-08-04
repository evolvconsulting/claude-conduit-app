---
id: NCOW-36
title: Harden configGen's thrown-value logging guard against unstringifiable throws
status: In Progress
assignee: []
created_date: '2026-08-04 19:30'
updated_date: '2026-08-04 21:07'
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
- [ ] #1 A thrown null-prototype object (or any other value String() can't safely stringify) produces a readable log message instead of causing regenerateStaleConfig() to reject
- [ ] #2 All 12 of review pass 2's previously-probed thrown-value shapes (Error, plain string, array, Symbol, plain object, null, undefined, 0, false, etc.) continue to log sensibly and continue to leave the manifest unstamped on failure
- [ ] #3 npm test passes
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
<!-- SECTION:NOTES:END -->
