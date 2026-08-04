---
id: NCOW-35
title: >-
  Extract the tray actions object into a testable factory, matching menu.js
  precedent
status: In Progress
assignee: []
created_date: '2026-08-04 19:30'
updated_date: '2026-08-04 21:28'
labels: []
dependencies:
  - NCOW-31
ordinal: 48000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-31's fix pass wrapped the tray's Start/Stop/Restart callbacks in the shared proxy mutex directly inside index.js'\''s createTray({...}) call, and can only be tested via a static source-check regex (index.js can'\''t be required under plain node --test since it touches electron.app at module scope). Review pass 2 found this static check is meaningful but has a real identity gap: a contrived mutation that shadows the mutex set in a nested scope around createTray({...}) -- giving the tray a private, unshared lock set -- passes all 333 tests on genuinely broken (fully unlocked) code, because the regex only checks that mutexes.proxy.run(...) text appears at the call site, not that it resolves to the SAME lock instance ipc.js and engine-context.js use. This project already has precedent for exactly this kind of extraction: menu.js exports buildMenuTemplate(actions, platform) specifically so its platform-branching logic is testable from macOS without requiring the whole app.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The tray'\''s action callbacks (or an equivalent seam) are extracted into an exported, independently constructible unit that a test can drive directly with a real mutex set, the way ipc-mutex.test.js already fakes electron in require.cache to drive the real ipc.js
- [ ] #2 A behavioral test (not a source-check regex) proves the tray'\''s wiring shares the SAME mutex instance as ipc.js and engine-context.js, catching the nested-scope-shadowing mutation class review pass 2 identified
- [ ] #3 npm test passes, and the existing tray-mutex regression test from NCOW-31 either upgrades to use the new seam or is superseded by it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Study menu.js's buildMenuTemplate(actions, platform) precedent and ipc-mutex.test.js's fake-electron-in-require.cache trick.
2. Extract createTrayActions({ mutexes, handlers }) into src/main/tray.js -- a plain, dependency-injected function returning { onStart, onStop, onRestart }, each closing over mutexes.proxy.run(...).
3. Rewire index.js's createTray({...}) call to spread ...createTrayActions({ mutexes, handlers }) instead of writing the three callbacks inline.
4. Write test/main/tray-actions.test.js: a pure unit test of createTrayActions, a behavioral test proving same-mutex-instance identity against a real registerIpcHandlers() via the fake-electron trick, plus a negative-control test reproducing review pass 2's exact nested-scope-shadowing bug class to prove the test would catch it.
5. Update the existing NCOW-31 tray-mutex regression test to reference the new seam; replace the superseded static-regex check with a narrower one confirming index.js wires createTrayActions in.
6. Run npm test; verify the new test actually fails when the mutex-shadowing mutation is introduced (then revert); commit and push.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Worker implementation complete on branch feat/NCOW-35-tray-actions-factory (commit 53242ea), pushed to origin.

