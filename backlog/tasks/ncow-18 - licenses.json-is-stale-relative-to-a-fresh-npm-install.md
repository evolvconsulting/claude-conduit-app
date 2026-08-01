---
id: NCOW-18
title: licenses.json is stale relative to a fresh npm install
status: In Progress
assignee: []
created_date: '2026-08-01 02:43'
updated_date: '2026-08-01 10:18'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reproduce the reported failure via `node --test test/main/licenses.test.js` in a genuinely fresh worktree (node_modules freshly installed by the orchestrator).
2. Read scripts/generate-licenses.js and test/main/licenses.test.js to understand the generation/verification mechanism exactly.
3. Run `npm run licenses`, diff old vs new licenses.json to find the real cause rather than assuming.
4. Root-cause the diff (expected: a platform-conditional optional dependency present on this OS but absent from the last commit's environment).
5. Re-verify against a fully clean rm -rf node_modules && npm install cycle (AC#2's explicit requirement).
6. Commit only src/assets/licenses.json with the real cause explained in the commit body.
7. Run full npm test and confirm 0 failures.
8. Push the branch.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented and pushed (branch fix/NCOW-18-licenses-json-stale, commit 359da07). Root cause confirmed: fsevents@2.3.3 (MIT, darwin-only optional dependency of chokidar, pulled in transitively via pm2) is installed on macOS but was absent from the environment where the committed licenses.json (78 entries) was last generated -- likely Linux CI or an older checkout. A fresh install on this darwin worktree genuinely resolves 79 packages, and both `npm run licenses` and the test's own independent `npm ls` call agree at 79. Fix is an 8-line diff adding exactly one entry (fsevents, MIT) -- nothing else changed, no version bumps, no removals.

Verification: rm -rf node_modules && npm install && npm run licenses && node --test test/main/licenses.test.js reproduced the identical single-entry diff and passed (11/11), satisfying AC#2's clean-install requirement directly in this dedicated worktree. Full npm test: 150/150 pass (confirmed across 4 consecutive runs after the clean reinstall).

Worker flagged two things for awareness, not scope: (1) npm install also touched package-lock.json (npm 10.9.8 normalizing a `license` field an older npm version didn't write) -- worker reverted this before committing since it's out of scope; if other campaign branches show the same lockfile drift independently, may be worth a single centralized fix rather than N workers each reverting it. (2) One run of npm test right after the from-scratch install showed 2 transient failures (require('electron') throwing at module-load time in menu.js tests) that self-resolved on every subsequent run and did not recur -- looks like a one-time postinstall/FS-settling race, not related to this task's change; not chased further since AC#3 only requires npm test to pass, which it now does reliably.
<!-- SECTION:NOTES:END -->
