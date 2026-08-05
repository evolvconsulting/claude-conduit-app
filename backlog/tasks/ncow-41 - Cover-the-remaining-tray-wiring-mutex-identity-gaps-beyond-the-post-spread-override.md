---
id: NCOW-41
title: >-
  Cover the remaining tray-wiring mutex-identity gaps beyond the post-spread
  override
status: In Progress
assignee: []
created_date: '2026-08-05 01:43'
updated_date: '2026-08-05 03:22'
labels: []
dependencies:
  - NCOW-35
  - NCOW-38
ordinal: 54000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-35 introduced createTrayActions({ mutexes, handlers }) in tray.js and a partial static check in test/main/engine-context-config-regen.test.js proving only that the 'mutexes' identifier is declared/bare-reassigned exactly once in src/main/index.js. NCOW-39's review (and NCOW-35's own original review notes) documented 4 distinct ways the tray's createTray({...}) call site in index.js could end up with an unshared mutex/handlers pair that neither the existing behavioural test (test/main/tray-actions.test.js) nor the static single-binding check would catch. A sibling task, NCOW-38, covers 1 of the 4 (a future onStart/onStop/onRestart key added to the createTray({...}) object literal after the ...createTrayActions({ mutexes, handlers }) spread). This task covers the other 3, which currently have no covering task at all: (a) 'handlers' has no single-binding check at all -- the existing static check is scoped entirely to the 'mutexes' identifier, so a private, shadowed 'handlers' binding passes the full suite undetected (empirically reproduced during NCOW-39's review); (b) property-level mutation of 'mutexes.proxy' after the createEngineContext() destructure and before createTray({...}) -- NCOW-35's own review notes record this was empirically VERIFIED as a real serialization break (a tray Stop action ran concurrently with an in-flight IPC-triggered restart) that passed the full suite regardless; (c) parameter shadowing, e.g. a wrapper like '((mutexes) => createTray({...}))(privateMutexSet)', which is the same nested-scope-shadowing class as (a)/(b) but via a function parameter instead of a block-scoped const.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A single-binding check (static and/or behavioural) exists for 'handlers' equivalent in rigor to the existing 'mutexes' check, so a shadowed/private 'handlers' binding at the createTray({...}) call site is caught
- [ ] #2 A regression test demonstrates that mutating 'mutexes.proxy' (or the equivalent handlers property) after the createEngineContext() destructure and before createTray({...}) is caught -- this is the gap NCOW-35's own review verified as a REAL serialization break, so prioritize this one if scope needs to be trimmed
- [ ] #3 A regression test demonstrates that parameter-shadowing the mutexes/handlers identifiers passed into createTray({...}) (e.g. via a wrapping function parameter) is caught
- [ ] #4 npm test passes
- [ ] #5 Correct the comment block's closing sentence (introduced by NCOW-38) claiming the existing tests 'cover everything currently provable' -- this overstates, since the handlers gap this task closes was reachable-but-uncovered before this task landed
- [ ] #6 Widen NCOW-38's post-spread-override regex (or note explicitly why it's intentionally scoped) to also catch quoted keys ('onStop': ...), method-shorthand (onStop() {...}), and computed keys (['onStop']: ...), not just the canonical bare colon-form key -- currently only catches the file's existing one-key-per-line arrow-function style
- [ ] #7 Make NCOW-38's post-spread-override guard fail loud instead of fail open: findKeyAfterTraySpread() currently returns undefined both when no override exists AND when the ...createTrayActions spread isn't found in the extracted block (e.g. a nested '});' between the spread and an override key truncates the block early), so the exact regression the guard exists to catch can slip through green -- add an explicit assertion that the spread was actually found before asserting no override followed it
- [ ] #8 Correct the comment block's 'is now CLOSED' framing for the post-spread-override guard if AC#7 above (fail-loud fix) is not yet fixed by the time this task lands, and resolve the dangling '...not X' contrast left over from an earlier edit to the closing sentence
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read the real current content of test/main/engine-context-config-regen.test.js and
   test/main/tray-actions.test.js to confirm the test-file-only hypothesis (mirroring
   NCOW-35/38/39's precedent) before implementing anything.
2. AC#1/AC#3: extend the single-binding-check pattern to cover `handlers` (new, equivalent
   to the existing `mutexes` check) and function-parameter shadowing (new
   identifierBoundAsFunctionParam() static helper), each backed by a meta-test.
