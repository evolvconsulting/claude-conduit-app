---
id: NCOW-44
title: >-
  Widen NCOW-41's mutexes/handlers property-mutation guard to catch
  Object.assign/defineProperty/destructuring/logical-assignment spellings
status: In Progress
assignee: []
created_date: '2026-08-05 03:59'
updated_date: '2026-08-05 04:59'
labels: []
dependencies:
  - NCOW-41
ordinal: 57000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-41's identifierPropertyIsAssigned() (test/main/engine-context-config-regen.test.js) closes AC#2's canonical serialization-break shape (`mutexes.proxy = ...` / `mutexes['proxy'] = ...`) with a real text-only guard, verified by two independent review passes (one request_changes cycle, then approved) plus a fresh wave-4 integration-review re-probe against the merged src/main/index.js. But the detector is one property-access level deep only: it requires the `=` to appear immediately after the FIRST property access, so it does not catch equivalent serialization breaks spelled as `Object.assign(mutexes, { proxy: createDomainMutex() })`, `Object.defineProperty(mutexes, 'proxy', {...})`, destructuring-assignment (`({ proxy: mutexes.proxy } = ...)`), or logical-assignment (`??=`/`||=`/`&&=`) forms of the same mutation. This was explicitly flagged as non-blocking by NCOW-41's own reviewer on both review passes, and reconfirmed as a real (not yet covered) gap by the wave-4 integration review -- consistent with the rigor AC#6 already demanded of the sibling post-spread-override regex (which was itself widened for exactly this kind of spelling-exhaustiveness in NCOW-41).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The mutexes/handlers property-mutation guard catches Object.assign(mutexes, {...}) and Object.assign(handlers, {...}) forms mutating the .proxy property
- [ ] #2 The guard catches Object.defineProperty(mutexes, 'proxy', {...}) and the equivalent handlers form
- [ ] #3 The guard catches destructuring-assignment mutation of mutexes.proxy/handlers.proxy
- [ ] #4 The guard catches logical-assignment (??=, ||=, &&=) mutation of mutexes.proxy/handlers.proxy
- [ ] #5 The guard continues to NOT false-positive on the real call site's legitimate reads (mutexes.proxy.run(...), equality checks, property spreads) -- re-verify the existing non-vacuity meta-test still passes and extend it to cover the new spellings
- [ ] #6 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read the full test/main/engine-context-config-regen.test.js file (1412 lines) to understand
   identifierPropertyIsAssigned(), its JSDoc history, its two consumers (mutexes/handlers
   single-binding tests), and the existing meta-test -- confirmed the task orientation was
   accurate: this is test-file-only.
2. Widen identifierPropertyIsAssigned() itself (rather than adding separate sibling functions
   callers would need to OR together) to test 5 patterns internally: the original canonical
   dot/bracket shape, logical-assignment (??=/||=/&&=) on the same property-access shape,
   Object.assign(identifier, ...) and Object.defineProperty(identifier, ...) anchored to the
   first-argument (target) position so source-position uses aren't flagged, and
   destructuring-assignment ({ prop: identifier.prop } = ... / [identifier.prop] = ...)
   restricted to a single non-nested brace/bracket group (consistent with this file's
   text-only, no-parser design).
3. Both existing call sites (mutexes/handlers single-binding tests) need zero changes -- they
   inherit the widened behavior automatically.
