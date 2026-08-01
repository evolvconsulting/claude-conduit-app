---
id: NCOW-17
title: 'Diagnostics: address NCOW-16 review findings'
status: Done
assignee: []
created_date: '2026-08-01 02:43'
updated_date: '2026-08-01 10:48'
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
- [x] #1 checkStreaming's elapsed-time budget is enforced even while parked inside a reader.read() call, not just between calls -- e.g. via Promise.race([reader.read(), remainingBudgetTimer]) -- with a test using a mocked response body that never enqueues and never closes, proving the loop no longer hangs past its budget
- [x] #2 The timeout message (timeoutDetail()) names the actual model the user selected in Setup (e.g. via primaryModelId, already in scope in runDiagnostics), not a hardcoded alias like 'claude-sonnet-4-5' that the user never chose
- [x] #3 Diagnostics' worst-case total wall time (now roughly 5x60s + check 10's 120s, ~7 minutes) has either a UI-level way to cancel an in-progress run, or the IPC handler no longer holds the per-domain mutex for the entire duration -- whichever is the better fit after reviewing ipc.js and diagnostics-view.js
- [x] #4 DESIGN.md section 11 is updated to reflect the diagnostics timeout behavior introduced by NCOW-16, per CLAUDE.md's rule that a Backlog task's decision wins over DESIGN.md and the doc should be corrected
- [x] #5 The streaming read loop's buffer growth (currently unbounded with an O(n^2) rescan via repeated includes()) is reviewed and bounded if it's a real concern for long-running slow-model streams
- [x] #6 npm test passes
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

REVIEW (opus, independent) -- VERDICT: approve. All 6 ACs independently confirmed with fresh evidence: AC#1 -- reproduced the pre-fix hang on a ReadableStream that never enqueues/closes, confirmed the Promise.race sentinel approach genuinely breaks the loop. AC#2 -- confirmed via configGen.js that checkClaudeWildcard's displayModel:primaryModelId routing claim is factually correct (claude-* -> nvidia_nim/${primaryModelId}). AC#3 -- independently read ipc.js's mutexes map and confirmed diagnostics genuinely has no entry (the code's own doc comment says so), so the Cancel-button branch was the only available option; traced the AbortController/AbortSignal.any plumbing end-to-end through every threaded check including execFile's native signal option in checkLiveCliSmoke, no dropped references. AC#4 -- spot-checked every timeout number in the new DESIGN.md table against the actual code constants, all correct. AC#5 -- confirmed STREAM_SCAN_TAIL_CHARS=1024 has ~79x headroom over the only token ever scanned for ('message_start', 13 chars), and that .includes() runs before any trim so a real match can never be lost. AC#6 -- see cross-branch caveat below. Scope confirmed clean (exactly the 6 expected files). Preload claim verified directly (CHANNELS-driven auto-derivation, no manual edit needed). Commit conventions confirmed correct on all 3 commits.

Non-blocking findings: (1) a timer leak in checkStreaming's budget timer when reader.read() rejects rather than resolving or timing out (clearTimeout sits after the race, so a rejecting read skips it) -- reachable via the new cancel path itself (abort makes the read reject), no functional impact since the result is still correct, timer self-expires within the remaining budget (<=60s), same shape as a pre-existing analogous gap in checkLiveCliSmoke; (2) AC#1's test assertion bound (elapsed<5000ms for a 150ms budget) is looser than it needs to be -- proves the AC but wouldn't catch a coarse partial regression; (3) no automated test coverage for the IPC/renderer half of AC#3 (engine-context.js's cancel handler, the Cancel button itself) -- reviewer verified this half by hand instead, calls out it's a pre-existing structural test gap, not new to this task; (4) pre-existing (not introduced by this diff) possible null-root dereference in diagnostics-view.js if a user navigates away mid-run; (5) already-documented-by-worker single-slot AbortController tradeoff for overlapping runs, acceptable given the renderer disables re-entry.

CROSS-BRANCH CAVEAT (does not block NCOW-17, but changes merge sequencing): the one npm test failure in NCOW-17's own worktree (test/main/licenses.test.js, 78 !== 79) is NOT a NCOW-17 regression -- licenses.json is byte-identical to dev in this diff. It's an artifact of this worktree's node_modules having macOS's fsevents optional dependency (which the orchestrator's own long-lived main checkout was ALSO independently found to be missing, confirming NCOW-18's root-cause diagnosis exactly). Reviewer flagged that merging NCOW-18 (which sets licenses.bundled to 79 to match a fresh install) needs sequencing awareness: the canonical dev checkout's own historically-stale node_modules would otherwise show a *new* failure in the opposite direction until it's refreshed. Orchestrator will merge NCOW-18 before NCOW-17 to avoid ever hitting a real test failure during the merge queue's own rebase-and-verify step, and has already refreshed its own main checkout's node_modules (npm install picked up fsevents, confirming the diagnosis) ahead of the merge walk.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closed all 5 non-blocking findings from NCOW-16's review: (1) checkStreaming's elapsed-time budget now enforced via Promise.race even while parked inside reader.read(); (2) timeout/failure messages now name the real selected model (primaryModelId/smallModelId) instead of a hardcoded alias; (3) added a UI Cancel button + AbortController plumbing (diagnostics:cancel IPC channel) since the diagnostics domain has no per-domain mutex to release; (4) DESIGN.md section 11 rewritten with an accurate timeout table; (5) streaming buffer growth now bounded via a 1024-char tail-trim. 11 new tests added (29/29 in diagnostics.test.js). Independently re-verified by an opus reviewer with fresh evidence: reproduced the pre-fix infinite hang, verified the mutex-absence premise directly against ipc.js, traced AbortController plumbing end-to-end, spot-checked every DESIGN.md timeout number against code. Merged after NCOW-18 (deliberate ordering to avoid the known cross-branch licenses.json count mismatch during the merge queue's mandatory post-rebase test) via PR #4 (squash commit 3cdd1f9). Full npm test: 161/161 pass on merged dev. Wave-level integration review (opus) found zero cross-task issues between this and NCOW-18.
<!-- SECTION:FINAL_SUMMARY:END -->
