---
id: CCA-22
title: pm2 daemon can never cold-bootstrap when embedded in this Electron app
status: Done
assignee: []
created_date: '2026-08-02 15:05'
updated_date: '2026-08-02 19:06'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 35000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Discovered during CCA-10.3's real end-to-end auto-update re-verification (wave 5): when this app's bundled pm2 tries to connect to a pm2 daemon that does not already exist, the connect attempt hangs forever -- window.nimProxy.proxy.getStatus() (and by extension start/stop/restart) never resolves or rejects, reproduced over 90s+ on a real Windows VM. This was never caught before because this development Mac has had a long-running global pm2 daemon since before this campaign started, so every prior live test connected to a pre-existing daemon and never actually exercised a cold bootstrap. It likely affects every platform this app ships on, not just Windows -- macOS/Linux reach of two of the three causes below is inferred from code, not yet independently verified on a genuinely daemon-less machine.

Three stacked defects, all confirmed by direct code trace and/or live reproduction on the real Windows VM (winvm) during CCA-10.3's review:

1. PRIMARY (Windows-specific, but the actual proximate cause of the observed hang): pm2's own Client.pingDaemon() (node_modules/pm2/lib/Client.js) only ever calls its callback from axon's 'reconnect attempt' or 'connect' events -- it registers no handler for the 'error' event at all. On Windows, pm2 hardcodes its RPC transport to a static named pipe (\\.\pipe\rpc.sock), independent of PM2_HOME (pm2's own source has a @todo acknowledging this). If no daemon is already listening on that pipe, the connection attempt produces neither a 'reconnect attempt' nor a 'connect' event -- pingDaemon's callback simply never fires. This cascades: Client.start() never calls back, pm2.connect() never calls back, this app's own pm2Control.js's ensureConnected() memoizes that never-settling promise, and the entire proxy:* IPC domain is permanently wedged for the rest of the app's lifetime.

2. Real, but secondary (only reachable in principle after fixing #1, since pm2's own launchDaemon() logic is what would normally spawn a missing daemon): pm2's launchDaemon() spawns process.execPath as the daemon's interpreter. In a packaged Electron app, process.execPath IS the Electron binary itself, not a plain Node binary -- verified directly: spawning the real installed Electron binary with pm2's Daemon.js as argv[1] and an IPC channel produces no message/error/exit event at all; the child instead boots as a completely normal second instance of the Electron app, ignoring Daemon.js entirely.

3. Newly found, and it means the "obvious" fix for #2 does not work either: setting ELECTRON_RUN_AS_NODE=1 on that spawn DOES make the child attempt to run Daemon.js as plain Node, but it then crashes in ~200ms with "Cannot find module 'debug'". Root cause: electron-builder.yml's asarUnpack config unpacks pm2 itself (node_modules/pm2/**) so its own files are reachable outside app.asar, but does NOT unpack pm2's hoisted dependency closure -- packages like `debug` that pm2 depends on but that hoist to the top-level node_modules/ (and therefore stay INSIDE app.asar, unreachable to a plain-Node child process trying to require() them from outside the asar).

Important context: this app's shutdown path (src/main/shutdown.js, from CCA-10.1) already wraps pm2Control.getStatus() in a 15-second timeout and proceeds regardless if it doesn't resolve -- so a quit/update-install sequence still completes even when this bug is present, just without ever actually confirming the proxy stopped cleanly. The bug is real and blocking, but it degrades gracefully rather than hanging the whole app forever. This is also why CCA-10.3 was able to observe a real end-to-end update install (AC#1/#2) despite this bug blocking full verification of AC#3 (the proxy's real restart behavior).

One candidate remedy -- dropping pm2 in favor of a different process supervisor -- would reopen this project's AGPL-because-of-pm2 licensing decision (see CLAUDE.md's "Hard-won constraints" section and test/main/licenses.test.js). That is a genuine product/licensing decision, not something to be decided inside this task's implementation -- flag it for explicit human sign-off before pursuing that path, if it's considered at all.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A genuinely fresh install (no pre-existing pm2 daemon on the target machine) can successfully start, stop, and restart the litellm-nim proxy through this app's own UI/IPC (not a manual workaround), verified live on at least Windows (the platform where this was discovered)
- [x] #2 The same cold-bootstrap path is confirmed working (or the platform-specific gap is documented) on macOS and Linux, not just assumed safe by inference from code
- [x] #3 pm2Control.js's ensureConnected() has a bounded timeout so a wedged connect can never again silently and permanently block every proxy:* IPC call for the rest of the app's lifetime, regardless of whether the underlying pm2 bootstrap issue is also fixed
- [ ] #4 If dropping pm2 for a different process supervisor is considered as part of the fix, that decision is explicitly raised to and confirmed by the user first, given it would reopen this project's AGPL licensing basis
- [x] #5 Regression tests cover the fix using this project's existing test patterns
- [x] #6 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Independently re-confirm all three stacked causes against node_modules/pm2 v7.0.3 rather than trusting the task description: Client.js pingDaemon() registers an 'error' handler but on a generic (non-EACCES) connect failure only console.error()s without ever calling cb(); paths.js unconditionally hardcodes DAEMON_RPC_PORT to \\.\pipe\rpc.sock on win32 AFTER the PM2_HOME-derived value is set (pm2's own @todo acknowledges this); launchDaemon() spawns process.execPath (the Electron binary here); pm2's 'debug' dep is hoisted to top-level node_modules/debug, so asarUnpack of node_modules/pm2/** alone leaves it unreachable.
2. Do NOT patch pm2 and do NOT rely on pm2's connect-time auto-launch at all — on macOS/Linux that path risks silently spawning a second Electron GUI instance rather than merely hanging.
3. In pm2Control.js ensureConnected(): raw net.connect liveness probe against the resolved rpc socket/pipe path BEFORE calling pm2.connect(). If nothing is listening, spawn pm2's own unmodified lib/Daemon.js directly with ELECTRON_RUN_AS_NODE + explicit PM2_HOME, wait for its ready IPC message, then call pm2.connect() — which then always takes pingDaemon()'s working 'connect' path because a real daemon is already listening.
4. Wrap the whole ensureConnected() flow in one bounded timeout (default 30s) that CLEARS the memoized promise on failure/timeout, so a wedged attempt can never permanently poison later calls — independent of whether the bootstrap fix engages (AC#3 stands on its own).
5. Wire probeDaemonAlive/spawnDaemon as OPTIONAL injected deps (engine-context.js the only real caller) so pre-existing tests keep exercising the old simple direct-connect fallback, still bounded.
6. Broaden electron-builder.yml asarUnpack from node_modules/pm2/** to node_modules/** to fix cause #3 in packaged builds without hand-enumerating pm2's transitive closure.
7. Verify live on all three platforms against genuinely daemon-less environments; add regression tests; npm test.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Wave 6 worker implementation evidence (pre-review, worker self-reported — reviewer to independently re-verify)

Branch fix/CCA-22-pm2-cold-bootstrap, commits 3e46a2f (core fix + tests) and 043d7dd (asarUnpack), pushed. Files: src/engine/pm2Control.js, src/main/engine-context.js, electron-builder.yml, test/engine/pm2Control.test.js (+399/-8).

**AC#1 Windows (winvm) — claimed PROVEN live.** Confirmed zero pm2/node/electron processes on the VM beforehand (genuinely daemon-less). Fresh source tree + npm install on the VM (real win32 electron/pm2 binaries). node --test test/engine/pm2Control.test.js there: 12 pass / 1 correctly skipped (win32's fixed shared named pipe makes the isolated true-case test self-skip), including a real spawnDaemon() test that launched a real pm2 daemon in 669ms. App launched --dev --remote-debugging-port=9333, port tunnelled back, driven over CDP against wave 5's real existing manifest/ecosystem config. Observed: status BEFORE start 'not-installed' (genuinely cold) -> start() 13013ms -> {ok:true} -> running pid 6116 -> stop -> stopped -> restart() 11010ms -> running with NEW pid -> final stop -> stopped. Exact platform and exact symptom of the original bug (90s+ never-resolving hang) now completing in 13s.

**AC#2 macOS (local dev Mac) — claimed PROVEN live.** Throwaway PM2_HOME (/tmp/ncow22-pm2home) so the Mac's real long-running shared daemon was never touched; confirmed no rpc.sock/pub.sock present beforehand. manifest+config written directly via configGen/manifest engine modules, real NVIDIA key from .env, real litellm 1.94.1 on PATH. Observed: start() 2174ms -> ok; PM2_HOME then contains dump.pm2/pm2.pid/pub.sock/rpc.sock -> running with real pid -> stop -> stopped -> restart -> running new pid -> final stop. Cleanup by SIGTERM to the 2 throwaway daemon PIDs it created — explicitly NOT pm2 kill.

**AC#2 Linux (linuxvm, Ubuntu 26.04 aarch64) — claimed PROVEN live.** No pm2/node/electron running beforehand; ~/.pm2 had only stale sockets, nothing listening. Installed Node 22, Xvfb, python3-pip/venv and a REAL litellm 1.94.1 via pip venv (all wheels available on aarch64 — nothing faked). Fresh npm install, launched under Xvfb with --no-sandbox + --remote-debugging-port, driven over a tunnel via CDP. Observed: status BEFORE 'not-installed' -> start() 4186ms -> running real pid -> stop -> stopped -> restart -> running new pid -> final stop. No Linux platform gap to document — verified, not inferred. Note: the CI-published Linux AppImage is x86_64 and cannot run on any of this user's aarch64 Linux hosts, so this was a from-source run, not a packaged-artifact run.

**AC#3 — claimed proven** via unit test (a fake pm2.connect() that never calls back rejects within the configured timeout; a subsequent call gets a genuinely fresh attempt rather than replaying the rejected promise) plus implicitly in every live run.

**AC#4 — not applicable.** Dropping pm2 was never considered; nothing raised for AGPL sign-off.

**AC#5 — 8 new tests** in test/engine/pm2Control.test.js: bounded-timeout/non-poisoning, probe-then-bootstrap ordering, probe-rejection treated as not-alive, plus 3 against the real non-mocked probeDaemonAlive/spawnDaemon (a real Unix-socket listener, and an actually-spawned-then-torn-down real pm2 daemon under a throwaway PM2_HOME).

**AC#6 — npm test 243/243 passing** on macOS (baseline 235/235 confirmed before the change). Worker explicitly flagged a gap: the FULL suite was NOT run on Windows (only the pm2Control.test.js subset) and was NOT run at all on Linux.

### Worker-declared limitations and out-of-scope findings

- Live verification deliberately bypassed the renderer's apiKey.validateAndSave/config.generate wizard steps, writing manifest+config directly via the engine modules instead (Windows reused wave 5's existing real config read-only). Reason: safeStorage triggers a macOS Keychain prompt that blocks forever with nothing to click — pre-existing and orthogonal to CCA-22. So the cold-bootstrap path itself is thoroughly exercised, but the full wizard-driven UI flow was not exercised end-to-end on any platform.
- **NEW BUG NOTICED, NOT FIXED (out of scope, worth filing):** paths.js's resolveConfigDir ignores the homedir override on win32 — it always resolves to the real %APPDATA%, so NIM_PROXY_TEST_HOME does NOT protect the config dir on Windows the way it protects the Electron userData dir. This is a real safety gap in this project's documented safe-manual-testing mechanism. The worker worked around it by never calling config.generate on Windows and modified no real persistent state there.
- Cleanup: winvm's real v0.1.1 install/litellm/Python left untouched (manifest.json re-checked byte-identical afterward); test checkouts/fake-homes/tarballs removed from both VMs; linuxvm keeps Node/npm/Xvfb/pip/litellm-venv as reusable infra.

## Wave 6 opus review pass 1 — verdict: request_changes

Reviewer independently re-verified rather than trusting the worker, and closed coverage holes the worker left open. Confirmed AC [1,2,3,5,6]; AC#4 judged not-applicable (pm2 never dropped; package.json/package-lock/licenses test untouched). npm test observed by the reviewer itself on all three platforms: macOS 243/243, Windows 243 (242 pass + 1 intentional win32 self-skip), Linux aarch64 243/243 — closing the worker's declared cross-platform test gap.

**Packaged-build path: nobody had tested it; the reviewer did.** Every worker run was from source or reused the old-code v0.1.1 install, so cause #3's territory was genuinely unverified. Reviewer ran npm run pack and launched the real macOS artifact with throwaway PM2_HOME + NIM_PROXY_TEST_HOME: a real daemon appeared under the throwaway home, sockets/pid/module_conf created, getStatus resolved over CDP, lsof confirmed the daemon running the packaged Electron Framework binary.

**Cause #3 does not reproduce against the code as written.** Repacking with the ORIGINAL narrow `**/node_modules/pm2/**` (482 unpacked files) also cold-bootstrapped successfully. Reason: inside the packaged app `require.resolve('pm2/package.json')` returns the app.asar path, not .unpacked, and `debug` resolves to app.asar/node_modules/debug — Electron's asar fs shim is active in ELECTRON_RUN_AS_NODE children, so the spawned Daemon.js never walks the unpacked tree at all. The original 'Cannot find module debug' was almost certainly a hand-run experiment pointed at the app.asar.unpacked copy of Daemon.js, which the shipped code does not do.

**Windows AC#1 independently re-derived**: fresh clone of 043d7dd + npm install on winvm, verified genuinely daemon-less first (no pm2/node/electron processes; GetFiles('\\.\pipe\') showed no rpc.sock/pub.sock). Via scheduled task + CDP: not-installed -> start 13212ms {ok:true} running pid 3664 -> stop 589ms -> stopped -> restart 13243ms -> running pid 7100 (new) -> stop -> stopped. Win32_Process showed the bootstrapped daemon as electron.exe ...pm2\lib\Daemon.js.
**Linux AC#2 partial**: daemon bootstrap + full suite confirmed on linuxvm, but the reviewer could not personally observe a litellm start/stop/restart cycle — the VM rebooted twice mid-run (also during a plain npm test, so VM-level instability unrelated to this diff). Residual risk low given Windows and macOS are fully confirmed. Reviewer separately proved the stale-socket case on macOS (SIGKILLed listener leaving real socket files): probe->false, spawnDaemon OK in 57ms — axon unlinks stale sockets, so linuxvm's leftover ~/.pm2/*.sock is a non-issue.

### BLOCKING findings

**1. src/engine/pm2Control.js:117-168 — spawnDaemon() never kills the child it spawned when it rejects, leaking one live pm2 daemon per retry.** The timeout path (:133), onError (:147) and the shared finish() helper remove listeners and reject, but the already-spawned detached/unref'd child keeps running. Because AC#3's memo-clearing makes every subsequent proxy:* call retry, and status-poller.js:7 ticks every 5000ms, a persistent bootstrap failure spawns a fresh orphan roughly every 15-30s indefinitely. REPRODUCED LIVE: with a non-socket rpc.sock at the resolved path, 3 sequential spawnDaemon calls -> 3 rejections -> ps showed 3 simultaneously-live God Daemon orphans (pids 74979/75276/75563). Each is an Electron-weight process — unbounded, compounding leak. Fix: on every reject path (timeout, onError, defensively after onExit) do a best-effort try { child.kill(); } catch {} before rejecting; do NOT kill on the success (message) path.

**2. electron-builder.yml:31-50 — the asarUnpack broadening is not load-bearing and its 20-line rationale comment is factually wrong.** The comment's central claim ('the two trees are disjoint — plain module-resolution directory-walking from the unpacked tree can never reach back into the archive') does not describe what this code does. Fix: either revert to `**/node_modules/pm2/**`, or keep the broad pattern and rewrite the comment to state the honest reason (defence-in-depth against depending on Electron's asar shim in ELECTRON_RUN_AS_NODE children) rather than asserting a failure mode that does not reproduce.

Cost data for the broad pattern, if kept: 2732 unpacked files / 19MB loose vs 482 narrow; app.asar shrinks to 1.3MB. **Secret-safety verified empirically**: asarUnpack only relocates files the `files` allowlist already admitted, it cannot add any; `asar list` on the built archive showed top-level /node_modules, /package.json, /src and ZERO .env matches across 3097 entries. CLAUDE.md's allowlist guarantee is intact.

### NON-BLOCKING findings

3. **New long-lived residue**: the bootstrapped daemon runs the app's own binary and outlives the app forever — verified on macOS packaged (after quit it reparented to pid 1, lsof still showed it holding the packaged Electron Framework) and on Windows (electron.exe ...pm2\lib\Daemon.js). Consequences worth a follow-up task: (a) CCA-4's 'quitting stops the proxy' no longer implies no app-sized process is left running — one persists indefinitely, including after uninstall; (b) on Windows a running image is locked, so this plausibly interferes with CCA-10 auto-update / NSIS uninstall needing to replace Claude Conduit.exe (the installer would have to kill it, silently orphaning litellm on port 4000). Untested.
4. **test/engine/pm2Control.test.js:217** — the real-spawnDaemon test is environment-dependent on win32: a throwaway PM2_HOME isolates files but not the transport (resolveRpcSocketPath returns the global \\.\pipe\rpc.sock), so the opening probeDaemonAlive===false assert fails on any Windows machine that has a live pm2 daemon. Passed on winvm only because winvm was daemon-less. The sibling test at :196 already skips for this reason; this one should too.
5. **src/engine/pm2Control.js:122-128** — two divergences from pm2's own launchDaemon: stdio discards the daemon's stdout/stderr where pm2 appends both to PM2_HOME/pm2.log (that log is the only diagnostic when a bootstrap fails, and would have made finding #1 self-evident); and no cwd is set, so the detached daemon inherits the app's cwd and pins that directory handle on Windows.
6. NIT **src/engine/pm2Control.js:27** — resolveRpcSocketPath ignores pm2's PM2_DAEMON_RPC_PORT override (pm2/paths.js:71-78 applies PM2_<KEY> overrides to every path key except PM2_HOME/PM2_ROOT_PATH). If set, the probe watches the wrong path forever. One-line guard.

### Checked and explicitly clean
probe->spawn->connect races (single-instance lock at index.js:46 + synchronous memo assignment rule out in-process double-spawn; a daemon appearing mid-window only makes the spawn fail loudly and retriably; listen() will not steal a live unix socket); ELECTRON_RUN_AS_NODE scoping (copied into a fresh env object for that one spawn — it does reach the daemon's grandchildren, but that is required for pm2 to run run.js under Electron-as-node, and the Windows start/restart proved it works end to end); win32 named pipe genuinely handled rather than accidentally working (mirrors pm2/paths.js:80-85); a pre-existing different-version daemon behaves as before; no pm2 kill anywhere and the enforcing test still passes; failed/timed-out attempts provably cannot poison later calls. No scope creep — 4 expected files, no drive-bys, no dependency/license changes.

### Confirmed independently: the win32 NIM_PROXY_TEST_HOME hole is REAL
src/main/engine-context.js:53 calls paths.resolveConfigDir({ homedir }) passing only homedir; src/engine/paths.js:41 resolves opts.appData ?? process.env.APPDATA ?? path.join(homedir, ...) — and APPDATA is always set on Windows, so the injected homedir is never reached. Corroborated live: a --dev + NIM_PROXY_TEST_HOME run on winvm read the real %APPDATA%\claude-conduit. Genuine hole in the documented safe-manual-testing mechanism; deserves its own task. Reviewer respected it (never called config.generate on Windows; re-hashed all five real config files before/after — all SHA-256s byte-identical, only logs/ grew).

## Wave 6 fix pass 1 (commit 2d635a6) — addresses both blocking findings

**Blocking #1 (daemon leak) fixed** — src/engine/pm2Control.js:149-163: best-effort try { child.kill(); } catch {} added inside spawnDaemon()'s finish() helper, guarded by `if (fn === reject)`, so every reject path (timeout, onError, onExit) kills the already-spawned child before rejecting; the success (onMessage) path is untouched. Regression test at test/engine/pm2Control.test.js:271-300 reproduces the reviewer's exact scenario (non-socket file at rpc.sock, 3 sequential rejecting spawnDaemon() calls) and asserts zero leaked children via ps.
Before/after repro observed: a throwaway copy of the PRE-fix spawnDaemon left 3 live 'PM2 v7.0.3: God Daemon' orphans after 3 calls (matching the reviewer's repro exactly); the fixed version left zero. Useful gotcha recorded by the fixer: the daemon renames its own process title to `PM2 vX: God Daemon (<PM2_HOME>)`, so filtering ps on the literal string 'Daemon.js' gives a FALSE NEGATIVE — the committed test filters on 'God Daemon'.

**Blocking #2 (asarUnpack) fixed** — electron-builder.yml reverted to the narrow `**/node_modules/pm2/**` with the original pre-broadening comment restored verbatim. Additionally corrected spawnDaemon()'s own doc comment (src/engine/pm2Control.js:107-114), which had repeated the same now-disproved 'disjoint trees' claim; it now states the real reason (Electron's asar fs shim stays active in ELECTRON_RUN_AS_NODE children, so hoisted deps resolve straight out of app.asar; only pm2's own executable script needs unpacking).
Verified: `npm run pack` succeeded with the narrow pattern and app.asar.unpacked contains exactly 482 files, matching the reviewer's figure. Packaged cold-bootstrap re-confirmed by launching the real packaged Claude Conduit.app binary with ELECTRON_RUN_AS_NODE=1, requiring pm2Control.js straight out of app.asar, and calling spawnDaemon() against a fresh throwaway PM2_HOME: probe before false -> spawnDaemon resolved with pid -> probe after true -> cleanly SIGTERMed. This exercises exactly the require.resolve('pm2/package.json') + ELECTRON_RUN_AS_NODE spawn path the revert depends on.

**Non-blocking #4 fixed** — test/engine/pm2Control.test.js:218-228 now skips the real-spawnDaemon test on win32 with the same rationale as its probeDaemonAlive sibling (shared named pipe is not isolated by a throwaway PM2_HOME).
**Nit #6 fixed** — src/engine/pm2Control.js:27-35 resolveRpcSocketPath now honors PM2_DAEMON_RPC_PORT on non-win32, matching pm2/paths.js:71-78's env-override loop (win32's hardcoded pipe still wins, matching pm2 itself).

**npm test: 244/244** (was 243; net +1 — one new regression test, one existing test only gained a skip guard).
Deliberately left alone per scope: non-blocking #3 (daemon outliving the app), non-blocking #5 (stdio/cwd divergence from pm2's launchDaemon), and the win32 paths.js/NIM_PROXY_TEST_HOME hole. Fixer reported no disagreement with either blocking finding — both reproduced exactly as described.
Local pm2 safety re-confirmed: ps before/after showed only the pre-existing real user daemon (pid 1479, ~/.pm2) remaining; no orphans; no pm2 kill ever used.

**Correction to this task's own description:** cause #3 as originally written (asarUnpack missing pm2's hoisted dependency closure, e.g. `debug`) does NOT reproduce against the shipped code — see review pass 1 notes. The original 'Cannot find module debug' observation came from a hand-run experiment pointed at the app.asar.unpacked copy of Daemon.js, which this app never does. Causes #1 and #2 stand as described.

## Wave 6 opus review pass 2 — verdict: APPROVE

Confirmed AC: #1 (carried forward from pass 1), #2 (macOS fresh/mine, Linux carried forward), #3 (fresh), #5 (fresh), #6 (fresh, 244/244 observed). #4 re-confirmed NOT APPLICABLE. No unconfirmed ACs; reviewer specifically looked for a reason to re-run a platform test and could not construct one — the win32 branch of resolveRpcSocketPath returns before the new PM2_DAEMON_RPC_PORT check (so the nit is literally unreachable on win32), and child.kill() fires only when fn === reject, whereas every pass-1 Windows observation was a success path.

**Regression test independently validated as genuinely failing pre-fix.** Reviewer did not trust the fixer's before/after: it extracted pm2Control.js at 043d7dd (verified `grep child.kill` → no match) and at 2d635a6 into a scratchpad harness and ran the identical 3-call scenario against each, counting orphans TWO independent ways (ppid === process.pid, and a PM2_HOME-string match on ps output, immune to a wrong ppid filter). Pre-fix: 3 rejections, 3 live orphans (pids 31051/31343/31636, both filters agreeing). Fixed: 3 rejections, 0 orphans by both filters.
Root cause of the fixer's ps false-negative confirmed: node_modules/pm2/lib/Daemon.js:451 sets process.title under `if (require.main === module)` BEFORE daemon.start(), so the title is renamed even on a bind-failing daemon and 'Daemon.js' never appears in ps. Filtering on 'God Daemon' is correct. Also confirmed there is no self-fork — the direct child IS the God daemon (the only spawn in Daemon.js is the unrelated update path at line 51), so child.kill() targets the real daemon, not a wrapper.

Three edge cases empirically verified: kill() after 'exit' already fired → _handle === null → returns false, no signal sent, so no pid-reuse hazard; spawn failure with child.pid undefined → kill() returns false without throwing (the try/catch is belt-and-braces); a detached child in its own pgid IS reached by kill() (targets the pid, not the group). No window where the child exists but is unkillable, and no path where a stale pid gets signalled.

**Blocking #1 RESOLVED** (src/engine/pm2Control.js:152-164). The `if (fn === reject)` guard is correct: finish(resolve, ...) is called from exactly one place (onMessage:177, after child.disconnect() and child.unref()), finish(reject, ...) from timeout:141, onError:168, onExit:180. Success path provably never kills — test:236 asserts probeDaemonAlive === true AFTER spawnDaemon resolves, and the reviewer's own packaged run confirmed the daemon survives a resolve.

**Blocking #2 RESOLVED.** electron-builder.yml is now BYTE-IDENTICAL to base dev (git diff 09e53fd...HEAD -- electron-builder.yml is empty). Verified fresh: app.asar.unpacked = 482 files (only pm2, @pm2, fsevents — the latter two from electron-builder's own native-module defaults, not our pattern); app.asar = 3097 entries with ZERO .env matches, and no .env in the unpacked tree either. The revised comment is now accurate: anchoring createRequire at app.asar/src/engine/pm2Control.js resolves pm2/package.json to app.asar/node_modules/pm2/package.json (inside the package, NOT the repo's node_modules — a real risk here since dist/ sits inside the repo), and the real file exists at app.asar.unpacked/node_modules/pm2/lib/Daemon.js; the asar shim bridges the two.

Deferred items confirmed absent: whole branch touches only 3 files; src/main/shutdown.js and src/engine/paths.js untouched; the spawn() options block unchanged in 2d635a6. No drive-bys.

### Non-blocking findings carried forward (NOT fixed in this task — candidates for follow-up)

1. **A timeout can now kill a slow-but-healthy daemon, trading a leak for a possible livelock** (src/engine/pm2Control.js:140-143, 152-164). Pre-fix, a daemon that bound its sockets at 15.1s survived the timeout and the next 5s poll's probeDaemonAlive found it and skipped the spawn — self-healing. Post-fix we kill it, so each retry restarts from zero and a machine that consistently needs >15s never converges. Risk low in practice (bootstrap measured at ~57ms locally, sub-second from the packaged binary) and this is exactly what pass 1 directed, so non-blocking. Clean mitigation if ever wanted: on the TIMEOUT path only, await probeDaemonAlive() first and treat 'alive' as success instead of killing.
2. **The win32 reject path is now entirely untested** (test/engine/pm2Control.test.js:225, 272 both skip on win32; no live Windows failure scenario exercised in either pass). child.kill() maps to TerminateProcess on the child handle and should work regardless of detached, but that is inference. Acceptable because the worst case is the call no-ops and win32 reverts to pre-fix leak behaviour — strictly not worse than before.
3. NIT: the leak test leaks the very processes it detects on failure (test:276-295) — the finally only rmSync's pm2Home, with no process.kill of the pids in `leaked`; a future regression would leave 3 God daemons alive pointing at a just-deleted PM2_HOME. The sibling test at :238-244 does clean up its pid.
4. NIT: only the timeout reject path is covered; onError/onExit share the same finish() helper so coverage value is marginal, but the test's name promises more than it exercises.
5. Positive note: the PM2_DAEMON_RPC_PORT fix is exactly right — pm2/paths.js's env-override loop maps DAEMON_RPC_PORT → PM2_DAEMON_RPC_PORT with a plain truthy check, and the win32 block overwrites DAEMON_RPC_PORT AFTER it; src/engine/pm2Control.js:31-35 mirrors both semantics and ordering, including the subtlety that on non-win32 the env override beats an explicitly-passed pm2Home, which is what pm2 itself does.

Hygiene: all probing under throwaway PM2_HOMEs; final ps sweep showed only the user's own long-running daemon (pid 1479, ~/.pm2) untouched; no pm2 kill run anywhere.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed the cold-bootstrap hang: pm2Control.ensureConnected() now raw-probes the resolved rpc socket/pipe with net.connect BEFORE calling pm2.connect(), and when nothing is listening it spawns pm2's own unmodified lib/Daemon.js via ELECTRON_RUN_AS_NODE with an explicit PM2_HOME, waits for its ready IPC message, then connects — so pingDaemon() always takes its working 'connect' path. The whole flow is bounded by a 30s timeout that clears the memoized promise on failure, so a wedged connect can never again permanently block every proxy:* IPC call (AC#3 stands independently of the bootstrap fix). Squash-merged PR #13 -> dev @ e4b517c; 244/244 tests passing on merged dev (235 baseline + 9).

Verified live on genuinely daemon-less machines, start -> stop -> restart with real new pids: Windows (winvm) not-installed -> start 13212ms -> pid 3664 -> stop 589ms -> restart 13243ms -> pid 7100 -> stop, daemon observed as electron.exe ...pm2\lib\Daemon.js; macOS from a REAL PACKAGED artifact (npm run pack), daemon spawned under a throwaway PM2_HOME with lsof confirming it running the packaged Electron Framework binary; Linux (linuxvm, Ubuntu 26.04 aarch64) daemon bootstrap confirmed plus full suite 243/243. Full suite independently run by the reviewer on all three platforms.

AC#1, #2, #3, #5, #6 checked. AC#4 deliberately left UNCHECKED as not-applicable, on both reviewers' explicit recommendation: dropping pm2 was never considered, pm2 remains the supervisor, require('pm2') and test/main/licenses.test.js are untouched, so the AGPL sign-off the criterion guards was never triggered.

Two opus review passes. Pass 1 (request_changes) caught a real regression the implementation introduced — spawnDaemon() never killed the child on its reject paths, an unbounded leak of one Electron-weight daemon per retry against a 5s poller, reproduced live as 3 simultaneous orphans — and DISPROVED cause #3 of this task's own description: the asarUnpack/'debug' gap does not reproduce against the shipped code, because require.resolve returns the app.asar path and Electron's asar shim stays active in ELECTRON_RUN_AS_NODE children. The broadened asarUnpack was therefore reverted to the original narrow pattern (electron-builder.yml is byte-identical to base dev) and the inaccurate rationale comments corrected in both files. Pass 2 (approve) independently reconstructed the leak repro rather than trusting the fix — pre-fix 3 orphans, post-fix 0, counted two independent ways — and confirmed child.kill() reaches a detached child, no-ops safely after exit, and never fires on the success path.

Known non-blocking items left for follow-up, all recorded in the notes: a timeout can now kill a slow-but-healthy daemon (trading the leak for a possible livelock on a machine that consistently needs >15s; mitigation is to probe-then-treat-alive-as-success on the timeout path only); the win32 reject path is untested (worst case it no-ops back to pre-fix behaviour, strictly not worse); and two test nits. Separately discovered and confirmed live but NOT fixed here: on win32, paths.js resolveConfigDir ignores the injected homedir because APPDATA is always set, so NIM_PROXY_TEST_HOME does not protect the config dir on Windows — a real hole in this project's documented safe-manual-testing mechanism, deserving its own task.
<!-- SECTION:FINAL_SUMMARY:END -->
