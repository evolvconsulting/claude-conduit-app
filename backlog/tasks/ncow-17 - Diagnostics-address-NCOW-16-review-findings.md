---
id: NCOW-17
title: 'Diagnostics: address NCOW-16 review findings'
status: In Progress
assignee: []
created_date: '2026-08-01 02:43'
updated_date: '2026-08-01 10:13'
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
