---
id: NCOW-35
title: >-
  Extract the tray actions object into a testable factory, matching menu.js
  precedent
status: In Progress
assignee: []
created_date: '2026-08-04 19:30'
updated_date: '2026-08-04 21:11'
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
<!-- SECTION:NOTES:END -->
