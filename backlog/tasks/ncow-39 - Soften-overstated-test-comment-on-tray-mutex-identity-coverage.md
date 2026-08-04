---
id: NCOW-39
title: Soften overstated test comment on tray mutex-identity coverage
status: In Progress
assignee: []
created_date: '2026-08-04 22:21'
updated_date: '2026-08-04 22:27'
labels: []
dependencies:
  - NCOW-35
ordinal: 52000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
test/main/engine-context-config-regen.test.js has a block comment (around line 800) ending in the claim that the behavioural test (test/main/tray-actions.test.js) plus the file's own static single-binding check 'close the chain honestly.' NCOW-35's reviewer judged this overstated: it was written before the post-spread key-override gap (see the sibling follow-up task) was identified, and that gap means the two checks do not yet jointly close the chain. This task is comment-only unless the sibling follow-up task lands first, in which case the comment can honestly be restored once the new coverage actually closes the gap it describes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The comment around line 800 of test/main/engine-context-config-regen.test.js no longer claims the two existing checks 'close the chain honestly' unless a coverage gap it would be referring to has actually been closed by that point (e.g. by the post-spread-override guard follow-up task)
- [ ] #2 If the post-spread-override guard task has already landed, the comment may instead be updated to accurately describe the now-more-complete coverage; if not, it is softened to state the known residual gap explicitly
- [ ] #3 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read the block comment in test/main/engine-context-config-regen.test.js (~lines 755-800) describing what the behavioural test (tray-actions.test.js) and the static single-binding check jointly prove.
2. Since NCOW-38's post-spread-override guard has not landed yet, soften the comment to honestly state the residual gap (a future onStart/onStop/onRestart key added to createTray({...}) after the ...createTrayActions({ mutexes, handlers }) spread would silently win via JS object-literal override semantics, uncaught by either existing check) and point at NCOW-38 as the follow-up that would close it.
3. Comment-only change; do not touch test assertions or other files.
4. Run npm test to confirm no regressions.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented by worker (worktree fix/NCOW-39-soften-tray-chain-comment, commit 6d8c391, pushed to origin). Rewrote the comment at test/main/engine-context-config-regen.test.js lines ~789-800 to explicitly name the post-spread override gap and reference NCOW-38 as the task that would close it, rather than claiming the two existing checks 'close the chain honestly'. Verified comment-only via diff (no test() body touched). npm test: 343/343 passing.
<!-- SECTION:NOTES:END -->
