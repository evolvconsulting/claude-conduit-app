---
id: NCOW-36
title: Harden configGen's thrown-value logging guard against unstringifiable throws
status: To Do
assignee: []
created_date: '2026-08-04 19:30'
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
