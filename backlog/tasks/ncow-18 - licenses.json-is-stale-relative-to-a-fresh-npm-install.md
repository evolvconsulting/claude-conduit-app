---
id: NCOW-18
title: licenses.json is stale relative to a fresh npm install
status: To Do
assignee: []
created_date: '2026-08-01 02:43'
updated_date: '2026-08-01 02:43'
labels: []
dependencies: []
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
test/main/licenses.test.js's "the generated list covers the whole production tree" check fails (78 !== 79, "licenses.json is stale -- run npm run licenses") under a genuinely fresh npm install from the current package-lock.json. It passes on at least one long-lived local checkout, whose node_modules happens to predate whatever dependency drift caused the mismatch -- masking the problem there. Discovered independently while running a Backlog campaign wave (NCOW-16) in a freshly-provisioned worktree; unrelated to that task's own changes.

Reproduce with: rm -rf node_modules && npm install && node --test test/main/licenses.test.js
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A fresh 'npm install' from the current package-lock.json followed by 'npm run licenses' regenerates src/assets/licenses.json with no unexpected diff, or if there IS a real diff, it's committed
- [ ] #2 test/main/licenses.test.js passes under a genuinely fresh npm install (verified by testing in a clean worktree or after rm -rf node_modules, not just on a long-lived local checkout)
- [ ] #3 npm test passes
<!-- AC:END -->
