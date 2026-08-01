---
id: NCOW-17
title: 'Diagnostics: address NCOW-16 review findings'
status: In Progress
assignee: []
created_date: '2026-08-01 02:43'
updated_date: '2026-08-01 10:32'
labels: []
dependencies:
  - NCOW-16
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Independent review of NCOW-16 (diagnostics timeout rework, PR #2) approved the change but surfaced several non-blocking findings worth addressing as a follow-up. All four relate to src/engine/diagnostics.js as reworked by NCOW-16.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 checkStreaming's elapsed-time budget is enforced even while parked inside a reader.read() call, not just between calls -- e.g. via Promise.race([reader.read(), remainingBudgetTimer]) -- with a test using a mocked response body that never enqueues and never closes, proving the loop no longer hangs past its budget
- [ ] #2 The timeout message (timeoutDetail()) names the actual model the user selected in Setup (e.g. via primaryModelId, already in scope in runDiagnostics), not a hardcoded alias like 'claude-sonnet-4-5' that the user never chose
- [ ] #3 Diagnostics' worst-case total wall time (now roughly 5x60s + check 10's 120s, ~7 minutes) has either a UI-level way to cancel an in-progress run, or the IPC handler no longer holds the per-domain mutex for the entire duration -- whichever is the better fit after reviewing ipc.js and diagnostics-view.js
- [ ] #4 DESIGN.md section 11 is updated to reflect the diagnostics timeout behavior introduced by NCOW-16, per CLAUDE.md's rule that a Backlog task's decision wins over DESIGN.md and the doc should be corrected
- [ ] #5 The streaming read loop's buffer growth (currently unbounded with an O(n^2) rescan via repeated includes()) is reviewed and bounded if it's a real concern for long-running slow-model streams
- [ ] #6 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read src/engine/diagnostics.js, src/main/ipc.js, src/main/ipc-channels.js, src/renderer/views/diagnostics-view.js, and DESIGN.md section 11 in full before writing code.
2. Confirm real model-id sourcing (configGen.js alias resolution) so AC#2 uses the actually-selected model, not a hardcoded alias.
3. Confirm whether the diagnostics IPC domain holds a per-domain mutex (it doesn't) to decide AC#3's approach: UI-level Cancel vs releasing a mutex.
4. Implement AC#1 (Promise.race elapsed-budget enforcement inside a single reader.read()), AC#2 (real model name in timeout/failure messages), AC#3 (Cancel button + AbortController threaded through the check chain), AC#4 (DESIGN.md section 11 rewrite), AC#5 (bounded streaming buffer via tail-trim).
5. Write targeted tests for each AC using mocked response bodies / AbortSignal scenarios.
6. Run npm test; confirm the only failure is the known pre-existing NCOW-18 licenses.json staleness (being fixed in a sibling worktree).
7. Push the branch.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented and pushed (branch fix/NCOW-17-diagnostics-review-followups, 3 commits: d9c630c, 904b93b, c8ef3aa). Files touched: src/engine/diagnostics.js, test/engine/diagnostics.test.js (+11 tests), src/main/ipc-channels.js, src/main/engine-context.js, src/renderer/views/diagnostics-view.js, DESIGN.md.

AC#1: checkStreaming's read loop now does Promise.race([reader.read(), remainingBudgetTimer]) per iteration instead of only checking elapsed time between reads. Test uses a ReadableStream whose pull() never resolves/closes and asserts the check still returns within ~150ms.
AC#2: checkCompletion/checkToolCalling/checkStreaming gained an optional displayModel param (defaults to model) used only in user-facing messages; the real primaryModelId/smallModelId is now passed through from runDiagnostics/runQuickValidation/checkSmallModel/checkClaudeWildcard. 5 new tests confirm the alias never appears and the real id does.
AC#3 (judgment call): the diagnostics IPC domain has no entry at all in ipc.js's per-domain mutex map, so "release the mutex" was moot -- implemented a UI Cancel button instead. New diagnostics:cancel IPC channel (preload auto-derives it, no manual preload edit per CLAUDE.md); engine-context.js tracks a per-run AbortController; signal threaded through postMessages/checkProxyAlive/checkAuthEnforced/checkCompletion/checkToolCalling/checkStreaming/checkLiveCliSmoke (execFile's native signal option). runDiagnostics checks signal.aborted before each step. diagnostics-view.js adds a Cancel button and a distinct "Cancelled" summary state. 4 new tests cover pre-aborted, mid-run cancel, and mid-flight cancellation reporting "Cancelled" rather than a false timeout message.
AC#4: DESIGN.md section 11 rewritten with a timeout table and a paragraph covering the 60s philosophy, per-read streaming budget, buffer bound, ~7min worst case, and the Cancel button.
AC#5: added STREAM_SCAN_TAIL_CHARS=1024 tail-trim after an unsuccessful includes() scan (safely larger than the longest scanned token). Test forces a trim then splits a target token across the trim boundary and confirms it's still found.
AC#6: npm test -- 161 tests, 160 pass, 1 fail; the only failure is test/main/licenses.test.js's pre-existing staleness issue (NCOW-18, fixed in a sibling worktree this same wave, unrelated to this diff). diagnostics.test.js alone: 29/29 pass.

Judgment calls (worker's own words): (1) AC#3 mechanism chosen after confirming no mutex exists to release. (2) Signal-threading scoped to checks that are cleanly interceptable -- checkNimReachable (check 3, lives in src/engine/modelCatalog.js, outside this task's declared scope, already short-timeout) and checkCliConfigCoherent (check 9, synchronous) were left without signal threading; between-check cancellation still bounds the wait to that check's own already-short timeout. (3) Considered but dropped an extra 'abort' event-listener race inside checkStreaming's read loop due to listener-leak risk; the existing per-read budget timer already bounds a mid-read cancel to the same guarantee a timeout would give. (4) Added an optional timeoutMs passthrough to checkSmallModel/checkClaudeWildcard for testability (backward-compatible).

Flagged out of scope: DESIGN.md section 11's heading still frames diagnostics as a `claude-nim-proxy test` CLI command that does not exist anywhere in this repo (no bin field, no CLI entrypoint) -- this app is GUI-only; worker added one clarifying sentence but did not rewrite the section's overall CLI-flavored framing, calling it a separate doc-staleness item bigger than this task's scope. Also noted (pre-existing, untouched): checkAuthEnforced's own code comment already documents that DESIGN.md section 11 claims check 2 should return 401/403 but real behavior is 500/400 without DATABASE_URL.
<!-- SECTION:NOTES:END -->
