---
id: NCOW-39
title: Soften overstated test comment on tray mutex-identity coverage
status: Done
assignee: []
created_date: '2026-08-04 22:21'
updated_date: '2026-08-04 22:48'
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
- [x] #1 The comment around line 800 of test/main/engine-context-config-regen.test.js no longer claims the two existing checks 'close the chain honestly' unless a coverage gap it would be referring to has actually been closed by that point (e.g. by the post-spread-override guard follow-up task)
- [x] #2 If the post-spread-override guard task has already landed, the comment may instead be updated to accurately describe the now-more-complete coverage; if not, it is softened to state the known residual gap explicitly
- [x] #3 npm test passes
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

Review pass 1 (opus): verdict request_changes. AC#1 and AC#3 confirmed (343/343, own run; 'close the chain honestly' phrase removed). AC#2 not certified: the softened comment (lines 799-802) still makes a false positive claim -- that the two existing checks jointly prove the tray gets a genuinely shared mutexes/handlers pair -- which is false in 3 ways: (1) reviewer empirically reproduced a private, unshared 'handlers' binding (nested block shadowing) passing the full suite 343/343, since the static check only ever inspects the 'mutexes' identifier, never 'handlers'; (2) NCOW-35's own review notes already recorded 2 more residual gaps (property-level mutation of mutexes.proxy -- verified a REAL serialization break in that review, and parameter shadowing) neither of which this new wording mentions; (3) the sentence structure implies the post-spread-override gap (correctly described) is the ONLY remaining hole, when it is 1 of at least 3. Fix is comment-only: reshape lines 799-802's opening claim to match what the checks actually settle (mutexes single-binding only, not handlers), and list the property-mutation and parameter-shadowing gaps alongside the post-spread one. Diff scope, commit conventions, and push were all otherwise confirmed clean.

Fix pass 1 (worker, commit a2ccdb2 on top of 6d8c391): rewrote lines ~799-812 to fix reviewer's F1 finding -- restated the opening claim to match exactly what the two checks prove (behavioural test: createTrayActions serializes through whatever mutex set it's handed, with negative control; static check: only 'mutexes', not 'handlers', is declared/bare-reassigned once in index.js) and listed all 4 known residual gaps as siblings (handlers has no single-binding check; property-level mutation of mutexes.proxy -- a verified real break per NCOW-35's review; parameter shadowing; the post-spread key override, now framed as one of several, tracked by NCOW-38). Reproduced reviewer's private-handlers-shadow probe locally to validate the new comment's accuracy, then reverted it (byte-identical diff confirmed). npm test 343/343 before and after. Comment-only diff confirmed.

Review pass 2 (opus): verdict approve. All 3 ACs confirmed independently -- 'close the chain honestly' phrase fully gone; opening claim now correctly scoped to what each check actually proves (mutexes-only for the static check, confirmed against the real regex source); reviewer reproduced the private-handlers-shadow gap themselves (343/343 on genuinely broken code) validating the comment's gap (a) claim; gap (b)'s 'verified real break' claim cross-checked against NCOW-35's own task notes; npm test 343/343 (reviewer's own run). Comment-only across both commits (6d8c391, a2ccdb2), Refs/Co-Authored-By trailers correct, branch pushed. Two low-severity residuals accepted per decide-vs-defer (F2: umbrella sentence slightly understates which gaps a text-only check could reach; F3: a negative-control mechanics detail is loosely described) -- both narrow, zero blast radius, worth folding into NCOW-38's edit of this same block when it lands. No further fix cycle needed; approved.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Softened test/main/engine-context-config-regen.test.js's overstated 'close the chain honestly' comment. 2 review rounds (opus, independent re-verification each pass): round 1 found the first softening replaced one overstatement with a narrower, still-false one (empirically reproduced a private-handlers-shadow passing 343/343); round 2 confirmed the fix correctly scopes the claim to what each check actually proves and lists all 4 known residual gaps as siblings. Comment-only diff across both commits. npm test 343/343 (both reviewer passes) and 348/348 on merged dev post-NCOW-37 (wave-integration reviewer's own run). Merged as PR #29 (c86f908). Wave-2 integration review found no cross-task conflicts.
<!-- SECTION:FINAL_SUMMARY:END -->
