---
id: CCA-66
title: >-
  Investigate npm test full-suite concurrency flake dropping test files under
  load
status: Done
assignee:
  - '@claude'
created_date: '2026-08-17 16:02'
updated_date: '2026-08-17 22:39'
labels:
  - test-infra
  - bug
dependencies: []
priority: medium
ordinal: 84000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two independent reviewers in the wave-19 backlog campaign (2026-08-17, reviewing CCA-14.5 and the wave-19 integration cleanup) each independently hit a transient full-suite npm test failure: instead of the real 583/583, a run reported 563 tests / 561 pass / 2 fail. Both reviewers traced it: the two apparent failures were test/main/licenses.test.js and test/renderer/about-dialog.test.js (per CCA-14.5's worker) or test/main/licenses.test.js and test/main/menu.test.js (per the wave-19 cleanup reviewer) failing to load/register their tests at all under node --test's full-suite concurrency, each reporting as a single failing test while its real tests (15 in licenses.test.js, 7 in menu.test.js) silently vanish from the count. Both files pass cleanly every time when run in isolation. This is not a flaky assertion — it's a file-level load race, meaning an affected run's reported N/N-passing figure is genuinely smaller than the real suite, which could let a stale or incomplete run be mistaken for a full clean pass in a future session or PR review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Root cause identified: why specific test files (so far seen: licenses.test.js, about-dialog.test.js, menu.test.js) intermittently fail to load under node --test's full-suite concurrency, while passing cleanly in isolation every time
- [x] #2 A fix or mitigation is implemented and proven non-vacuous by reproducing the failure before the fix and confirming it no longer reproduces after, across multiple full-suite runs
- [x] #3 npm test passes with the real, complete test count with no unexplained file-load failures across at least 5 consecutive full-suite runs
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reproduce the file-load race by running a fresh npm ci + many parallel full-suite npm test invocations under CPU-constrained conditions (electron's lazy binary download only races when node_modules/electron/dist is not yet fully populated).
2. Root-cause: electron@43.2.0 ships no postinstall script; its binary is downloaded lazily on first require('electron') (src/main/menu.js -> electron). node --test's default per-file process concurrency lets multiple of the 3 test files that transitively require menu.js (licenses.test.js, menu.test.js, about-dialog.test.js) call require('electron') at nearly the same instant right after a fresh install, before any of them has finished extracting the zip. Two concurrent extractions collide creating the same locale .pak file (EEXIST), crashing that require() and killing the whole test file's child process before any test() registers -- Node's test runner then reports the whole file as a single failing entry and the file's real subtests vanish from the count.
3. Fix: add a postinstall script ("node -e \"require('electron')\"") to package.json so electron's lazy install runs once, synchronously, during npm ci -- before any test file can race on it.
4. Verify non-vacuously: re-run the exact same fresh-install + heavy-parallel-npm-test repro (CPU-constrained Docker container) with the fix in place and confirm the race no longer reproduces across multiple runs.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Investigation so far: could not reproduce the whole-file-vanishing symptom via idle CPU-spin stress, nor via 4x/8x/20x parallel full-suite npm test invocations, nor via forcing --test-concurrency=44 (all files at once) combined with 20 parallel invocations on this 10-core macOS host. That last combo DID reproduce a different, real flake: 'shutdown: NCOW-52 AC#8' (test/main/shutdown.test.js) fails intermittently under heavy contention because it asserts a hardcoded 50ms outer timeout bound against a wedged pm2.stop — timing-based, not a file-load race, and out of CCA-66's scope (not touching it). Confirmed via a PID-print experiment that node --test isolates each file into its own OS process by default (no shared module state across files), ruling out a cross-file singleton race as the mechanism. Now trying a CPU-constrained (--cpus=2) Docker container running node:20-slim to simulate a more resource-starved environment closer to what a busy multi-agent dev machine might create.

Root cause reproduced and confirmed in a 2-CPU-constrained Docker container (node:20-slim) running a fresh npm ci followed by 16 parallel full-suite 'npm test' invocations: multiple runs showed test counts below 583 (565-585) with 'not ok N - /app/test/main/menu.test.js' style entries -- the whole file reported as a single failing test, exactly matching CCA-66's symptom. Traced to electron@43.2.0 having no postinstall script (verified: require('electron/package.json').scripts is undefined) -- its binary/locale files are extracted lazily on first require('electron'), and src/main/menu.js requires electron at module load time. licenses.test.js, menu.test.js, and about-dialog.test.js all transitively require src/main/menu.js (confirmed via grep), making them the only 3 files that can hit this race -- matching exactly which files the original reviewers saw fail. Fix applied: added a postinstall script forcing require('electron') once, synchronously, during npm ci. Verification re-run in progress.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Root cause: electron@43.2.0 ships no postinstall script, so its binary/locale files download lazily on first require('electron'). src/main/menu.js requires electron at module load time, and three test files (licenses.test.js, menu.test.js, about-dialog.test.js) all transitively require menu.js. Under node --test's default per-file process concurrency, right after a fresh install multiple of those files' subprocesses can call require('electron') at nearly the same instant, before any has finished extracting the zip -- two concurrent extractions collide creating the same locale .pak file (EEXIST), crashing that require() and killing the whole test file's process before any test() registers. Node's runner then reports the whole file as one failing entry and its real subtests vanish from the count -- exactly CCA-66's reported symptom. Reproduced directly: in a 2-CPU-constrained Docker container (node:20-slim), a fresh npm ci followed by 16 parallel full-suite npm test runs reliably produced 'not ok N - /app/test/main/menu.test.js'-style whole-file failures with counts below the real 585 (seen: 565-585). Fix: added a postinstall script (node -e "require('electron')") to package.json so electron's lazy install runs once, synchronously, during npm ci, before any test file can race on it. Verified non-vacuously: re-ran the identical repro (fresh npm ci + 16 parallel full-suite runs, same constrained container) with the fix in place -- all 16 runs now show a stable, identical tests count (585) with zero whole-file failures; the only remaining failures are pre-existing, unrelated timing-sensitive assertions (spawnDaemon/resolveDaemonInterpreter/shutdown tests) that only surface under this extreme 16-way/2-CPU stress and are out of CCA-66's scope. Also ran 5 consecutive normal (non-stressed) full-suite npm test invocations on the actual host repo post-fix: all 5 show the real complete count (583/583 pass, 0 fail), confirming no regression and no unexplained file-load failures under ordinary conditions.
<!-- SECTION:FINAL_SUMMARY:END -->
