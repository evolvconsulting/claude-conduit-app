---
id: NCOW-55
title: Give the tray a user-visible error surface for wedged Start/Stop/Restart calls
status: To Do
assignee: []
created_date: '2026-08-06 16:27'
labels: []
dependencies:
  - NCOW-53
ordinal: 68000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-53 gave the tray's Stop menu item a diagnostic trail for a wedged pm2 call via `console.error`, per AC#2's literal wording. But the wave-13 integration review found `console.error` is invisible to an end user in a packaged build — stderr goes nowhere nobody reads — so a wedged Stop is now logged but still silent to the actual user, just like before the fix in the respect that matters (the renderer already gets a toast; the tray path does not). The same silent-absorption gap NCOW-53 fixed for tray Stop was never fixed for tray Start/Restart, which were out of NCOW-53's AC scope entirely (its own worker flagged this explicitly as out-of-scope-by-the-letter-of-the-AC when filing).

This task: give the tray a real user-visible error surface for all three actions (Start/Stop/Restart), not just a console log. The renderer's own toast pattern (`src/renderer/components/dom.js`'s `toast()`) is not directly reusable from the main process — decide and document a mechanism appropriate to the tray context (e.g. a native notification via Electron's `Notification` API, or broadcasting an IPC event the renderer's status pill / a toast can pick up even when the Dashboard view isn't mounted).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A wedged tray Stop surfaces a real user-visible error (not just console.error) — e.g. a native OS notification or an IPC-broadcast the renderer can show regardless of which view is mounted
- [ ] #2 A wedged tray Start surfaces the same kind of user-visible error
- [ ] #3 A wedged tray Restart surfaces the same kind of user-visible error
- [ ] #4 A test demonstrates each of the three surfaces above actually shows the error for a genuinely wedged call, and fails against current merged source (non-vacuity reproduced and reported)
- [ ] #5 Normal (non-wedged) Start/Stop/Restart tray behavior is unchanged
- [ ] #6 All pre-existing tests continue to pass unmodified and npm test passes
<!-- AC:END -->
