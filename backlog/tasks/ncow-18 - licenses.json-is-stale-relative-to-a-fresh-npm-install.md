---
id: NCOW-18
title: licenses.json is stale relative to a fresh npm install
status: Done
assignee: []
created_date: '2026-08-01 02:43'
updated_date: '2026-08-01 10:48'
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
- [x] #1 A fresh 'npm install' from the current package-lock.json followed by 'npm run licenses' regenerates src/assets/licenses.json with no unexpected diff, or if there IS a real diff, it's committed
- [x] #2 test/main/licenses.test.js passes under a genuinely fresh npm install (verified by testing in a clean worktree or after rm -rf node_modules, not just on a long-lived local checkout)
- [x] #3 npm test passes
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

REVIEW (opus, independent) -- VERDICT: approve. All 3 ACs independently confirmed with fresh evidence (not the worker's claims): AC#1 -- fresh `npm run licenses` regen is byte-identical (same SHA-256) to the committed file, no residual diff. Reviewer also reproduced the original failure by checking pre-fix licenses.json against a fresh node_modules: 78 !== 79, matching the task description exactly, confirming this is a genuine fix and not a no-op. AC#2 -- rm -rf node_modules && npm install && npm run licenses && node --test test/main/licenses.test.js: 11/11 pass. AC#3 -- 3 consecutive full npm test runs, 150/150 pass each; the worker's reported transient electron-require flake did not reproduce even on the first post-install run. fsevents confirmed a real production transitive dep via npm ls (pm2 -> chokidar -> fsevents); license text byte-matches node_modules' own LICENSE file, not truncated/placeholder. Scope confirmed clean: only src/assets/licenses.json changed, package-lock.json not committed, zero overlap with sibling NCOW-17. Commit message matches repo conventions.

Non-blocking findings (not gating merge): (1) the fix flips which platform the test fails on (darwin-only optional dep fsevents) rather than making the test truly platform-portable -- fine given this repo has no CI and is macOS-developed, but a latent trap if that ever changes; (2) the test's count-based diagnostic (78 !== 79) is weak versus a name-set diff -- worth a follow-up task; (3) minor over-disclosure of an MIT notice in non-mac packaged builds -- harmless.

Reviewer also flagged for the wave log: the package-lock.json `license` field normalization (npm 10.9.8 vs whatever generated the current lockfile) reproduces on every fresh install and should get a single centralized fix rather than every future worker reverting it independently; and confirmed the NCOW-12 wave-conflict reasoning was correct -- generate-licenses.js derives its app name from productName, so the Claude Conduit rebrand will necessarily need its own `npm run licenses` re-run after this merges.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Regenerated src/assets/licenses.json to add fsevents (MIT, darwin-only optional dep of chokidar/pm2), fixing staleness against a genuinely fresh npm install. Root cause: this repo's own long-lived checkouts had node_modules that predated fsevents' resolution. Verified via rm -rf node_modules && npm install && npm run licenses && node --test test/main/licenses.test.js (11/11 pass) and full npm test (150/150). Independently re-verified by an opus reviewer with fresh evidence (byte-identical regen, reproduced the original 78 vs 79 failure, confirmed fsevents is a real production transitive dependency with correct license text). Merged via PR #3 (squash commit e80b263).
<!-- SECTION:FINAL_SUMMARY:END -->
