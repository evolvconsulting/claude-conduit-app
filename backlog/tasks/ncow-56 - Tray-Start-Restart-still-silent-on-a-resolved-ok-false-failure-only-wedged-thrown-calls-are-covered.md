---
id: NCOW-56
title: >-
  Tray Start/Restart still silent on a resolved {ok:false} failure (only
  wedged/thrown calls are covered)
status: In Progress
assignee: []
created_date: '2026-08-06 18:16'
updated_date: '2026-08-06 23:32'
labels: []
dependencies:
  - NCOW-55
ordinal: 69000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-55 gave the tray a real user-visible error surface for wedged Start/Stop/Restart calls (throws/rejections), using Electron's native Notification API. But the wave-14 integration review found the renderer's own `#start-btn`/`#restart-btn` handlers already toast on a DIFFERENT, more common failure mode: `handlers.proxy.start()` (src/main/engine-context.js) can RESOLVE with `{ok:false, error:{code:'NOT_CONFIGURED'}}` or `{ok:false, error:{code:'HEALTH_CHECK_TIMEOUT'}}` (after a 60s window) rather than throwing — `restart` inherits this since it's `async () => handlers.proxy.start()`. NCOW-55's tray fix only wraps a `.catch()` around the mutex-guarded call, so it fires on a genuine pm2-level rejection (PM2_START_TIMEOUT and similar) but does nothing when the call resolves with `{ok:false}` instead.

Concrete reproducible case: tray.js currently enables Start whenever `status !== 'running'`, with no manifest check (unlike the dashboard's Start button, which is `disabled` when `!manifest`). On a fresh, unconfigured install, clicking tray Start returns `{ok:false, error:{code:'NOT_CONFIGURED'}}` and the user sees nothing at all — no notification, no console.error, no error of any kind. This is the same "invisible to the user" gap NCOW-55 was filed to close, for the failure mode that's actually the more common one in practice.

This task: extend the tray's error surface to also cover a resolved `{ok:false}` result, not just a thrown rejection, for all three actions (Start/Stop/Restart) — using the same Notification mechanism NCOW-55 established. Also decide whether tray Start's enabled/disabled logic should require a manifest, matching the dashboard's #start-btn, or whether showing a clear NOT_CONFIGURED notification on click is a sufficient alternative — document whichever is chosen and why.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A tray Start/Restart/Stop click that resolves {ok:false} (e.g. NOT_CONFIGURED, HEALTH_CHECK_TIMEOUT) surfaces a user-visible notification, using the same mechanism NCOW-55 established for thrown/rejected calls
- [ ] #2 Decide and document whether tray Start's enabled/disabled state should require a manifest (matching the dashboard's #start-btn) or whether a clear on-click notification is the chosen alternative
- [ ] #3 A test demonstrates the {ok:false} surface actually shows a notification for a genuinely {ok:false} resolved call (e.g. NOT_CONFIGURED on an unconfigured install), and fails against current merged source (non-vacuity reproduced and reported)
- [ ] #4 Normal (successful) Start/Stop/Restart tray behavior is unchanged
- [ ] #5 All pre-existing tests continue to pass unmodified and npm test passes
<!-- AC:END -->
