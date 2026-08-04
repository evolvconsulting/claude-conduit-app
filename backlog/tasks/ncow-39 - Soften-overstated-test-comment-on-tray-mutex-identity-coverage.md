---
id: NCOW-39
title: Soften overstated test comment on tray mutex-identity coverage
status: To Do
assignee: []
created_date: '2026-08-04 22:21'
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
