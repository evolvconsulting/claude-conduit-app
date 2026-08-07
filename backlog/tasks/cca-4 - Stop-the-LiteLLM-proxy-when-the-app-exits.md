---
id: CCA-4
title: Stop the LiteLLM proxy when the app exits
status: Done
assignee:
  - '@claude'
created_date: '2026-07-31 20:37'
updated_date: '2026-07-31 21:15'
labels: []
dependencies:
  - CCA-3
priority: high
type: enhancement
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Quitting NIM Proxy Manager should stop the pm2-supervised LiteLLM proxy rather than leaving it running in the background.

IMPORTANT — this reverses an existing deliberate design decision. `CLAUDE.md` and `DESIGN.md` currently state: "The pm2-supervised proxy deliberately outlives the app. Closing the window hides it; quitting leaves the proxy running." The rationale was that Claude Desktop / Claude Code keep working after the manager is closed. Implementing this task means updating DESIGN.md (and CLAUDE.md) so the documented behaviour and the code agree — do not just change the code.

Consider whether this should be unconditional or a user preference (e.g. "Keep proxy running after quit", default off), and make sure Claude Desktop/Code users understand routing will fail once the proxy is stopped.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Quitting the app stops the LiteLLM proxy and its pm2 process cleanly
- [x] #2 No orphaned pm2 daemon or python/litellm process remains after quit (verified with `pm2 list` and a process check)
- [x] #3 Shutdown is graceful — the quit does not hang if the proxy is slow to stop, and there is a bounded timeout with a forced stop fallback
- [x] #4 Quitting while the proxy is already stopped is a no-op and does not error
- [x] #5 DESIGN.md and CLAUDE.md are updated so the documented lifetime of the proxy matches the new behaviour
- [x] #6 Decision recorded on whether this is unconditional or a preference, with the default stated
- [x] #7 Verified end-to-end against a real running proxy, not only unit tests
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Decision to record: make stopping the proxy on quit UNCONDITIONAL, with no preference toggle. That is literally what was asked, and a preference would need a settings surface this app does not have yet (and CCA-7 is about to rework Setup). Discoverability is handled by relabelling the exit affordances instead of by a setting.
2. Hook the shutdown into the before-quit choke point added in CCA-3, in src/main/index.js: preventDefault on the first pass, stop the proxy, then quit for real, guarded by a flag so the re-entrant quit is not intercepted twice.
3. Skip the stop entirely unless getStatus reports running, so quitting with the proxy already stopped or never installed is a genuine no-op rather than a pm2 error.
4. Bound the stop with a timeout and fall through to quitting anyway, so a wedged pm2 can never leave the app unquittable.
5. IMPORTANT constraint found while researching: pm2 here uses the shared default PM2_HOME (~/.pm2), so the pm2 daemon is NOT ours to kill - a pm2 kill would stop unrelated apps the user runs. Stop only the litellm-nim app, and verify the litellm/python child is gone; leave the daemon alone and say so in the notes.
6. Relabel the tray Quit entry, and update its unit test, which currently asserts the opposite behaviour.
7. Update README, CLAUDE.md and the windows.js/pm2Control.js comments that all currently state the proxy deliberately outlives the app.
8. Verify live against a really running proxy: start it, quit the app, then confirm pm2 shows litellm-nim stopped and no litellm process survives. Then repeat the quit with the proxy already stopped to prove the no-op path.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
DECISION (AC 6): unconditional. Quitting always stops the proxy; there is no opt-out preference. A preference would need a settings surface the app does not have, and CCA-7 is about to rework Setup anyway. Discoverability is handled by labelling instead - the tray item now reads "Quit NIM Proxy Manager (stops the proxy)" and the README says plainly that Claude Desktop and Claude Code have nothing to route to once the manager is quit.

Implementation: new src/main/shutdown.js (factory over injected deps, unit-testable without a live daemon) hooked into the single before-quit choke point from CCA-3. before-quit is synchronous and the stop is not, so the first pass preventDefaults, stops the proxy, then re-issues app.quit() behind a latch - drop the latch and it loops forever. The status poller is stopped first so a tick cannot repaint a status that is about to be wrong.

Two constraints discovered while researching, both now documented in CLAUDE.md and DESIGN.md 7.4:
1. The pm2 daemon is NOT ours to kill. pm2 runs against the shared default PM2_HOME (~/.pm2). This machine proved the point: the same daemon supervises an unrelated "spawner" app with 3 days uptime, which a pm2 kill would have taken down. Only the litellm-nim app is stopped.
2. The shutdown timeout is 15s specifically because the generated ecosystem config sets kill_timeout: 10000. pm2 is what escalates SIGINT to SIGKILL if litellm will not exit, so timing out at or below 10s would abandon the stop right before pm2 own forced kill lands. That is also the answer to the forced-stop half of AC 3 - the escalation is pm2, not a second killer racing the daemon that owns the process.

Live verification against a REAL running proxy (real config dir, real NVIDIA key, meta/llama-3.3-70b-instruct + meta/llama-3.1-8b-instruct):
- Started the proxy through the app IPC path: pm2 showed litellm-nim online pid 18884, a litellm python child, and /health/liveliness returned 200.
- Quit via the sidebar button: Electron pids empty, litellm-nim stopped, zero litellm processes, health endpoint 000, log line "[shutdown] proxy stopped".
- Quit via an Apple Event (the dock/menu path): identical result, again from a confirmed-200 starting state.
- Quit with the proxy already stopped: log line "[shutdown] proxy is stopped; nothing to stop", clean exit, no errors in the run log - the no-op path (AC 4).
- The unrelated "spawner" pm2 app stayed online through every run, confirming the daemon was untouched (AC 2). Nothing was orphaned: that daemon predates the app and outlives it by design.
- npm test 121/121 (was 112), including timeout tests proving a wedged pm2 cannot make the app unquittable.
- The machine was left as found: litellm-nim stopped, which is the state it was in before this task.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Quitting now stops the LiteLLM proxy, reversing the original "the proxy outlives the app" design; closing the window still only hides it. New src/main/shutdown.js hangs off the single before-quit handler, skips the stop unless the proxy is actually running (so an already-stopped quit is a real no-op rather than a pm2 error), and bounds it at 15s - above the ecosystem file kill_timeout of 10s, so pm2 own SIGINT-to-SIGKILL escalation is allowed to land - falling through to the quit regardless so a wedged pm2 can never make the app unquittable. The pm2 daemon is deliberately never killed: it is the shared ~/.pm2 one, and on this machine it supervises an unrelated app. Decision recorded as unconditional, no opt-out preference. README, CLAUDE.md, DESIGN.md 7.4, the tray label and the stale windows.js/pm2Control.js comments were all updated to match. Verified end to end against a real running proxy: started it to a 200 health check, quit by two different routes, and confirmed litellm-nim stopped, no litellm process left, health 000, and the unrelated pm2 app still online. npm test 121/121.
<!-- SECTION:FINAL_SUMMARY:END -->
