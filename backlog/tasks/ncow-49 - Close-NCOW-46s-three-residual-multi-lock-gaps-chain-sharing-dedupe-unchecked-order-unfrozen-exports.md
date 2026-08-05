---
id: NCOW-49
title: >-
  Close NCOW-46's three residual multi-lock gaps: chain-sharing dedupe,
  unchecked order, unfrozen exports
status: To Do
assignee: []
created_date: '2026-08-05 15:28'
updated_date: '2026-08-05 17:05'
labels: []
dependencies:
  - NCOW-46
ordinal: 62000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-46's wave-7 integration review confirmed the merged fix is sound but found three residuals it does not cover, each verified by an independent probe against merged src/main/ipc.js rather than by reading the diff. (1) Identity dedupe is narrower than the hazard. resolveDomainLocks() dedupes via seen.has(lock) on FUNCTION IDENTITY (ipc.js:215-222), so it only catches literal same-function reuse. Two DISTINCT functions sharing one underlying FIFO chain still deadlock: with { claudeCode: (fn) => s(fn), config: s, proxy: p } the probe observed resolveDomainLocks() return 3 locks (it saw the wrapper and s as distinct) and uninstall:run never entered its handler after 80 microtask ticks — the exact pre-fix deadlock signature. More contrived than the shape NCOW-46 does handle, but reachable through the same documented opts.mutexes injection point the fix's own docstring (ipc.js:196-206) cites as the reason the hazard is live. (2) LOCK_ACQUISITION_ORDER's actual ORDER is unchecked. assertLockOrderIsConsistent() validates membership only — that the order is a permutation of MUTEX_DOMAINS and that every alias target appears in it. Moving claudeDesktop (the one domain no alias references) to the front of LOCK_ACQUISITION_ORDER left the ENTIRE suite green. A full inversion is caught, but only incidentally by one test's deepEqual at test/main/ipc-mutex.test.js:876-880 — not by the assertion, and not by the AC#3 test at :939-943, which sorts both sides before comparing. So ipc.js:117-121's comment claiming the constant exists 'so a future change cannot accidentally reorder for readability and silently invert it' is delivered by a single test's incidental assertion, not by the guard that comment sits next to. (3) The exported constants are live mutable references. DOMAIN_MUTEX_ALIASES and LOCK_ACQUISITION_ORDER are exported unfrozen (Object.isFrozen false for both) and resolveDomainLocks() reads the module-scope bindings, so a consumer mutating the exported object changes real lock resolution AFTER the module-load assertion has already passed — the reviewer exploited this deliberately in its own probing, so the hazard is demonstrated, not theoretical. Setting DOMAIN_MUTEX_ALIASES.uninstall = ['proxy'] dropped uninstall from 3 locks to 1. No live defect today: nothing in src/ consumes any of these exports, and the merged tests all copy before sorting. Also worth noting for whoever picks this up — the reviewer found several drift shapes the module-load assertion legally accepts and only behavioral tests catch (giving uninstall its own MUTEX_DOMAINS entry, which makes resolveDomainLocks() early-return a single new uncontended lock; a typo'd alias KEY like 'uninstal', since alias keys are never checked against CHANNELS; and an empty alias array). Deciding how much of that the assertion should own is part of this task's judgment, not a settled requirement.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 resolveDomainLocks() no longer returns two locks that share one underlying queue chain, or the limitation is deliberately documented as accepted with the reasoning recorded — an explicit decision either way, not silence
- [ ] #2 If a fix is chosen, a test reproduces the wrapper-function chain-sharing deadlock and demonstrates it is closed, failing against current merged source (non-vacuity reported)
- [ ] #3 LOCK_ACQUISITION_ORDER's actual order is protected by something that fails loudly on reordering, so ipc.js:117-121's stated guarantee is delivered by the guard it describes rather than by an incidental deepEqual in one test
- [ ] #4 A test demonstrates that moving a domain within LOCK_ACQUISITION_ORDER (including a domain no alias currently references, such as claudeDesktop) is caught — this currently leaves the whole suite green
- [ ] #5 DOMAIN_MUTEX_ALIASES and LOCK_ACQUISITION_ORDER can no longer be mutated by a consumer after module load in a way that changes real lock resolution, with a test proving the mutation now fails or is inert
- [ ] #6 An empty alias array and an alias key not present in CHANNELS are each either rejected by assertLockOrderIsConsistent() or explicitly documented as out of its contract, with the choice reasoned rather than left implicit
- [ ] #7 All pre-existing tests in test/main/ipc-mutex.test.js continue to pass unmodified and npm test passes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Corrections from the wave-8 integration review (NCOW-47's merge, 81b5eb9) — recorded by the campaign orchestrator, not yet reflected in the description above:

1. ALL THREE src/main/ipc.js CITATIONS IN THE DESCRIPTION ARE STALE by exactly +49 lines: '215-222' -> 264-271 (seen.has(lock) now at :268); '196-206' -> 245-256 (the NCOW-46 dedupe paragraph now opens at :245); '117-121' -> 161-186, with the quoted 'reorder for readability' phrase now at :165-166. The two test/main/ipc-mutex.test.js citations (876-880, 939-943) are STILL ACCURATE — NCOW-47's test change was a pure append at :1011+, so nothing in the test file moved. Stated explicitly so a fix pass does not shift them unnecessarily.
2. Residual (3) — unfrozen exports — is BROADER than AC#5 describes, in two measured ways:
   (a) A shallow Object.freeze is provably insufficient. The reviewer constructed a shallow-frozen equivalent table and still reversed its nested uninstall array from outside the module. A DEEP freeze is required.
   (b) The exploit surface is no longer just uninstall's array. Deleting DOMAIN_MUTEX_ALIASES.apiKey from outside the module fully reverts NCOW-47's fix at runtime, after the module-load assertion has already passed — and setting it to 'proxy' would silently mis-serialize apiKey against the WRONG lock while still satisfying the assertion if it re-ran, since 'proxy' is a legal member. AC#5 should therefore name the bare-string alias VALUES, not just the array.
3. Counter-nuance, so the fix does not over-scope: in-place REORDERING of uninstall's array is already inert, because resolveDomainLocks sorts by LOCK_ACQUISITION_ORDER. The reviewer reversed that array in place and resolveDomainLocks still returned ['claudeCode','config','proxy']. The freeze's real value is against membership changes, bare-string alias values, and LOCK_ACQUISITION_ORDER itself (which the sort trusts blindly).
4. SUGGESTED ADDITION TO AC#6, which already owns 'which alias shapes should be rejected': an alias target whose mutex is ABSENT from the injected mutexes set. resolveDomainLocks silently drops it (`if (!lock || seen.has(lock)) continue`, ipc.js:266-272). Pre-existing from NCOW-45 but newly worse — pre-NCOW-47 the only victim was uninstall degrading 3->2 or 3->1 locks; now apiKey degrades to ZERO locks, a result indistinguishable from the four intentionally-unlocked domains (app/prereqs/catalog/diagnostics). Measured: resolveDomainLocks({proxy},'apiKey') = 0 locks, ({proxy},'uninstall') = 1 lock not 3, silent in every case with the suite green. So any caller or fixture passing a partial mutex set silently reverts NCOW-47 undetectably. This belongs here rather than in a new task because it is the same opts.mutexes injection point residual (1) already treats as live.
5. Residuals (1) and (2) are UNAFFECTED by NCOW-47's merge. Residual (1) still only bites uninstall, since apiKey resolves to exactly one lock and takes withLocks' single-lock fast path.
6. Also confirmed by the reviewer: the module-load assertion handles NCOW-47's bare-string shape correctly via `Array.isArray(v) ? v : [v]` (ipc.js:225), so the mixed string/array table is not itself a defect — only a reason a shallow freeze is insufficient.
<!-- SECTION:NOTES:END -->