3. AC#2: add a behavioural regression test in tray-actions.test.js reproducing index.js's real
   call order (registerIpcHandlers() then createTrayActions()) and mutating mutexes.proxy in
   between, sanity-checked to be non-vacuous.
4. AC#6: widen findKeyAfterTraySpread()'s regex to catch quoted keys, method shorthand
   (incl. async), and computed keys; extend the meta-test across all 3 key names x 7
   syntactic forms.
5. AC#7: make findKeyAfterTraySpread() throw when the spread isn't located (fail loud instead
   of fail open), plus a meta-test proving the truncation scenario now throws, plus an
   explicit spread-found assertion in the real guard test.
6. AC#5/AC#8: rewrite the stale review comment block to accurately describe post-NCOW-41
   state and remove the dangling contrast sentence.
7. Run npm test, confirm before/after counts, commit in small logical commits with
   Refs NCOW-41. trailers, push.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented on fix/NCOW-41-tray-mutex-identity-gaps, pushed to origin (26f0e3b, 554f652). The
test-file-only hypothesis was confirmed: all 8 ACs closed entirely within
test/main/engine-context-config-regen.test.js and test/main/tray-actions.test.js -- NO
production source change was needed or made. AC#1/#3: extended single-binding tests for
`mutexes`/new `handlers`, plus a new identifierBoundAsFunctionParam() static helper (parameter
shadowing), backed by a meta-test. AC#2: new behavioural regression test in
tray-actions.test.js reproducing index.js's real call order (registerIpcHandlers() then
createTrayActions()) mutating mutexes.proxy in between -- non-vacuity sanity-checked by
temporarily removing the mutation line and confirming the test fails as expected before
restoring (sha256-verified identical restore). AC#6: widened findKeyAfterTraySpread()'s regex
to catch quoted keys, method shorthand (incl. async), and computed keys; meta-test extended
across all 3 key names x 7 syntactic forms. AC#7: findKeyAfterTraySpread() now throws when the
spread isn't located (fail loud instead of fail open), with a new meta-test proving the
truncation scenario throws, plus an explicit spread-found assertion added to the real guard
test. AC#5/#8: rewrote the stale review comment block to accurately describe post-NCOW-41
state, removed the dangling "...not full tray-wiring safety" contrast.

