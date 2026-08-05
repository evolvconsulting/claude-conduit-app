---
id: NCOW-53
title: Surface pm2 stop/start/log-tail timeout errors on the renderer and tray
status: To Do
assignee: []
created_date: '2026-08-05 22:02'
updated_date: '2026-08-05 22:03'
labels: []
dependencies:
  - NCOW-52
ordinal: 66000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-52 bounded pm2Control.stop()/startOrRestart()/startLogTail() with timeouts (PM2_STOP_TIMEOUT/PM2_START_TIMEOUT/PM2_LOG_TAIL_TIMEOUT), verified correct at the IPC boundary by two independent review passes. But neither review pass followed the result past ipc.js to its actual user-facing surfaces, and the wave-10 integration review found both surfaces silently discard it. src/renderer/views/dashboard-view.js:68-69 does bare `await nimProxy.proxy.stop();` with the result discarded entirely — contrast its immediate neighbours #start-btn (:65-67) and #restart-btn (:71-74), which both do `const r = await ...; if (!r.ok) toast(...)`. The status pill never corrects either, since engine-context.js broadcasts proxy:status-changed only after the throwing await. startLogTailIfNeeded() (dashboard-view.js:99-117) has the same shape: sets logTailStarted=true at :101 BEFORE the await, discards the result at :117, and never resets the flag on failure, so a timeout leaves the log pane silently stuck at seeded content with no error and no retry until the view unmounts. Tray Stop (tray.js:130, `onStop: () => mutexes.proxy.run(() => handlers.proxy.stop())`) has no error surface at all — mutex.js:53 deliberately does `chain = run.catch(() => {})` so the rejection is absorbed with not even an unhandled-rejection log. Net effect: a wedged Stop is now a silently dead button for 15s and then forever, with zero diagnostic trail anywhere in the app — worse in one respect than the pre-NCOW-52 behavior (which froze the whole app, which was at least obvious something was wrong).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A wedged proxy:stop surfaces a visible error to the user on the renderer Stop button, matching the existing pattern used by #start-btn/#restart-btn (result checked, toast or equivalent shown on !ok)
- [ ] #2 A wedged proxy:stop issued via the tray Stop menu item surfaces some diagnostic trail (at minimum a console.warn/error) rather than being silently absorbed by mutex.js catch — decide and document the mechanism
- [ ] #3 A wedged proxy:startLogTail surfaces a visible error on the renderer and resets logTailStarted so a retry is possible, rather than leaving the log pane silently stuck with no error and no way to retry until unmount
- [ ] #4 A test demonstrates each of the three surfaces above actually shows/logs the error for a genuinely wedged call, and fails against current merged source (non-vacuity reproduced and reported)
- [ ] #5 Normal (non-wedged) Stop/Start/Restart/log-tail behavior on all three surfaces is unchanged
- [ ] #6 All pre-existing tests continue to pass unmodified and npm test passes
<!-- AC:END -->
