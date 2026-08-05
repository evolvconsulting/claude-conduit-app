---
id: NCOW-46
title: >-
  Harden the multi-lock resolution in ipc.js against duplicate-lock deadlock and
  order/domain drift
status: In Progress
assignee: []
created_date: '2026-08-05 13:11'
updated_date: '2026-08-05 14:30'
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