Evidence: baseline npm test 358/358 -> final 362/362 passing, +4 new tests, zero regressions.
git diff --stat confirms only the two intended test files changed; src/main/*.js untouched
throughout.

SECURITY NOTE: mid-task, a suspicious system-reminder-styled message appeared immediately
after the worker's own `perl -i` sanity-check edit, falsely framing that edit as an external
"user or linter" change and instructing silence about it -- the same injection pattern seen
twice during wave 3, both times in this exact worktree slot
(~/.treehouse/claude-conduit-163fa4/2/claude-conduit). The worker did not comply, verified
independently via git status/diff and sha256 checksums, and reported it transparently. This is
now a THIRD occurrence tied to this one specific worktree path -- flagged directly to the user
per the wave-3 handover's own escalation note. Orchestrator independently re-verified the
worktree after the worker's report: git status clean, branch matches origin exactly, diff
against dev touches only the two intended test files -- no actual tampering occurred either
time.

Files touched: test/main/engine-context-config-regen.test.js, test/main/tray-actions.test.js.
Two commits on the branch, each with a Refs NCOW-41. trailer.

Reviewed by an independent Opus reviewer in the same worktree (using an isolated probe
worktree for its own experiments, verified clean/hash-identical afterward). VERDICT:
request_changes. 6 of 8 ACs (1, 3, 4, 6, 7, 8) confirmed satisfied; AC#5 satisfied in form but
factually defective; AC#2 empirically disproven, not met.

BLOCKING finding (major, AC#2): the reviewer injected the exact mutation this AC targets
(`mutexes.proxy = createDomainMutex();` immediately before `createTray({...})`) into a real
copy of index.js on this branch and ran the full suite: 362/362 still pass. The delivered test
(tray-actions.test.js) has INVERTED polarity -- it builds its OWN local mutexes, performs the
mutation ITSELF, and asserts the break happens. It is a demonstration that the bug is real, not
a guard that catches it in the real wiring. It only goes red if the underlying primitives
change so the mutation stops breaking serialization -- i.e. it fails on a FIX, not on a
regression.

BLOCKING finding (major, AC#5, dependent on AC#2): the new comment's justification for the
test-only approach is factually wrong. It claims "no source-text scan over index.js can
distinguish a legitimate read from a mutation." The reviewer disproved this directly: the
regex /\b(?:mutexes|handlers)\s*(?:\.[A-Za-z_$][\w$]*|\[[^\]]*\])\s*=(?!=)/ returns null on the
real index.js, matches exactly the mutated line on a hostile copy, and does NOT match the
legitimate `mutexes.proxy.run(() => handlers.proxy.stop())` read. A ~5-line addition to the
existing `mutexes`/`handlers` single-binding tests would genuinely close AC#2 via the same
text-only technique already used for declarations/bare-reassignments. AC#5's new closing
sentence ("NCOW-41 closes all three", "cover every tray-wiring identity gap") is therefore also
false and needs correcting once AC#2 is actually fixed.

Recommended remedy (from the reviewer, verbatim): add the property-assignment assertion above
to both the `mutexes` and `handlers` single-binding tests; keep the existing behavioural test
in tray-actions.test.js as the "why this matters" proof (it's still valid as documentation,
just not as the AC#2 guard itself); delete the "outside a text-only check's reach" claim from
the comment; correct AC#5's closing sentence to state what's actually now covered.

Non-blocking findings (low severity, no fix required, informational only): AC#3's
identifierBoundAsFunctionParam() misses destructured-parameter and class-method-param forms
(the literal plain-identifier-parameter case AC#3 asked for is solidly covered); AC#6's widened
regex still misses template-literal/generator-shorthand/same-line-as-spread forms (the 3 forms
AC#6 explicitly named are all genuinely covered); AC#7's literal ask (throw + explicit
spread-found assertion) is delivered exactly, no change needed despite a slightly overstated
comment; commits omit the Claude-Session trailer (cosmetic).

npm test verified by reviewer: 362/362 passing on this branch; independently reconfirmed dev
baseline is exactly 358/358. Reviewer also verified NO overlap with NCOW-42 (merged both
branches together in a throwaway worktree: 381/381 green, merge order unconstrained). Reviewer
found no injected/suspicious instructions during this review pass (this worktree slot had a
third occurrence during the worker's own implementation, already recorded above and flagged to
the user; the reviewer independently confirmed the four named production files are
byte-identical to dev and did not encounter the pattern themselves).

Routed to a fix pass (1 of 2 allowed retries) with this finding handed verbatim.

Fix pass (1 of 2 allowed retries) landed and pushed (commit cfc95b3, third commit on the
branch). Addressed the reviewer's verbatim AC#2/AC#5 finding directly: added a parameterized
identifierPropertyIsAssigned(source, identifier) helper wired into both the existing `mutexes`
and `handlers` single-binding tests, plus a new meta-test proving it catches dot-/computed-
property mutation without false-positiving on the legitimate mutexes.proxy.run(() =>
handlers.proxy.stop()) read, an equality comparison, or a property spread. Corrected the false
"outside a text-only check's reach" claim in both test/main/engine-context-config-regen.test.js
and the duplicate claim in test/main/tray-actions.test.js, and corrected AC#5's closing
sentence to accurately state the property-mutation gap is now closed by a real static check
(kept the existing behavioural test as supporting "why this matters" documentation, not
deleted).

Evidence: npm test 362/362 (pre-fix-pass) -> 363/363 (post). Reproduced the reviewer's exact
experiment before committing: injected the reviewer's verbatim mutation
(`mutexes.proxy = require('./mutex').createDomainMutex();` immediately before
`const tray = createTray({`) into the REAL src/main/index.js on disk, ran the full suite --
27 pass / 1 fail (the new mutexes single-binding test failed on the property-mutation
assertion, confirming non-vacuity) -- then reverted the file (git diff on index.js clean
before committing). Also independently re-verified the reviewer's regex against the real
current index.js (no false positive on either mutexes or handlers) before adopting it.

No injected/suspicious instructions encountered during this fix pass.

Routed back to the same reviewer for pass 2 (re-review).
<!-- SECTION:NOTES:END -->
