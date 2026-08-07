---
id: CCA-45
title: >-
  Serialize Uninstall against the config and claudeCode mutex domains it also
  touches
status: Done
assignee: []
created_date: '2026-08-05 11:43'
updated_date: '2026-08-05 13:19'
labels: []
dependencies:
  - CCA-32
ordinal: 58000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The wave-5 integration review of CCA-32 found that src/engine/uninstall.js touches three shared-state domains, not just proxy: line 24 removeClaudeCodeSettings() writes the same claudeCode:configure/claudeCode:remove-guarded settings.json (the claudeCode domain, which already has its own mutex), line 28 pm2Control.remove() is the proxy domain CCA-32 already serialized, and line 50 fs.rmSync(configDir, {recursive:true, force:true}) on purge touches the same directory config:generate writes (the config domain, which already has its own mutex). src/main/ipc.js DOMAIN_MUTEX_ALIASES only maps uninstall -> proxy (a single string value), so the claudeCode and config paths remain completely unserialized against uninstall -- Uninstall (with purge) can interleave with an in-flight claudeCode:configure or config:generate the same way it could interleave with a background restart before CCA-32. Not a regression: uninstall had zero locking before CCA-32, which strictly improved the proxy-domain case and was correctly scoped to just that per its own ACs. This is a distinct, previously-unsurveyed gap the merged view made visible. Fixing it requires either changing DOMAIN_MUTEX_ALIASES value type to support multiple aliases per domain (e.g. uninstall -> [proxy, config, claudeCode]) with multi-lock acquisition in resolveDomainLock(), or an equivalent mechanism -- with a deliberate, documented lock-acquisition order to avoid introducing a new deadlock risk for any handler that ends up needing more than one domain lock at once.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Uninstall's config-directory purge (fs.rmSync(configDir) when purge:true) is serialized against the same mutex config:generate uses, so it cannot interleave with an in-flight config regeneration
- [x] #2 Uninstall's removeClaudeCodeSettings() call is serialized against the same mutex claudeCode:configure/claudeCode:remove use, so it cannot interleave with either
- [x] #3 The existing CCA-32 serialization of Uninstall against the proxy mutex (background restart) continues to hold unchanged
- [x] #4 No lock-ordering deadlock is introduced for any handler that must now acquire more than one domain lock -- the acquisition order is deliberate and documented
- [x] #5 A regression test demonstrates Uninstall can no longer interleave with config:generate or claudeCode:configure/claudeCode:remove
- [x] #6 npm test passes
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
green again. AC#3 confirmed two ways: the original CCA-32 tests pass unmodified, plus a new
explicitly-labeled AC#3 test and a combined test proving all three locks (claudeCode, config,
proxy) are held SIMULTANEOUSLY during one uninstall:run, not just one at a time.

Files touched: src/main/ipc.js, test/main/ipc-mutex.test.js only -- no changes needed to
mutex.js, uninstall.js, or index.js/index.test.js (keeping this conflict-free with CCA-43's
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

Branch fix/CCA-45-multi-domain-uninstall-mutex pushed to origin. Two commits: fix(ipc)
widening the alias mechanism; test(ipc) adding the regression coverage.

REVIEW (opus, independent): verdict APPROVE. All 6 ACs independently confirmed with genuine
concurrency stress-testing (treated as the most structurally complex change of the campaign
so far, given proportionally more scrutiny):
- AC#1/#2: traced the primitive-level mechanism in mutex.js (a promise-chain FIFO; queue
  position fixed synchronously at call time) and how withLocks() exploits it (every lock's
  slot claimed in the same tick as dispatch, fn starts only after ALL ready signals resolve,
  every lock stays occupied until the shared result settles). Independently reproduced both
  directions for config and claudeCode (an in-flight config:generate blocks uninstall:run and
  vice versa; same for claudeCode:configure/remove). Confirmed uninstall.js touches exactly
  claudeCode/proxy/config, not claudeDesktop, and verified uninstall never touches the
  claudeDesktop lock.
- AC#3: confirmed the test file has 245 insertions/0 deletions -- every pre-existing CCA-31/
  CCA-32 test is byte-identical and all 15 still pass. Independently reproduced the CCA-32
  scenario and confirmed update still resolves to proxy ALONE (config/claudeCode stay free
  during update:install).
