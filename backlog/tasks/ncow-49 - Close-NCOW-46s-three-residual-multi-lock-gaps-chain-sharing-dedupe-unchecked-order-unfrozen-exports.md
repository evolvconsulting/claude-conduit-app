---
id: NCOW-49
title: >-
  Close NCOW-46's three residual multi-lock gaps: chain-sharing dedupe,
  unchecked order, unfrozen exports
status: To Do
assignee: []
created_date: '2026-08-05 15:28'
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
