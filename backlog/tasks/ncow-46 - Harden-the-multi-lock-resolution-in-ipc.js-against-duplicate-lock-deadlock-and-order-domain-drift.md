---
id: NCOW-46
title: >-
  Harden the multi-lock resolution in ipc.js against duplicate-lock deadlock and
  order/domain drift
status: In Progress
assignee: []
created_date: '2026-08-05 13:11'
updated_date: '2026-08-05 14:48'
labels: []
dependencies:
  - NCOW-45
ordinal: 59000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The wave-6 integration review of NCOW-45 found two related hardening gaps in src/main/ipc.js DOMAIN_MUTEX_ALIASES/resolveDomainLocks()/withLocks() (the multi-lock mechanism NCOW-45 introduced so uninstall can hold the proxy, config, and claudeCode mutexes simultaneously). Gap 1: resolveDomainLocks() does not dedupe the resolved lock objects it returns. If any DOMAIN_MUTEX_ALIASES entry ever resolved two of its aliased domains to the SAME underlying mutex function, withLocks() would reserve that one chain twice and deadlock permanently -- empirically reproduced (injecting a mutexes set where two alias targets pointed at the same function made uninstall:run never settle, the handler body never entered). This is not reachable via the current MUTEX_DOMAINS/createDomainMutexes() shape (one distinct mutex per domain), but IS reachable via the same opts.mutexes injection point registerIpcHandlers() itself accepts and documents, so it is a live foot-gun for any future caller or test fixture that constructs a mutexes object by hand. Gap 2: LOCK_ACQUISITION_ORDER (a hardcoded array of domain names) has no assertion tying it to the real MUTEX_DOMAINS list. A domain absent from LOCK_ACQUISITION_ORDER sorts to index -1 (first), and with two or more domains absent, the comparator returns 0 for both and Array.prototype.sorts stability means acquisition order silently collapses to whatever order each DOMAIN_MUTEX_ALIASES entry happens to list its targets in -- exactly the ordering inconsistency the fixed-order mechanism exists to prevent, reintroduced silently rather than failing loudly. Currently LOCK_ACQUISITION_ORDER, DOMAIN_MUTEX_ALIASES, resolveDomainLocks, and withLocks have zero direct test references anywhere -- all existing coverage is behavioral, through uninstall only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 resolveDomainLocks() deduplicates the resolved lock objects before returning them, so a domain alias table that resolves two entries to the same underlying mutex degrades to holding it once instead of deadlocking
- [ ] #2 A test demonstrates that two DOMAIN_MUTEX_ALIASES entries resolving to the same mutex function no longer deadlocks withLocks()
- [ ] #3 LOCK_ACQUISITION_ORDER is asserted (at module load or via a dedicated test) to be a permutation of the real MUTEX_DOMAINS list, and every value appearing anywhere in DOMAIN_MUTEX_ALIASES is confirmed present in LOCK_ACQUISITION_ORDER
- [ ] #4 A test demonstrates that an unlisted domain, or two unlisted domains, is caught (fails loudly) rather than silently sorting into an inconsistent or unstable order
- [ ] #5 The existing uninstall/update behavior and all pre-existing tests in test/main/ipc-mutex.test.js continue to pass unmodified
- [ ] #6 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read src/main/ipc.js (DOMAIN_MUTEX_ALIASES, LOCK_ACQUISITION_ORDER, resolveDomainLocks, withLocks, registerIpcHandlers), src/main/mutex.js (MUTEX_DOMAINS, createDomainMutex/createDomainMutexes) and test/main/ipc-mutex.test.js to confirm the exact deadlock mechanism in withLocks() (two reservations onto the same FIFO chain form a fixed-point cycle: the second reservation's release depends on the shared run it is itself blocking).
2. Gap 1 / AC#1: rewrite resolveDomainLocks() to dedupe by resolved lock *function identity* (a Set over the mapped mutex functions) after sorting into LOCK_ACQUISITION_ORDER, before returning — a collision degrades to holding the shared mutex once instead of reserving its chain twice.
3. Gap 2 / AC#3+#4: add a pure assertLockOrderIsConsistent(order, domains, aliases) that throws if order is not exactly a permutation of domains, or if any domain named anywhere in aliases is absent from order. DECISION: call it once at **module load** against the real LOCK_ACQUISITION_ORDER/MUTEX_DOMAINS/DOMAIN_MUTEX_ALIASES. Reasoning: the invariant is not test-environment-specific (a shipped build with these three hand-maintained lists out of sync is exactly as broken on a user machine as in CI); the cost is a handful of Set ops over 4-element arrays paid once per process, not per IPC call; a loud require()-time crash beats silently shipping with the ordering guarantee already gone. The function takes its three inputs as parameters and is exported so a dedicated test can call it with deliberately-broken inputs — which is what makes the module-load choice non-vacuous rather than unverifiable.
4. Export resolveDomainLocks, withLocks, assertLockOrderIsConsistent, DOMAIN_MUTEX_ALIASES, LOCK_ACQUISITION_ORDER from ipc.js (previously only registerIpcHandlers), matching this codebase's plain-named-export convention (cf. mutex.js's MUTEX_DOMAINS).
5. Add 10 new tests appended after the existing last test in test/main/ipc-mutex.test.js, widening only the top import line: direct dedupe unit test + no-regression companion (AC#1); end-to-end registerIpcHandlers()/uninstall:run with two alias domains on the same mutex proving no deadlock (AC#2) + a lower-level withLocks()-only test proving the raw mechanism DOES deadlock without dedupe; positive-case permutation/coverage test + a module-load wiring check (AC#3); four loud-failure tests against assertLockOrderIsConsistent() — one domain missing, two missing (the silent-instability case), an extra unlisted domain, an alias target absent from an otherwise-consistent order (AC#4).
6. Bound the two deadlock-reproduction tests to 50 Promise.resolve() microtask ticks rather than awaiting a possibly-permanently-pending result: the chain is pure synchronous Promise.then() with no macrotask/timer, so a real deadlock is a fixed-point cycle further ticks can never resolve — 'no progress after N ticks' is conclusive and can never hang the suite.
7. Run npm test.
8. Non-vacuity: revert resolveDomainLocks() to its pre-fix non-deduping body and neuter assertLockOrderIsConsistent() to a no-op with all new tests in place, rerun the file.
9. Restore the fix, verify byte-identical via git diff, rerun the full suite.
10. Commit in two logical commits mirroring NCOW-45's precedent (fix, then tests) and push.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Worker implementation evidence (wave 7, sonnet, worktree slot 1, branch fix/NCOW-46-harden-multi-lock-resolution @ base cd32488) — pre-review, not yet independently confirmed:**

- AC#1 (dedupe): direct unit test 'resolveDomainLocks() dedupes when two aliased domains resolve to the SAME underlying mutex function' passes against the fix (locks.length === 2, shared mutex appears once); FAILED against reverted code (locks.length === 3, duplicate present).
- AC#2 (no deadlock): end-to-end test through registerIpcHandlers()/uninstall:run with claudeCode and config aliased to the same mutex function resolves normally against the fix; against reverted code the same test FAILED (order stayed [] after 50 microtask ticks — the deadlock signature) without hanging the process.
- AC#3 (permutation assertion): assertLockOrderIsConsistent(LOCK_ACQUISITION_ORDER, MUTEX_DOMAINS, DOMAIN_MUTEX_ALIASES) does not throw against the real shipped constants; a source-text regex test confirms the call is wired at module scope, not merely defined/exported.
- AC#4 (loud failure): four assert.throws() tests — a domain removed, two domains removed (the sort-instability case), an extra unlisted domain, a DOMAIN_MUTEX_ALIASES target missing from an otherwise-internally-consistent order — all pass against the fix, all FAILED (no throw) against the neutered no-op.
- **Non-vacuity reproduction (exact):** with resolveDomainLocks() reverted to its pre-fix non-deduping form and assertLockOrderIsConsistent() replaced by a no-op, `node --test test/main/ipc-mutex.test.js` reported '# tests 32 / # pass 26 / # fail 6' in 47ms with no hang — the 6 failures were exactly the AC#1 dedupe test, the AC#2 end-to-end deadlock test, and all four AC#4 loud-failure tests. All 22 pre-existing tests plus the 4 unaffected new tests kept passing. Fix then restored from backup, verified byte-identical via git diff, full suite rerun green.
- AC#5: `git diff test/main/ipc-mutex.test.js` shows only the top import line widened — every pre-existing test body byte-for-byte unchanged; all 22 pre-existing tests passed in the baseline, post-fix, and non-vacuity runs.
- AC#6: baseline 400/400 before any change; final npm test '# tests 410 / # pass 410 / # fail 0' — the +10 are exactly the new NCOW-46 tests.
- **Judgment call flagged by the worker for review:** AC#3's 'module load or dedicated test' was resolved as module-load (see plan item 3) — an interpretive choice the task explicitly left open, not something objectively verified either way.

Files touched: src/main/ipc.js, test/main/ipc-mutex.test.js (nothing outside the predicted footprint). Commits a067090 (fix), bba5f41 (tests), pushed to origin.

**Independent review verdict (wave 7, opus, same worktree): APPROVE — all 6 ACs independently confirmed [1,2,3,4,5,6].**

Reviewer re-ran everything itself rather than trusting the implementer: npm test 400/400 on an isolated dev copy vs 410/410 on the branch; ipc-mutex.test.js 22/22 on dev vs 32/32 on branch; and it independently reproduced the non-vacuity result exactly (32 tests / 26 pass / 6 fail in 42ms, no hang — the 6 being the AC#1 dedupe test, the AC#2 end-to-end test, and all four AC#4 loud-failure tests).

**It went beyond the delivered evidence where the delivered evidence was weak.** It judged the shipped source-text regex insufficient on its own to prove AC#4's 'fails loudly' in situ, so it did 5 real `require()` loads of mutated module copies: unmutated control loads clean; one domain dropped, two dropped (the exact silent-instability case), a new MUTEX_DOMAINS entry added in mutex.js without updating the order (the realistic future-drift path), and an alias target absent from the order list ALL throw at require() with the expected messages. AC#4 is therefore established more strongly than claimed.

13 further behavioral probes of shapes the fix does not obviously cover: same domain name twice in one alias array is COVERED (identity dedupe collapses it); reverse-ordered alias arrays still resolve to [claudeCode, config, proxy], and with a shared duplicate spanning first and last the survivor keeps the EARLIEST slot — so dedupe-after-sort provably never degrades acquisition order (AC#5's real dependency). NCOW-45's queue-race guarantee re-verified intact (multi-lock uninstall invoked first still beats a later single-lock proxy competitor). withLocks()' 0-lock and 1-lock fast paths untouched. Fixed path enters the handler after 3 microtask ticks against a 50-tick budget (16x headroom).

**Module-load-vs-dedicated-test (AC#3's authorized open choice): reviewer DECIDED rather than escalated, concurring with module load.** It established the low-blast-radius claim instead of assuming it: all three inputs are developer-authored module constants (two literals in ipc.js, one in mutex.js, which imports nothing); `opts.mutexes` never reaches the assertion, which runs at module scope before registerIpcHandlers() can be called; no user data, config file, or env var reaches it. So for any given build it always throws or never throws — it cannot fire situationally on one user's machine. And because test/main/ipc-mutex.test.js and test/main/tray-actions.test.js both require ipc.js, the assertion runs on every npm test, meaning a build that would hard-fail an end-user launch cannot get through CI. That converts 'latent ordering bug becomes a hard boot failure' into 'latent ordering bug becomes an unshippable build' — strictly the better trade. Residual dependency: npm test must keep being run pre-release and at least one suite must keep requiring ipc.js (both true, and CLAUDE.md mandates the former).

Non-blocking findings recorded for disposition, none gating the merge:
1. Stale documented test counts — CLAUDE.md:51 and README.md:330 both still say 400 (now 410); a repeat of the exact omission PR #41 had to be opened for after wave 6.
2. DOMAIN_MUTEX_ALIASES and LOCK_ACQUISITION_ORDER are exported UNFROZEN and resolveDomainLocks() reads the module-scope bindings, so a consumer mutating the exported object changes real lock resolution AFTER the module-load assertion has run (reviewer exploited this deliberately in its own probing, so the hazard is real). No test pollution today — the new tests build local copies and node --test isolates per file. Object.freeze on both would close it.
3. Out-of-scope same-family hazards found by probing, both PRE-EXISTING and unchanged by this diff: an alias naming a domain absent from the injected mutexes silently NARROWS locking rather than failing loudly (uninstall got 1 lock instead of 3), and an empty alias array leaves the handler entirely UNSERIALIZED with no warning. The module-load assertion structurally cannot see opts.mutexes or catch an empty array.
4. Informational: export-surface expansion judged justified, not over-exposure — all 5 new exports are referenced by the new tests and NOTHING in src/ consumes any of them, so it adds zero production coupling. Scope clean: src/main/ipc.js (+95/-11) and test/main/ipc-mutex.test.js (+172/-1), no drive-bys, no dependency changes.
<!-- SECTION:NOTES:END -->
