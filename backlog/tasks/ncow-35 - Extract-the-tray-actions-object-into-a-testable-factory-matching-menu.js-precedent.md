---
id: NCOW-35
title: >-
  Extract the tray actions object into a testable factory, matching menu.js
  precedent
status: In Progress
assignee: []
created_date: '2026-08-04 19:30'
updated_date: '2026-08-04 20:57'
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