4. Extend the existing meta-test (AC#5) with true-positive assertions for all 4 new spellings
   on both mutexes and handlers, plus new negative/sanity checks (Object.assign-as-source,
   bare ??/|| reads, unrenamed destructuring reads) to prove no new false positives.
5. Add a second test that splices each of the 4 new spellings onto a real copy of index.js's
   actual source text and proves the widened guard catches all 4 while a verbatim
   reproduction of NCOW-41's original (unwidened) detector misses every one.
6. Run npm test before/after, plus a manual regression check (temporarily swapping the
   widened function back to the old one) to prove the new assertions genuinely fail without
   the fix.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
IMPLEMENTED (worker report). Before: npm test 382/382 passing. After: npm test 383/383
passing (1 new top-level test added; remaining coverage folded into the extended meta-test's
assertions). Non-vacuity self-check: swapped identifierPropertyIsAssigned() back to NCOW-41's
original regex-only body -- exactly 2 tests failed (the extended meta-test and the new
"non-vacuity proof against REAL index.js source" test), confirming the new assertions are
load-bearing, not vacuous. The dedicated non-vacuity test also asserts the real, unmodified
src/main/index.js still passes clean under both the old and new detectors (no new false
positive against the actual protected call site).

Files touched: test/main/engine-context-config-regen.test.js only (test-file-only, as
expected; src/main/index.js was read for verification but never modified).

Judgment calls: (1) the generic detector flags mutation of ANY property of mutexes/handlers
via these 4 new forms, not narrowly restricted to .proxy, matching the existing
canonical-shape detector's own philosophy (superset of the literal ACs, not narrower);
(2) Object.assign/Object.defineProperty detection anchored to the identifier appearing in the
first-argument (mutation-target) position specifically, so Object.assign({}, mutexes)
(mutexes as source) correctly does not false-positive -- verified via an explicit
sanity-check test; (3) destructuring-assignment detection restricted to a single, non-nested
brace/bracket group, consistent with this file's stated text-only design; deeply nested
destructuring is an acknowledged limitation, same tier as prior accepted limitations in this
file.

Follow-up flagged as out of scope (not created as a task yet): CLAUDE.md's "382 tests"
comment is now stale again (383) -- same class of drift NCOW-42's sibling doc-fix (PR #35)
previously corrected.

Branch fix/NCOW-44-widen-mutation-guard-spellings pushed to origin. Two commits: widened
function+JSDoc; test coverage/non-vacuity proof.

REVIEW (opus, independent): verdict APPROVE. All 6 ACs independently confirmed:
- AC#1-#4: traced the actual regex for each new spelling (Object.assign, Object.defineProperty,
  destructuring-assignment, logical-assignment ??=/||=/&&=) against concrete example strings for
  both mutexes and handlers, confirmed each matches the mutation shape and that the OLD
  (unwidened) detector genuinely misses each one. Went further than the worker's own check with
  a per-branch ablation: replacing each of the 4 new regex branches individually with `false`
  each caused exactly 2 failures with the branch-specific message, confirming every new branch
  is individually load-bearing (not just collectively).
- AC#5: independently reproduced non-vacuity (not trusting the worker's claimed "2 tests fail"
  number) via a scratch copy with the old detector body swapped in -- same 2 failures. Traced
  WHY the real index.js source stays clean under the widened detector (destructuring branch
  can't cross a brace, confining it to brace-free windows the real call site doesn't have).
  Confirmed additional negative cases (Object.assign source-position, Object.assign(mutexes.proxy,
  ...)) also don't false-positive.
- AC#6: reviewer's own npm test run: 383/383 passing; isolated file run 25/25 passing.

Scope confirmed: test/main/engine-context-config-regen.test.js only, zero src/ changes, no
.only/.skip introduced.

Non-blocking findings (none require a branch change): (1) "any property, not just .proxy"
judgment call confirmed as the right superset, consistent with NCOW-41's own canonical
detector; (2) three new false-positive shapes found (destructuring default values reading
id.prop, computed-key mutation of a DIFFERENT object) -- none reachable in current index.js,
accepted as loud-failure-not-silent-miss tradeoffs rather than requiring a tighter regex;
(3) a comment/string quoting the anti-pattern could still trip the guard -- pre-existing in
kind (dev's detector already had this), just noting the surface grew slightly; (4) two minor
JSDoc completeness gaps (bracket-property-inside-destructuring not documented as a limitation;
Reflect.set/defineProperty and `delete` remain uncaught and out of AC scope); (5) CLAUDE.md's
test count is stale again -- deferred to the wave-integration doc pass, same as NCOW-32's
review found independently.

Overlap risk: none. Disjoint file set from NCOW-32 (which touches src/main/ipc.js,
engine-context.js, ipc-mutex.test.js only). One semantic coupling flagged for the
orchestrator: this file scans index.js's source text and now enforces a tighter constraint on
it -- if any future task adds Object.assign/defineProperty/destructuring/logical-assignment
mutation of mutexes/handlers directly inside index.js, this guard will correctly fail where
dev's wouldn't have. Reviewer confirmed index.js currently contains none of these shapes.

No injected-instruction pattern encountered on this worktree (slot 3).
<!-- SECTION:NOTES:END -->
