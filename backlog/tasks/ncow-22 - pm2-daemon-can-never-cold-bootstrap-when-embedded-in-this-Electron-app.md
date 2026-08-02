---
id: NCOW-22
title: pm2 daemon can never cold-bootstrap when embedded in this Electron app
status: In Progress
assignee: []
created_date: '2026-08-02 15:05'
updated_date: '2026-08-02 17:21'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 35000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Discovered during NCOW-10.3's real end-to-end auto-update re-verification (wave 5): when this app's bundled pm2 tries to connect to a pm2 daemon that does not already exist, the connect attempt hangs forever -- window.nimProxy.proxy.getStatus() (and by extension start/stop/restart) never resolves or rejects, reproduced over 90s+ on a real Windows VM. This was never caught before because this development Mac has had a long-running global pm2 daemon since before this campaign started, so every prior live test connected to a pre-existing daemon and never actually exercised a cold bootstrap. It likely affects every platform this app ships on, not just Windows -- macOS/Linux reach of two of the three causes below is inferred from code, not yet independently verified on a genuinely daemon-less machine.

Three stacked defects, all confirmed by direct code trace and/or live reproduction on the real Windows VM (winvm) during NCOW-10.3's review:

1. PRIMARY (Windows-specific, but the actual proximate cause of the observed hang): pm2's own Client.pingDaemon() (node_modules/pm2/lib/Client.js) only ever calls its callback from axon's 'reconnect attempt' or 'connect' events -- it registers no handler for the 'error' event at all. On Windows, pm2 hardcodes its RPC transport to a static named pipe (\\.\pipe\rpc.sock), independent of PM2_HOME (pm2's own source has a @todo acknowledging this). If no daemon is already listening on that pipe, the connection attempt produces neither a 'reconnect attempt' nor a 'connect' event -- pingDaemon's callback simply never fires. This cascades: Client.start() never calls back, pm2.connect() never calls back, this app's own pm2Control.js's ensureConnected() memoizes that never-settling promise, and the entire proxy:* IPC domain is permanently wedged for the rest of the app's lifetime.

2. Real, but secondary (only reachable in principle after fixing #1, since pm2's own launchDaemon() logic is what would normally spawn a missing daemon): pm2's launchDaemon() spawns process.execPath as the daemon's interpreter. In a packaged Electron app, process.execPath IS the Electron binary itself, not a plain Node binary -- verified directly: spawning the real installed Electron binary with pm2's Daemon.js as argv[1] and an IPC channel produces no message/error/exit event at all; the child instead boots as a completely normal second instance of the Electron app, ignoring Daemon.js entirely.

3. Newly found, and it means the "obvious" fix for #2 does not work either: setting ELECTRON_RUN_AS_NODE=1 on that spawn DOES make the child attempt to run Daemon.js as plain Node, but it then crashes in ~200ms with "Cannot find module 'debug'". Root cause: electron-builder.yml's asarUnpack config unpacks pm2 itself (node_modules/pm2/**) so its own files are reachable outside app.asar, but does NOT unpack pm2's hoisted dependency closure -- packages like `debug` that pm2 depends on but that hoist to the top-level node_modules/ (and therefore stay INSIDE app.asar, unreachable to a plain-Node child process trying to require() them from outside the asar).

Important context: this app's shutdown path (src/main/shutdown.js, from NCOW-10.1) already wraps pm2Control.getStatus() in a 15-second timeout and proceeds regardless if it doesn't resolve -- so a quit/update-install sequence still completes even when this bug is present, just without ever actually confirming the proxy stopped cleanly. The bug is real and blocking, but it degrades gracefully rather than hanging the whole app forever. This is also why NCOW-10.3 was able to observe a real end-to-end update install (AC#1/#2) despite this bug blocking full verification of AC#3 (the proxy's real restart behavior).

One candidate remedy -- dropping pm2 in favor of a different process supervisor -- would reopen this project's AGPL-because-of-pm2 licensing decision (see CLAUDE.md's "Hard-won constraints" section and test/main/licenses.test.js). That is a genuine product/licensing decision, not something to be decided inside this task's implementation -- flag it for explicit human sign-off before pursuing that path, if it's considered at all.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A genuinely fresh install (no pre-existing pm2 daemon on the target machine) can successfully start, stop, and restart the litellm-nim proxy through this app's own UI/IPC (not a manual workaround), verified live on at least Windows (the platform where this was discovered)
- [ ] #2 The same cold-bootstrap path is confirmed working (or the platform-specific gap is documented) on macOS and Linux, not just assumed safe by inference from code
- [ ] #3 pm2Control.js's ensureConnected() has a bounded timeout so a wedged connect can never again silently and permanently block every proxy:* IPC call for the rest of the app's lifetime, regardless of whether the underlying pm2 bootstrap issue is also fixed
- [ ] #4 If dropping pm2 for a different process supervisor is considered as part of the fix, that decision is explicitly raised to and confirmed by the user first, given it would reopen this project's AGPL licensing basis
- [ ] #5 Regression tests cover the fix using this project's existing test patterns
- [ ] #6 npm test passes
<!-- AC:END -->
