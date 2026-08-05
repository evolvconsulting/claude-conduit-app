---
id: NCOW-45
title: >-
  Serialize Uninstall against the config and claudeCode mutex domains it also
  touches
status: In Progress
assignee: []
created_date: '2026-08-05 11:43'
updated_date: '2026-08-05 12:27'
labels: []
dependencies:
  - NCOW-32
ordinal: 58000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The wave-5 integration review of NCOW-32 found that src/engine/uninstall.js touches three shared-state domains, not just proxy: line 24 removeClaudeCodeSettings() writes the same claudeCode:configure/claudeCode:remove-guarded settings.json (the claudeCode domain, which already has its own mutex), line 28 pm2Control.remove() is the proxy domain NCOW-32 already serialized, and line 50 fs.rmSync(configDir, {recursive:true, force:true}) on purge touches the same directory config:generate writes (the config domain, which already has its own mutex). src/main/ipc.js DOMAIN_MUTEX_ALIASES only maps uninstall -> proxy (a single string value), so the claudeCode and config paths remain completely unserialized against uninstall -- Uninstall (with purge) can interleave with an in-flight claudeCode:configure or config:generate the same way it could interleave with a background restart before NCOW-32. Not a regression: uninstall had zero locking before NCOW-32, which strictly improved the proxy-domain case and was correctly scoped to just that per its own ACs. This is a distinct, previously-unsurveyed gap the merged view made visible. Fixing it requires either changing DOMAIN_MUTEX_ALIASES value type to support multiple aliases per domain (e.g. uninstall -> [proxy, config, claudeCode]) with multi-lock acquisition in resolveDomainLock(), or an equivalent mechanism -- with a deliberate, documented lock-acquisition order to avoid introducing a new deadlock risk for any handler that ends up needing more than one domain lock at once.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Uninstall's config-directory purge (fs.rmSync(configDir) when purge:true) is serialized against the same mutex config:generate uses, so it cannot interleave with an in-flight config regeneration
- [ ] #2 Uninstall's removeClaudeCodeSettings() call is serialized against the same mutex claudeCode:configure/claudeCode:remove use, so it cannot interleave with either
- [ ] #3 The existing NCOW-32 serialization of Uninstall against the proxy mutex (background restart) continues to hold unchanged
- [ ] #4 No lock-ordering deadlock is introduced for any handler that must now acquire more than one domain lock -- the acquisition order is deliberate and documented
- [ ] #5 A regression test demonstrates Uninstall can no longer interleave with config:generate or claudeCode:configure/claudeCode:remove
- [ ] #6 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Widen DOMAIN_MUTEX_ALIASES.uninstall in src/main/ipc.js from the single string 'proxy' to
   the array ['claudeCode', 'config', 'proxy']. update stays 'proxy' alone (untouched).
2. Add LOCK_ACQUISITION_ORDER = ['claudeCode', 'claudeDesktop', 'config', 'proxy'] --
   alphabetical by domain name -- and replace resolveDomainLock() with resolveDomainLocks(),
   which normalizes a domain's alias (string or array) and sorts it into this fixed order
   before mapping to actual mutex objects.
3. Add withLocks(locks, fn): for a single lock it degrades to plain lock(fn) (byte-for-byte the
   old behavior, needed because a barrier adds microtask hops that broke an unrelated
   timing-sensitive test in tray-actions.test.js). For multiple locks, it reserves a slot on
   every lock synchronously, in the same tick, in canonical order before returning, using a
   shared barrier promise so all locks stay held until the handler body fully settles. The
   synchronous eager reservation was necessary -- an initial nested-acquisition version let a
   single-lock competitor for the LAST domain in the list win a queue race against uninstall
   even when uninstall was invoked first (caught by a regression test, not by inspection).
4. Deadlock-safety (AC#4): documented directly in the LOCK_ACQUISITION_ORDER comment block -- a
   lock-ordering deadlock needs two multi-lock callers acquiring in opposite relative order;
   uninstall is currently the only multi-lock caller anywhere in the codebase (confirmed by
   grep), so no cycle is possible regardless of the order chosen. The fixed order exists so a
   future second multi-lock caller has a convention to inherit.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
IMPLEMENTED (worker report). Baseline before fix: npm test 388/388 passing. After fix: npm
test 394/394 passing (6 new tests). Non-vacuity: git stash push -- src/main/ipc.js (reverting
only the production fix, keeping new tests), reran test/main/ipc-mutex.test.js -- exactly 5 of
the 6 new tests failed, reproducing the literal interleaving the fix prevents (e.g.
['bg-configure:enter', 'uninstall:enter'] with no queuing, in both directions for config and
claudeCode). The 1 new test exercising only the pre-existing proxy lock (AC#3) still passed,
confirming that path was never broken. Restored the fix and reran the full suite: 394/394
green again. AC#3 confirmed two ways: the original NCOW-32 tests pass unmodified, plus a new
explicitly-labeled AC#3 test and a combined test proving all three locks (claudeCode, config,
proxy) are held SIMULTANEOUSLY during one uninstall:run, not just one at a time.

Files touched: src/main/ipc.js, test/main/ipc-mutex.test.js only -- no changes needed to
mutex.js, uninstall.js, or index.js/index.test.js (keeping this conflict-free with NCOW-43's
parallel work).

Judgment calls: (1) chose alphabetical order for LOCK_ACQUISITION_ORDER -- arbitrary but fixed
and easy to re-derive without reading the source; (2) special-cased the single-lock path in
withLocks back to plain lock(fn) after discovering the barrier approach's extra microtask hops
broke tray-actions.test.js's unrelated mutex-identity regression test -- keeps every domain
except uninstall byte-for-byte unchanged.

Follow-up flagged (not created as a task): if a second multi-lock handler is ever added
elsewhere in this codebase, it must sort its domains through LOCK_ACQUISITION_ORDER (or reuse
resolveDomainLocks) rather than inventing its own order -- documented in the code comment.

Security: worker explicitly confirmed it did not encounter anything resembling the
injected-instruction/fake-system-reminder pattern flagged for this treehouse slot (slot 2) in
prior waves. All tool outputs were plain, expected output.

Branch fix/NCOW-45-multi-domain-uninstall-mutex pushed to origin. Two commits: fix(ipc)
widening the alias mechanism; test(ipc) adding the regression coverage.
<!-- SECTION:NOTES:END -->