Evidence:
- npm test: 336/336 passed (full suite).
- Mutation-catch verification: worker temporarily mutated createTrayActions to shadow its injected mutexes param with a freshly-created private mutex set (reproducing review pass 2's exact nested-scope-shadowing bug class), ran the new test in isolation, and confirmed it FAILED (tray-stop:enter interleaved into an in-flight IPC restart) -- then reverted (verified via diff against a pre-mutation backup) and reran the full suite clean.
- test/main/tray-actions.test.js: pure unit test of createTrayActions, plus a behavioral test constructing a real createDomainMutexes() set shared between a real registerIpcHandlers() (via the fake-electron require.cache trick) and createTrayActions, proving same-instance identity by serialization behavior (not source-text matching).
- Updated test/main/engine-context-config-regen.test.js: retitled the existing "tray path" test to reference the new seam (kept its own inline mutexes.proxy.run(...) shape to avoid polluting that file's require.cache/electron-free assertion); replaced the old 3-regex static check (the one review pass 2 flagged as having an identity gap) with a narrower static check confirming index.js imports and spreads createTrayActions({ mutexes, handlers }).

Files touched: src/main/tray.js (new createTrayActions export), src/main/index.js (import + call-site wiring only), test/main/tray-actions.test.js (new), test/main/engine-context-config-regen.test.js (updated).

Status: implemented, ready for review.

Review verdict (pass 1): request_changes. AC#1 and AC#3 independently confirmed; AC#2 is NOT confirmed.

AC#1 (confirmed): createTrayActions({ mutexes, handlers }) at src/main/tray.js:127-133 is a plain, dependency-injected, exported function with no electron dependency at module scope in a way that blocks requiring it standalone -- reviewer independently ran `node -e "require('./src/main/tray')"` and drove it directly with injected fakes.

AC#3 (confirmed): npm test 336/336 (reviewer's own run, matches worker's claim). Old 3-regex NCOW-31 static check genuinely removed, superseded by a behavioral test + one narrower static pin. Reviewer confirmed the narrower static check is not vacuous (a mutation removing the mutex spread entirely, replacing with unlocked direct calls, breaks 1/17 tests).

AC#2 (blocking finding, NOT confirmed): Reviewer reproduced review pass 2's EXACT nested-scope-shadowing mutation verbatim -- wrapping index.js's createTray({...}) call in a block scope that shadows `mutexes` with a freshly-created, private createDomainMutexes() set, giving the tray a fully unlocked, unshared lock. Ran npm test against this genuinely broken code: 336 pass / 0 fail. The identity gap the task exists to close did not close -- it moved from a 3-regex check to a 1-regex check, both equally blind to whether the `mutexes` identifier at the call site actually resolves to the shared instance. The new comment claiming this is proven via "the exact mutexes/handlers bindings destructured off createEngineContext()" overstates what the regex can establish.

Reviewer independently confirmed the NEW behavioral test (test/main/tray-actions.test.js) IS genuinely mutex-identity-sensitive when the shadowing happens INSIDE createTrayActions itself (a different mutation: createTrayActions building its own private mutex set internally) -- 2/3 tests failed correctly for that case. The gap is specifically the outer index.js call-site shadow, which the behavioral test cannot see because it never touches index.js's actual source.

Reviewer's recommended minimal in-scope fix (no need to touch engine-context.js): add a static assertion that index.js binds the `mutexes` identifier exactly once -- i.e. the only const/let/var mutexes in the file is the createEngineContext() destructure, with no reassignment anywhere. This is a source property a static check CAN legitimately prove (unlike "does this lock actually serialize," which is exactly why the behavioral test exists for the parts it CAN reach). Combined with the existing behavioral test, this closes the chain honestly. Noted alternative (crosses scope guard, not required): have the composition root return ready-made actions so no second `mutexes` binding exists at the call site at all.

Mitigating context: the identical gap is pre-existing and already explicitly accepted for the ipc.js link (test/main/ipc-mutex.test.js:411-421, documented as "the one link in the chain the behavioural tests above cannot reach") -- NCOW-35 hasn't made anything worse, and the recommended fix would incidentally harden both links.

Nits (non-blocking): replacement regex is order/shorthand-sensitive (fails on `{ handlers, mutexes }` or `{ mutexes: mutexes, handlers }`) -- acceptable brittleness, worth knowing; the "negative control" test in tray-actions.test.js is self-contained/always-passes documentation of test sensitivity, not itself a guard -- PR body shouldn't imply otherwise.

Dispatching a fresh worker fix pass with these findings verbatim (fix-cycle 1 of 2 allowed retries).

Fix pass 1 complete on branch feat/NCOW-35-tray-actions-factory (commit 4840a7a, on top of 53242ea), pushed to origin.

Fix: added a static regex-based check to test/main/engine-context-config-regen.test.js verifying `mutexes` is bound exactly once in src/main/index.js (the single createEngineContext() destructure), with no shadowing re-declaration and no bare reassignment anywhere else in the file. Kept the existing call-site regex (still catches full removal of the mutex wiring). Updated the overstated comment block to describe what the behavioral test + new static check establish TOGETHER, rather than implying either alone proves full identity.

Evidence:
- Worker reproduced the reviewer's exact mutation (block-scoped shadowed mutexes around the createTray call) and confirmed the NEW check fails as expected ("expected exactly one declaration... found 2") while the OLD call-site regex still passed on the broken code -- directly confirming the reviewer's point that the old check alone is blind to this class of bug, and that the new check closes it.
- Reverted the reproduction, confirmed clean diff.
- npm test: 337/337 passed (336 + 1 new).

Only lasting change: test/main/engine-context-config-regen.test.js. index.js was temporarily mutated for verification only and confirmed reverted before commit.

Status: fix pass 1 implemented, ready for review pass 2.

Review verdict (pass 2): approve (with one minor finding). All 3 ACs confirmed in substance.

Finding F1 from pass 1 is CLOSED for the exact mutation it named and for the general declaration/reassignment-rebinding class: reviewer reproduced it, confirmed the new check fails the FULL suite (not just the isolated test file), then tried 5 more variations:
- Caught correctly: a `let` + bare reassignment variant; a renamed-binding variant (mutexes: trayMutexes); a differently-shaped IPC-side shadow (already caught by a pre-existing NCOW-31 test).
- False positive (fails safe): an unrelated LATER helper function in index.js declaring its own unrelated local `mutexes` -- rejected as suspicious even though harmless. Acceptable over-strictness for a small composition-root file.
- NOT caught (residual gap, minor): (B) property-level mutation `mutexes.proxy = require('./mutex').createDomainMutex()` between registerIpcHandlers and createTray -- reviewer empirically verified this is a REAL serialization break (tray Stop ran while an IPC restart was still in-flight) and it passes 337/337; (C) a post-spread key override (`onStop: () => handlers.proxy.stop()` after `...createTrayActions(...)`) silently re-opens NCOW-31's own finding B1 with a green suite -- the most realistic accidental-regression shape of the set; (G) parameter-shadowing (`((mutexes) => createTray({...}))(privateMutexSet)`) is literally the same nested-scope-shadowing class AC#2 names, done via a function parameter instead of a declaration -- also passes 337/337.

Reviewer's judgment for approving anyway rather than a 3rd request_changes cycle: pass 1's OWN prescribed minimal fix ("a source property a static check CAN legitimately prove") was implemented faithfully and correctly for exactly the property it named; a text-only check over a file that can't be required under node --test (electron.app at module scope) cannot do AST/scope resolution without a new parser dependency; and continuing to escalate to newly-invented adversarial variants each round would be an unbounded arms race rather than a convergent review.

Also found: the fix pass's updated comment claims the two checks "close the chain honestly" -- reviewer judges this still overstated given B/C/G above, and suggests softening to state plainly that parameter shadowing and property-level mutation remain outside what a text check can reach. Reviewer changed nothing (comment left as-is).

npm test: 337/337 (reviewer's own independent run, multiple times across mutation/revert cycles). AC#1 and AC#3 spot-checked, no regression (fix pass touched zero source files, only the test file).

Approved for merge. Suggested (not yet created, needs user approval per campaign convention): (1) a follow-up task to guard the tray call site against the post-spread bypass (assert no onStart/onStop/onRestart key appears after the createTrayActions spread) -- the likeliest real accidental regression; (2) soften the "close the chain honestly" comment wording. Will propose both to user before creating/editing.
<!-- SECTION:NOTES:END -->