- AC#4: confirmed by independent grep that uninstall is genuinely the only multi-lock
  acquirer in the codebase. Stress-tested with 4 adversarial scenarios: the exact
  last-domain-competitor race the worker's fix pass caught once already (queues correctly);
  the starvation case distinguishing "reserved" from "running" (passes -- no window exists
  between reservation and body-start, this fails on dev and passes on the branch); two
  concurrent uninstalls (strictly sequential, no deadlock); both async-rejecting and
  synchronously-throwing uninstall impls (all locks released, no domain wedged). Found the
  mechanism is actually STRONGER than documented (atomic single-tick reservation makes even
  two opposite-order multi-lock callers safe), which is a safe direction to err in.
- AC#5: reviewer's OWN reproduction (not the worker's claim) -- git checkout dev -- ipc.js,
  kept tests: 17 pass / 5 fail, read the actual diagnostics (not just counts) confirming a
  real interleaving occurred on dev, not a bookkeeping artifact.
- AC#6: reviewer's own npm test run: 394/394 passing.

Scope confirmed: exactly 2 files (ipc.js, ipc-mutex.test.js), zero overlap with CCA-43
(index.js/index.test.js both untouched and confirmed present/unmodified).

Non-blocking findings (none require a branch change): (1) CLAUDE.md's test count is stale
again (388 -> 394) -- deferred to the wave-integration doc pass, same as every prior wave;
(2) engine-context.js:503-504's comment about CCA-32's alias mechanism is now only accurate
for update, not uninstall -- same doc pass; (3) the LOCK_ACQUISITION_ORDER comment's stated
deadlock-safety RATIONALE slightly mis-locates where the guarantee actually comes from (the
real invariant is "declare every domain up front and reserve synchronously via
resolveDomainLocks()/withLocks(), never take a second lock inside an already-held one" --
reviewer proved a hypothetical future nested-acquisition caller following the canonical
ORDER but not this invariant would still deadlock permanently) -- worth one added sentence,
non-blocking since the actual code guidance already points at the safe primitive; (4) a
latent footgun if two DOMAIN_MUTEX_ALIASES entries ever resolved to the same mutex object
(self-deadlock) -- not reachable today, cheap to harden with a dedupe, flagged as a future-edit
hazard only; (5) accepted design consequence: uninstall now holds already-free locks while
waiting on a contended one, bounded and correct tradeoff; (6) pre-existing, out of scope:
configGen.regenerateStaleConfig()'s config-file WRITE (as opposed to its pm2-restart half)
still happens entirely outside the config lock -- AC#1 is satisfied as scoped ("same mutex
config:generate uses"), but this is a second, unserialized config writer worth a future
follow-up task.

No injected-instruction pattern encountered on this worktree (slot 2) -- reviewer explicitly
verified this via independent git checks, not narrative claims.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Widened src/main/ipc.js's DOMAIN_MUTEX_ALIASES.uninstall from a single string ('proxy') to an array (['claudeCode', 'config', 'proxy']), since uninstall.run() genuinely touches all three domains' shared state. Added LOCK_ACQUISITION_ORDER (fixed, alphabetical) and withLocks(), which reserves every needed lock synchronously in the same tick before the handler body runs, so partial-reservation races and lock-ordering deadlocks are structurally impossible -- update and every other single-lock domain stay byte-for-byte on the old code path. Verified by independent opus review with proportionally more scrutiny given the concurrency-primitive complexity: all 6 ACs confirmed via genuine stress-testing (starvation scenarios distinguishing 'reserved' from 'running', two concurrent uninstalls, both async- and sync-throwing fault paths with all locks correctly released, an explicit regression check proving the single-lock path is unchanged via instrumented mutex decorators). npm test 388 -> 394 passing standalone, 400 after rebasing onto CCA-43, then 400 unchanged after the wave-6 doc cleanup pass. Merged as PR #40 (83f4cc67). The wave-6 integration review additionally ran its own behavioral probes (throwing multi-lock handler, two concurrent multi-lock invocations, queue-race fairness) and found the mechanism sound, while surfacing two latent hardening gaps (duplicate-lock self-deadlock, LOCK_ACQUISITION_ORDER/MUTEX_DOMAINS drift) -- filed as a fresh follow-up, CCA-46, per user approval, not folded in here since neither is reachable via the current MUTEX_DOMAINS shape and both are outside this task's own ACs.
<!-- SECTION:FINAL_SUMMARY:END -->
