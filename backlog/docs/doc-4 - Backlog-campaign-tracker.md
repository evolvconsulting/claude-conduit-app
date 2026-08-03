---
id: doc-4
title: Backlog campaign tracker
type: other
created_date: '2026-08-02 00:16'
updated_date: '2026-08-03 12:38'
---
# Backlog campaign tracker

Protocol: restore → compute the ready/conflict graph → mark the wave Dispatched
→ dispatch (parallel workers + review) → serialize the merge →
update this tracker once more at settlement → loop until the queue is empty or
blocked → write handover.

Driven by the `backlog-handover` skill (`.claude/skills/backlog-handover/SKILL.md`). This is a
new campaign round following the prior one (see `doc-3`, now superseded — NCOW-16/17/18/12/19/9
all Done there, 4 waves). This round exists specifically because NCOW-9 and NCOW-12 landing
unblocked NCOW-10, which the prior campaign's inventory had excluded.

## Confirmed at init (2026-08-01) — do not re-ask

Fresh inventory of all 6 open Backlog tasks (`backlog task list --exclude-status Done`) at this
init: NCOW-7, NCOW-10, NCOW-11, NCOW-13, NCOW-14, NCOW-15. Classification:

- **NCOW-10 is queued.** Its Backlog dependencies (NCOW-9, NCOW-12) are both Done. Its own
  implementation notes say the app WILL be code-signed before release but "implementation may
  land ahead of the certificates" — macOS auto-update (Squirrel.Mac) needs real signing and
  will fall back to notify-only until certs exist, but Windows NSIS and Linux AppImage don't
  strictly require signing for `electron-updater` to function. Presented to the user via
  AskUserQuestion (queue now unsigned / defer until certs exist / queue but scope down
  verification); user chose **queue it now, unsigned** — build the full update mechanism
  (electron-updater integration, in-app checker, CI release workflow — the latter is exactly
  NCOW-9's recommended follow-up #1), verify end-to-end on Windows and/or Linux (no signing
  needed there), document macOS's notify-only fallback as the correct AC#1/#4 answer until
  certs land. **This will publish real, unsigned GitHub Releases of this app** — that is an
  explicit, informed choice, not an oversight. Do not re-ask this.
- **NCOW-7, NCOW-11**: both depend on NCOW-15, unchanged from the prior campaign's
  classification, still excluded — see Not queued.
- **NCOW-13**: depends on NCOW-14, unchanged, still excluded — see Not queued.
- **NCOW-14, NCOW-15**: both still explicitly say in their own descriptions "expect this to
  want splitting into subtasks when it is picked up" — still too large for a single wave
  dispatch, still excluded, unchanged from the prior campaign. Scoping them is a separate
  planning session.

## Confirmed at restore 1 (2026-08-02) — do not re-ask

NCOW-10 (8 ACs spanning code, CI infra, and real cross-platform install verification) was judged
too large for one wave member. Presented to the user via AskUserQuestion: split into subtasks
now vs. dispatch as one large task. User chose **split into subtasks first**. Created:

- **NCOW-10.1** — mechanism decision + in-app checker + graceful degradation + proxy-restart
  behavior (orig. AC#1, #2, #4, #5, #7). No new Backlog dependencies (parent's NCOW-9/NCOW-12
  deps already satisfied). **Done — see Resolved.**
- **NCOW-10.2** — CI release workflow publishing artifacts + update metadata (orig. AC#6).
  `--dep NCOW-9` (already Done). **Done — see Resolved.**
- **NCOW-10.3** — real end-to-end verification on Windows and/or Linux (orig. AC#3, #8).
  `--dep NCOW-10.1 --dep NCOW-10.2`. **Escalated human_needed at wave 3 — see Not queued.**

File-conflict note: both NCOW-10.1 and NCOW-10.2 cite `docs/distribution.md` (10.1 as a
reference for its mechanism-decision doc, 10.2's AC#4 explicitly requires editing it to point at
the new CI workflow) — treated as a real shared-file conflict per this skill's conflict-graph
rule, not dispatched in the same wave. NCOW-10.1 went first and is now merged; NCOW-10.1's own
diff confirmed it never touched `docs/distribution.md` (put its decision doc in a new
`docs/auto-update.md` instead), so NCOW-10.2 is clear to proceed without inheriting any
conflict.

## Confirmed at restore 2 / wave 3 dispatch (2026-08-02) — do not re-ask

NCOW-10.3 requires actually installing an older build on Windows and/or Linux and observing a
live auto-update, which this orchestrator session (running on macOS) cannot do with only its own
local environment. Presented to the user via AskUserQuestion: they have a VM/machine available,
specifically a **Windows VM** ("winvm"), reachable over Tailscale SSH via `~/.scripts/winvm.sh`
(wraps `ssh -i ~/.ssh/id_mesh_mbam5 jdnewhouse@winvm.tail9905f8.ts.net`). Connectivity confirmed
live (`hostname` → `winvm`, `ver` → Windows 10.0.26200.8894) before dispatch. Separately, the user
also confirmed the release-versioning strategy via AskUserQuestion: publish two real, permanent
releases (`v0.1.0` matching current package.json, then `v0.1.1` after a real bump) rather than a
disposable smoke-test tag — both stay published permanently, no cleanup/deletion, no reverting
the version bump. Do not re-ask either of these for this campaign round.

## Wave 3 outcome (2026-08-02) — escalated, human_needed

NCOW-10.3's worker completed the full real-world exercise (both releases published, v0.1.0
installed on winvm, live CDP-driven first-run setup, fresh relaunch cycle) but hit a structural
blocker no agent can resolve unilaterally: **electron-updater's default `GitHubProvider` polls
the public, unauthenticated `releases.atom`/`releases/latest` feed, and `evolvconsulting/
claude-conduit` is a private repo, so that feed 404s for every real install on every platform**
(confirmed platform-independent by the reviewer — Linux/AppImage would hit the identical 404,
not just this Windows test). Root cause (independently re-derived by an opus reviewer, not just
re-read from the worker): `electron-updater`'s `providerFactory.js` only ever authenticates via
`PrivateGitHubProvider` when `app-update.yml`'s baked-in `githubOptions.private === true`, which
requires `publish: {provider: github, private: true}` in `electron-builder.yml` — absent today —
and electron-builder never auto-detects repo privacy from `package.json`'s `repository` field
when inferring publish config. This is a static build-time choice, not fixable by an env var at
launch. **This means the auto-update feature, as shipped, cannot work for any real user while
the repo stays private** — a genuine product decision (make the repo public, or add
`private: true` plus a real token-distribution strategy for installed clients) is required before
NCOW-10.3 can be re-attempted. See the task's full notes for the complete evidence trail (both
worker and reviewer independently confirmed every link in the chain).

Two independent real Windows bugs were also found and confirmed (unrelated to the privacy
blocker, discovered while getting litellm running for AC#3): (1) `src/engine/platform.js`'s
`resolveCliCommand()` unconditionally appends `.cmd` on win32, but pip/uv/pipx-installed
`litellm`/`python` ship as `.exe` stubs on Windows — so `checkLitellmOnPath()`/`checkPython()`
can never find a real Windows install; (2) `configGen.js`'s generated `run.js` spawns without
`shell: true`, and modern Node's CVE-2024-27980 hardening throws `EINVAL` for a direct `.cmd`
spawn — so litellm could never actually launch on Windows even if found. These block AC#3
independent of how the privacy decision resolves. A third, minor robustness gap was also noted:
`pm2Control.ensureConnected()` memoizes its connect promise with no timeout/retry, so a hung
first connect permanently wedges every future `proxy:*` IPC call.

The narrow, safe part of the work — bumping `package.json` to `0.1.1` so `dev` tracks the highest
permanently-published release (both `v0.1.0` and `v0.1.1` now exist as real GitHub Releases,
created with standing pre-authorization) — was reviewed (approve) and merged: PR #11 → dev @
7ea3b45. 220/220 tests passing post-merge. NCOW-10.3 itself is NOT marked Done — it is blocked on
a human decision (see Not queued).

## Resolution of the human_needed escalation (2026-08-02) — do not re-ask

User decided: **make `evolvconsulting/claude-conduit` public** (not the private+token path), and
confirmed executing it in-session rather than deferring. Orchestrator ran `gh repo edit
evolvconsulting/claude-conduit --visibility public --accept-visibility-change-consequences`;
verified via `gh repo view` (`isPrivate: false`) and directly re-tested the feed
(`releases.atom` and the `releases/latest` API both now return `200`, previously `404`). The
structural blocker is resolved — recorded on NCOW-10.3's notes. Separately, user approved filing
one follow-up task for the two Windows litellm-launch bugs (not the minor pm2Control/lockfile
nits, which stay as notes only) — created as **NCOW-20**. User then decided NCOW-10.3's full
re-verification should wait until NCOW-20 lands, so AC#3 (proxy restart across the update) can
be exercised in the same pass as AC#1/#2 rather than doing a partial re-run now — NCOW-10.3 was
given a real Backlog dependency on NCOW-20 (`--dep NCOW-20`) to formalize this ordering for
future restores. Do not re-ask any of this.

## Frontier

The "ready now" set is ALWAYS recomputed live from the Backlog task list + this table at the
start of every restore/wave — never trust a persisted "next wave" plan.
As of wave 8 settlement (2026-08-02): **the entire NCOW-10 auto-update epic is closed** (NCOW-10,
10.1, 10.2, 10.3 all Done), and **NCOW-22 is Done** (merged, PR #13 -> e4b517c).

Five tasks remain queued, none of them blocked by a dependency: NCOW-21, NCOW-23, NCOW-24,
NCOW-25, NCOW-26. **CHECK winvm REACHABILITY FIRST** (`~/.scripts/winvm.sh "hostname"`) because it
gates most of them, and it went offline mid-session once already today. Needs live Windows:
NCOW-21, NCOW-23, NCOW-24. Runnable with no Windows at all: **NCOW-26** (pm2 timeout
adopt-slow-daemon fix -- pure code + tests) and **NCOW-25** (Linux arm64 release; `linuxvm` is
reachable and now provisioned with Node 22/Xvfb/pip/a litellm venv). Shared Machine State still
limits any wave to one live-Windows task at a time. No other task in this round is ready (see Not
queued for NCOW-7/11/13/14/15, all excluded since init/restore-1 for unrelated reasons).

**A pre-started pm2 daemon (node.exe pid 8832) was deliberately left running on winvm.** It is the
documented shared-daemon arrangement this app is designed around and is expensive to recreate (it
needs a scheduled task -- a bare `ssh "pm2 ping"` daemon dies with the SSH session). But it MASKS
NCOW-22's cold-bootstrap path, exactly as this dev Mac's own daemon masked it all campaign: any
fresh-install testing on winvm must account for it, and must never `pm2 kill` it.

As of wave 9 settlement (2026-08-03): NCOW-23, NCOW-25, and NCOW-26 all Done (see Resolved).
NCOW-25's live verification surfaced a NEW, much more severe, platform/architecture-INDEPENDENT
defect — packaged `proxy.start()` fails on every platform this app ships, not just Linux/arm64
(pm2's managed-app interpreter can't read `app.asar`) — user-approved and filed as **NCOW-27**
(HIGH priority, with a reviewer-validated fix recipe already in hand). Two tasks remain queued
needing live winvm (NCOW-21, NCOW-24), plus the new NCOW-27 which needs no VM to start (macOS/
Linux fix already prototyped by the reviewer; Windows verification is one of NCOW-27's own ACs).
**CHECK winvm REACHABILITY FIRST** if picking up NCOW-21/24. Shared Machine State still limits
any wave to one live-Windows task at a time.

## Queue (confirmed order)

| # | Task ID | Cluster | Deps (mirrors each task's real `dependencies` field) | Status | Wave | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 3 | NCOW-21 | release | none | To Do | | small follow-up from NCOW-20's review: harden cmd.exe embedded-quote escaping + doc wording; needs live winvm |
| 6 | NCOW-24 | pm2/release | none | To Do | | bootstrapped daemon outlives the app, holds its own binary; may block NCOW-10 update/uninstall on Windows; filed wave 6; needs live winvm |
| 9 | NCOW-27 | pm2/packaging | none | To Do | | packaged proxy.start() fails on every platform (pm2 managed-app interpreter can't read app.asar); filed wave 9, HIGH priority, fix recipe already validated live by the reviewer on macOS — Windows verification still needed |

## Resolved

| # | Task ID | Status/date/wave | Evidence summary |
| --- | --- | --- | --- |
| 1 | NCOW-10.1 | Done, 2026-08-02, wave 1 | electron-updater + GitHub Releases feed, documented in new docs/auto-update.md (docs/distribution.md untouched). In-app checker via new update:* IPC channels + non-blocking renderer banner. macOS notify-only (pending signing certs) per campaign decision; Windows/Linux get electron-updater's silent path. Proxy-restart reuses the single existing stop-proxy call site (poller stop -> proxy stop -> shutdown latch -> quitAndInstall). Two opus review passes: pass 1 request_changes (startup-broadcast-vs-late-subscriber race that could silently drop the macOS notification, AC3; plus 3 minor items) -- fixed via status caching/coalescing so a late subscriber gets an accurate replay without a second real check; pass 2 approve, all 5 ACs independently confirmed. 219/219 tests passing. Squash-merged PR #9 -> dev @ 6633b4a. Real E2E install verification deferred to NCOW-10.3 by design. |
| 2 | NCOW-10.2 | Done, 2026-08-02, wave 2 | GitHub Actions release workflow (.github/workflows/release.yml): 3-platform matrix, npm test gate, electron-builder --publish always on a tag push, publishes latest.yml/latest-mac.yml/latest-linux.yml. docs/distribution.md updated. Verified via a real smoke-test tag (v0.0.0-ci-smoketest) against the live repo -- surfaced and fixed 6 real bugs: a genuine Windows production bug in configDirMigration.js's path-rewrite (JSON.stringify backslash-escaping mismatch, would have left real Windows upgraders with a broken pm2 launcher), a broken npm run licenses on Windows (ENOENT then EINVAL, fixed via resolveCliCommand + shell:true), two Windows-only test bugs (hardcoded forward-slash path parsing, hardcoded bare 'node' expectation), and two CI-workflow races (tag/version mismatch, concurrent duplicate-release creation). Also documented a real upstream electron-builder 26.15.3 bug (macOS zip blockmap gets an unsanitized name even through --publish always) as non-load-bearing today. One opus review pass: approve, all 4 ACs independently re-verified against fresh observed output (re-ran npm test, re-checked the real CI run's actual asset listing, reproduced the Windows bug against pre-fix dev code to confirm it was genuine). Test release + tag cleaned up, package.json version reverted. 220/220 tests passing. Squash-merged PR #10 -> dev @ 0325e2c. Note: a concurrency incident occurred mid-implementation -- an earlier worker instance that was told to stand down kept running silently in the background and briefly clobbered a second worker's uncommitted fix-pass edits in the same worktree; caught via direct CI-log inspection by the orchestrator, resolved by force-killing the stale instance via TaskStop, no data lost (fixes were fully re-described and reapplied). |
| 3 | NCOW-20 | Done, 2026-08-02, wave 4 | Fixed two independent, compounding Windows bugs found during NCOW-10.3's E2E verification: (1) resolveCliCommand() no longer wraps litellm/python/installer names in .cmd before findExecutable() -- real pip/uv/pipx .exe stubs are now correctly discovered. (2) configGen.js's generated run.js launcher routes .cmd/.bat paths through cmd.exe with a properly double-quoted, fully escaped command string (windowsVerbatimArguments:true) instead of a direct spawn (which threw EINVAL) -- deliberately not shell:true. Took 3 review passes (all opus, all with LIVE Windows VM verification via a real recording litellm.cmd shim, not just code reading): pass 1 found a CI-breaking case-sensitive test bug plus a flawed early escaping approach that broke paths like "Program Files (x86)" and wasn't even injection-safe (live-proven); fix pass 1 fixed the tests, replaced the escaping with a different but still-flawed caret-based construction; pass 2 live-reproduced that the new escaping STILL broke "Program Files (x86)" and was still injectable via an embedded-quote case, root-caused to cmd.exe not treating metacharacters as control characters inside a quoted region (making the caret pass actively harmful, not protective); fix pass 2 removed the caret-escaping entirely since proper double-quoting alone is correct; pass 3 (final, would have auto-escalated on another request_changes per the 2-retry cap) approved after full live re-verification confirmed all 4 ACs, including a live before/after proof of AC1 (python/litellm genuinely undiscoverable pre-fix, found post-fix on real Windows) and that "Program Files (x86)" now round-trips correctly. 235/235 tests passing (232 baseline + 3 net new). Squash-merged PR #12 -> dev @ 11eacfa. Two small non-blocking findings flagged for a possible fast-follow (an unreachable embedded-quote-plus-metachar edge case with an already-live-verified one-line fix, and a doc-comment wording nit) -- not addressed in this task, pending user decision on whether to file a follow-up. Operational note: mid-review-pass-2, the reviewer's own test-volume cleanup accidentally ran `diskutil unmountDisk force` on the whole disk container, briefly unmounting and FileVault-locking this repo's own disk (/Volumes/_data) -- no data lost, user unlocked it, orchestrator confirmed repo/worktree integrity before continuing; all subsequent passes were explicitly warned off local diskutil operations. |
| 4 | NCOW-22 | Done, 2026-08-02, wave 6 | Fixed the pm2 cold-bootstrap hang that made proxy start/stop/restart permanently unusable on any genuinely fresh install. ensureConnected() now raw-probes the resolved rpc socket/pipe with net.connect before calling pm2.connect(), and spawns pm2's own unmodified lib/Daemon.js via ELECTRON_RUN_AS_NODE + explicit PM2_HOME when nothing is listening, so pingDaemon() always takes its working path; the whole flow is bounded by a 30s timeout that clears the memoized promise on failure (AC#3 stands independently). Verified live on genuinely daemon-less machines, start->stop->restart with real new pids: Windows (not-installed -> start 13212ms -> pid 3664 -> stop 589ms -> restart 13243ms -> pid 7100), macOS from a REAL PACKAGED artifact under a throwaway PM2_HOME, Linux (linuxvm, Ubuntu 26.04 aarch64) daemon bootstrap + full suite. Full suite independently run by the reviewer on all three platforms. AC1/2/3/5/6 checked; AC4 left unchecked as not-applicable (pm2 never dropped, so its AGPL sign-off was never triggered) on both reviewers' explicit recommendation. TWO significant review findings: pass 1 caught a real regression the implementation introduced (spawnDaemon() never killed the child on its reject paths -- an unbounded leak of one Electron-weight daemon per retry against a 5s poller, reproduced live as 3 simultaneous orphans) and DISPROVED cause #3 of the task's own description (the asarUnpack/'debug' gap does not reproduce against shipped code, since require.resolve returns the app.asar path and Electron's asar shim stays active in ELECTRON_RUN_AS_NODE children) -- so the broadened asarUnpack was reverted to the original narrow pattern, leaving electron-builder.yml byte-identical to base dev, and the wrong rationale comments were corrected in both files. Pass 2 independently reconstructed the leak repro rather than trusting the fix (pre-fix 3 orphans, post-fix 0, counted two independent ways) and approved. Also verified empirically that asarUnpack cannot pack .env (zero matches across 3097 asar entries), preserving CLAUDE.md's allowlist guarantee. Squash-merged PR #13 -> dev @ e4b517c, 244/244 tests passing (235 baseline + 9). |
| 5 | NCOW-10.3 | Done, 2026-08-02, waves 3/5/8 | Real end-to-end auto-update verified on Windows. AC1/AC2 (wave 5): installed v0.1.0 detected, downloaded and installed v0.1.1 live, relaunched app reporting 0.1.1, reviewer-confirmed by byte-exact sha512 match against the real published release. AC3 (wave 8): with the proxy genuinely running under the app's OWN pm2-orchestrated control (getStatus -> running pid 7696, /health/liveliness -> alive), update.install() stopped litellm-nim (waiting -> stopped, pid 0) and only THEN did the v0.1.1 installer appear; relaunched app reported 0.1.1 with the proxy stopped (the specified behavior -- no auto-start on relaunch), then started cleanly again (pid 11000, health passing). The opus reviewer re-derived the whole timeline independently from machine-written artifacts the worker never cited (pm2 daemon log's explicit stop RPC with matching pid and exactly one stop in the window; pm2 dump env proving programmatic require('pm2') control via PM2_PROGRAMMATIC present and PM2_USAGE absent -- the exact thing wave 5 could not achieve; litellm's own access log; Windows Prefetch; NTFS times proving stop-before-install by 113s). Ordering nuance recorded honestly: the polling timeline is corroborative; the proof is the straight-line installUpdateAndRestart() returning {ok:true} only after quitAndInstall() plus the observed ~1s stop (a degraded stop would have deferred the quit by the full 15s timeout). Scope caveats preserved: proves the SHARED-DAEMON path (a daemon was pre-started by hand, since both published builds predate NCOW-22's fix) not cold bootstrap, and used wave 5's hand-corrected run.js/manifest.json so it does not validate configGen on Windows. Zero repo changes in waves 5-8; no PR (nothing to merge). |
| 6 | NCOW-10 | Done, 2026-08-02, epic | Parent epic closed after all three subtasks completed. All 8 ACs mapped to reviewed subtask evidence: #1/#2/#4/#7 -> NCOW-10.1 (electron-updater integration, in-app checker, macOS notify-only fallback, graceful degradation -- the latter proven under a real unplanned 404 in wave 3); #5 -> NCOW-10.1 implementation plus NCOW-10.3 AC3 live confirmation; #6 -> NCOW-10.2's CI release workflow (verified against a real smoke-test tag that surfaced 6 real bugs); #3/#8 -> NCOW-10.3 AC1/AC2. Caveats recorded on the task: macOS remains notify-only pending signing certs (the intended answer, not a gap, but macOS silent update is unproven); auto-update has only ever been exercised on Windows, and the published Linux artifact is x86_64 while all available Linux hardware is aarch64 (NCOW-25). Three defects found while proving the epic out are tracked separately: NCOW-20 and NCOW-22 (both merged) and NCOW-24. CAVEAT ADDED wave 9: none of NCOW-10/NCOW-22's live proxy-restart/cold-bootstrap verification was ever exercised from a genuinely packaged artifact calling proxy.start() cold (all were source runs or relied on an already-running proxy) -- see NCOW-27. |
| 7 | NCOW-23 | Done, 2026-08-02/03, wave 9 | Fixed the win32 NIM_PROXY_TEST_HOME config-dir safety hole: APPDATA/LOCALAPPDATA always won over an injected homedir in paths.js's resolvers, so a --dev + test-home run on Windows silently operated against the REAL config dir. Added resolveWindowsAppDataOverrides(homedir), wired into engine-context.js and main/index.js's resolveUserDataPaths() (which had the identical bug -- reviewer confirmed this one would have pointed secretStore at the real encrypted NVIDIA key). Real-Windows precedence (env wins, for folder-redirection correctness) preserved outside the test-home gate -- verified live across 3 non-test gating combinations plus a simulated redirection case. Opus review: approve, all 6 ACs independently confirmed via fresh live before/after hashes on winvm (7 real config files + real nim-key.enc + real Claude-3p dir, all byte-identical, same LastWriteTimeUtc). npm test 252/252 (macOS), 15/15 native win32 run. Squash-merged PR #14 -> dev @ 0b2c7ad. |
| 8 | NCOW-26 | Done, 2026-08-02/03, wave 9 | Fixed spawnDaemon()'s TIMEOUT path to probe first via probeDaemonAlive() and adopt an already-alive-but-slow daemon instead of killing it (onError/onExit unchanged, preserving NCOW-22's leak fix for genuine failures). Two review passes: pass 1 found and live-reproduced a real daemon-leak defect in the new regression test's OWN cleanup (a failing assertion could itself leave a real orphan pointing at a deleted PM2_HOME); fixed by killing the union of the collected list and liveDaemonChildren() unconditionally. Pass 2 independently reproduced the fix two ways (copy-based A/B and a source-mutation 2x2) against real orphaned processes -- approve, all 4 ACs confirmed. npm test 254/254 (post-rebase onto NCOW-23). Squash-merged PR #15 -> dev @ 3ea0fb3. |
| 9 | NCOW-25 | Done, 2026-08-02/03, wave 9 | AC#1: Linux arm64 is now a supported published target on a native GitHub-hosted arm64 runner (GA/free for public repos, confirmed against GitHub's own changelog) -- pm2, the only asarUnpack'ed dependency, independently confirmed to have zero native/node-gyp addons across its 74-package tree, so no cross-arch rebuild concerns. AC#2: a real arm64 AppImage + deb built NATIVELY on real aarch64 hardware (linuxvm), update metadata (latest-linux-arm64.yml) independently verified correct against electron-updater's own arch-suffix consumer logic, both arch-narrowing build scripts verified to produce arch-pure output (no cross-arch leakage). AC#5: npm test 254/254. AC#3 PARTIAL and left honestly documented rather than silently closed: install/launch/prereqs/key-validation/model-catalog/config-generation all verified live on real aarch64 hardware through the real packaged IPC surface, but proxy.start() itself failed from a separate, pre-existing, platform/architecture-INDEPENDENT defect (NOT an arm64 or Linux-specific regression) -- reproduced by the reviewer on both packaged macOS and packaged Linux. Filed as NCOW-27 (HIGH priority) with a reviewer-validated fix recipe. User explicitly decided (2026-08-03) to merge now with this gap documented rather than hold, since NCOW-27 is unrelated to arm64 specifically and blocks every platform equally. AC#4 n/a (arm64 was chosen supported). Also fixed the long-standing package-lock.json/package.json version drift (0.1.0 vs 0.1.1) as its own commit. Reviewer verdict was escalate (human_needed) specifically for the NCOW-27 gap; resolved via AskUserQuestion (file NCOW-27: yes; merge NCOW-25 now: yes). Squash-merged PR #16 -> dev @ b06a05e. |

*(see `doc-3` for the prior round's full Resolved table: NCOW-16, 18, 17, 12, 19, 9 all Done
across 4 waves)*

## Not queued — needs a human / blocked

- NCOW-7: blocked on NCOW-15, which is deliberately excluded from this campaign round (see
  Confirmed at init). Also explicitly PARKED by a prior-session decision recorded on the task
  itself — revisit after NCOW-15 is scoped/done separately.
- NCOW-11: depends on NCOW-15, deliberately excluded from this campaign round (see Confirmed
  at init). Revisit once NCOW-15 is scoped/done separately.
- NCOW-13: depends on NCOW-14, deliberately excluded from this campaign round (see Confirmed
  at init). Revisit once NCOW-14 is scoped/done separately.
- NCOW-14: too large for a single wave dispatch — the task's own description says "expect this
  to want splitting into subtasks when it is picked up" (10 ACs spanning nearly every engine
  module). AC#3/#10 need a live OpenRouter credential of unknown availability. Excluded from
  this campaign round — needs a separate planning/decomposition session.
- NCOW-15: same reasoning as NCOW-14 (its own description: "expect to split this into subtasks
  when it is picked up"), and depends on NCOW-14 besides. Excluded per the same decision.
- **Minor items from wave 3, deliberately NOT filed as tasks** (user approved only NCOW-20 for
  the litellm-launch bugs): a `pm2Control.ensureConnected()` timeout/retry gap (a hung first
  `pm2.connect()` permanently wedges every future `proxy:*` IPC call, no recovery short of
  restarting the app) — remains only as a note on NCOW-10.3, revisit if it becomes relevant, do
  not file a task for it without asking again. The `package-lock.json` version-drift nit noted
  alongside it (0.1.0 vs package.json's 0.1.1) is now RESOLVED — fixed incidentally as its own
  commit during NCOW-25's wave 9 implementation.

## Wave log

- 2026-08-02 — wave 1 (task: NCOW-10.1): NCOW-10 split into NCOW-10.1/10.2/10.3 per user
  decision at restore. NCOW-10.1 dispatched alone (file-conflict with NCOW-10.2 avoided).
  Review pass 1: request_changes (blocking race between the startup update-status broadcast
  and the renderer's late subscription, which could silently drop the macOS notify-only
  notification -- violates AC3; plus 3 minor findings: doc/code timing mismatch, an
  overstated test name, a permanently-dead update-banner button on install failure). Fix pass
  addressed all of it via status caching + coalescing, a doc correction, and the two minor
  fixes plus one added test. Review pass 2: approve, all 5 ACs independently confirmed,
  219/219 tests re-run by the reviewer. Merged PR #9 (squash) -> dev @ 6633b4a. Orchestrator's
  main checkout needed a fresh `npm install` post-merge to pick up the new electron-updater
  dependency before its own `npm test` run was clean (219/219) -- noted here since it's a
  one-time local-environment step, not a code defect.
- 2026-08-02 — wave 2 (task: NCOW-10.2): dispatched alone once NCOW-10.1 merged (conflict on
  docs/distribution.md cleared). Real smoke-test verification (v0.0.0-ci-smoketest, real tag
  against the live repo, pre-authorized) surfaced 6 real bugs over 6 fix-pass iterations, most
  notably a genuine Windows production bug in configDirMigration.js's path-rewrite logic
  (JSON.stringify's backslash-escaping meant the migration silently never rewrote run.js/
  ecosystem.config.cjs on Windows, which would have left a real Windows upgrader's pm2 launcher
  pointed at the deleted legacy directory) -- exactly the kind of defect this project's
  verification standard (CLAUDE.md) exists to catch, code-reading alone would have missed it.
  Also broke and fixed npm run licenses on Windows, fixed two Windows-only test bugs, fixed two
  CI-workflow races (tag/version mismatch, concurrent duplicate-release creation), and
  documented a real upstream electron-builder blockmap-naming bug as a non-blocking known gap.
  Concurrency incident: the FIRST worker instance, told to stand down after a diagnosis
  handoff, kept running silently in the background (its "stopping" self-report was inaccurate)
  and briefly clobbered a second worker's uncommitted mid-fix-pass edits in the same shared
  worktree. Caught by the orchestrator cross-checking real CI-log evidence directly rather than
  trusting agent self-reports, resolved via TaskStop (force-kill), no data lost -- the fixes
  were fully re-described (with root causes already diagnosed) and re-applied cleanly by the
  surviving instance. One opus review pass: approve, all 4 ACs independently re-verified
  against fresh observed output (re-ran npm test, re-checked the real CI run's actual published
  asset listing, reproduced the Windows configDirMigration bug against pre-fix dev code to
  confirm it was a genuine defect and not a test artifact). 220/220 tests passing. Test release
  + tag cleaned up from the real repo; package.json version reverted. Merged PR #10 (squash) ->
  dev @ 0325e2c. NCOW-10.3 (real end-to-end install verification) is now unblocked -- last task
  in this campaign round, deliberately not dispatched this session (context-length stopping
  point after a long CI-debugging wave; see handover).
- 2026-08-02 — wave 3 (task: NCOW-10.3): restore 2 found zero drift against the wave-2 handover.
  User confirmed a Windows VM ("winvm", via ~/.scripts/winvm.sh) and the real-permanent-release
  versioning strategy (v0.1.0 then v0.1.1, both kept). Worker published both releases for real,
  installed v0.1.0 on winvm, drove the real installed app live via CDP over an SSH-tunneled
  --remote-debugging-port (a new technique for this campaign, not previously used), completed
  first-run setup with the real NIM key, bumped to v0.1.1, published it, and forced a fresh
  relaunch to trigger a real startup update-check against the newly-published release. Result:
  status=blocked, not request_changes -- the update check hit a genuine, structural 404 because
  electron-updater's default feed is unauthenticated and this repo is private. Independent opus
  review re-derived the entire causal chain from first principles (repo privacy, the public
  releases.atom 404, electron-updater's providerFactory.js gating logic, electron-builder's lack
  of publish: config, and confirmed electron-builder never auto-detects repo privacy when
  inferring publish config) and confirmed the blocker is platform-independent (Linux would fail
  identically). Verdict: escalate, human_needed -- not something an agent can resolve by writing
  code, a genuine product decision only the user can make. Also confirmed two independent real
  Windows bugs (litellm/python .cmd-only discovery; missing shell:true causing EINVAL) that
  separately block AC#3, and a minor pm2Control timeout/retry gap. The one piece of narrow, safe
  work -- bumping package.json to 0.1.1 so dev tracks the highest published release -- was
  reviewed (approve) and merged: PR #11 (squash) -> dev @ 7ea3b45, 220/220 tests passing.
  NCOW-10.3 moved to Not queued (human_needed), not Done. Per this skill's own R4j rule, a
  human_needed escalation stops the session before dispatching a further wave -- and the queue
  is in any case now empty of other agent-resolvable ready work, so this session ends here
  pending the user's decision on repo visibility / token strategy.
- 2026-08-02 — resolution (post-wave-3): user resolved the human_needed escalation by choosing
  to make `evolvconsulting/claude-conduit` public (over the private+token-distribution path) and
  confirmed executing it immediately. Orchestrator ran `gh repo edit --visibility public
  --accept-visibility-change-consequences`, verified via `gh repo view` and by re-testing the
  feed directly (`releases.atom`/`releases/latest` now `200`, previously `404`) — the structural
  blocker is gone. User approved filing NCOW-20 for the two Windows litellm-launch bugs only
  (declined the minor pm2Control/lockfile items as separate tasks); created with full evidence
  carried over from NCOW-10.3's notes. User then decided NCOW-10.3's full re-verification should
  wait for NCOW-20 rather than doing a partial AC#1/#2-only re-run now, since AC#3 (proxy
  restart) can't be exercised until NCOW-20's fixes land — NCOW-10.3 given a real `--dep NCOW-20`
  to formalize this for future restores. Session ends here; next restore's ready set will
  correctly surface NCOW-20 as the next wave.
- 2026-08-02 — wave 4 (task: NCOW-20): dispatched solo (only ready task, no conflicts) once the
  human_needed escalation from wave 3 was resolved. Unlike NCOW-10.3, this was a normal
  code-fix task -- no live VM access needed to implement (existing test/engine/platform.test.js
  pattern already injects process.platform), though the reviewer used the same winvm access
  established in wave 3 to verify every review pass live rather than by code reading alone,
  which is exactly what caught two real, non-obvious defects a code-only review would have
  missed (the case-sensitive test bug, and the cmd.exe-quoting model being subtly wrong not
  once but twice). 3 review passes total (the maximum before auto-escalation): pass 1
  request_changes (CI-breaking case-sensitive tests + a flawed escaping approach), fix pass 1,
  pass 2 request_changes (the fixed escaping still broken for "Program Files (x86)" and still
  injectable, live-proven), fix pass 2 (removed the flawed caret-escaping entirely), pass 3
  approve (full live re-verification, all 4 ACs confirmed). Squash-merged PR #12 -> dev @
  11eacfa, 235/235 tests passing. Two small non-blocking findings from the final review are
  pending a user decision on whether to file a follow-up task. NCOW-10.3 is now fully ready
  (both dependencies Done) for its full re-verification pass, deferred to the next wave pending
  user input on whether to continue this session or stop here given its length so far.
- 2026-08-02 — wave 5 (task: NCOW-10.3, retry): dispatched solo once wave 4 (NCOW-20) merged,
  since NCOW-10.3 and NCOW-21 both need live winvm access (Shared Machine State conflict) and
  NCOW-10.3 came first in confirmed queue order. Major result: AC#1 and AC#2 (real update
  download+install+relaunch, observed live) are now FULLY VERIFIED and PASSED — the worker
  relaunched the already-installed v0.1.0 app on winvm, drove it live via CDP over an
  SSH-tunneled --remote-debugging-port, watched it detect and auto-download the now-reachable
  v0.1.1 (repo is public since the wave-4 resolution), scripted through the real non-silent NSIS
  installer wizard (SetForegroundWindow + BM_CLICK via a scheduled-task-launched helper, since
  plain SSH can't see/click windows in the interactive desktop session), and confirmed the
  relaunched app reports v0.1.1 live. An independent opus review re-derived this from first
  principles rather than trusting the worker: matched the downloaded installer's sha512/size
  byte-for-byte against the real v0.1.1 latest.yml, confirmed electron-updater's own
  post-verification update-info.json, matched installed FileVersion/registry/file-timestamps
  against the real CI build, and independently drove the app live via CDP itself
  (app.getVersion() -> "0.1.1"). AC#1/#2 checked off on the task.

  AC#3 (LiteLLM proxy restart behavior across the update) hit a NEW, previously-unknown bug,
  distinct from anything NCOW-20 already fixed: pm2's connect attempt hangs forever when no pm2
  daemon already exists on the machine (window.nimProxy.proxy.getStatus() and by extension
  start/stop/restart never resolve). This was never caught before because this development
  Mac's own long-running global pm2 daemon has always been present during every prior live test
  in this campaign, masking the cold-bootstrap path entirely. The reviewer traced this further
  than the worker did, live on winvm: THREE stacked causes (pm2's own pingDaemon() never calling
  back on a missing Windows named pipe -- the actual proximate cause of the hang;
  launchDaemon()'s use of process.execPath, which is the Electron binary itself in a packaged
  app, not plain Node -- the worker's original finding, confirmed; and a third the worker
  missed, that even the obvious ELECTRON_RUN_AS_NODE=1 fix for that doesn't work either, since
  electron-builder.yml's asarUnpack covers pm2 itself but not pm2's hoisted dependency closure
  like `debug`). Verdict: request_changes, not escalate -- no product decision blocks a retry,
  just a specific unblocker (pre-start a real pm2 daemon on winvm before testing, which is
  explicitly within this app's own documented design assumption of sharing the user's daemon,
  not a workaround). AC#3 remains open, ready for a fresh worker attempt with that unblocker
  spelled out. Worth noting: NCOW-10.1's shutdown path already absorbs this hang gracefully (a
  15s timeout + proceed-anyway), which is exactly why the real update was still able to install
  despite this bug -- the degradation branch of AC3 is effectively proven, only the "genuinely
  running proxy restarts cleanly" branch remains unverified.

  User approved filing NCOW-22 for the pm2 cold-bootstrap defect itself (all 3 stacked causes +
  the pre-existing ensureConnected() no-timeout gap), flagged by the reviewer as likely
  cross-platform (unconfirmed on macOS/Linux, since this Mac's own daemon has masked the same
  path there too) and a likely shipping-blocker for any genuinely fresh install. User chose to
  stop the session here rather than immediately retry AC3 with the identified unblocker.
  NCOW-10.3's wave-5 worktree/branch (no code changes, zero commits) released without merging --
  nothing to merge, purely a verification wave. NCOW-21 and NCOW-22 are both ready for a future
  wave; the Shared Machine State conflict (all three want live winvm access at some point) will
  still gate them to one at a time.

- 2026-08-02 — wave 6 (task: NCOW-22): dispatched solo. All three ready tasks (NCOW-10.3's AC3
  retry, NCOW-21, NCOW-22) need live winvm access, so Shared Machine State capped the wave at
  one; the user was asked to choose the sequencing (deliberately left undecided by wave 5) and
  picked NCOW-22 first, on the reasoning that fixing the real defect likely makes NCOW-10.3's
  AC3 retry pass without any manual pre-start-a-daemon workaround. The user also chose real
  Linux verification for AC#2 over documenting a gap, and named `linuxvm` as the host. Host
  selection surfaced two facts worth keeping: `jetson` is unusable for cold-bootstrap testing
  (it has a live PM2 v7.0.3 God Daemon supervising real processes), and **every one of this
  user's Linux hosts is aarch64 while CI publishes an x86_64 AppImage**, so a packaged Linux run
  requires an arm64 build produced on the host — the published Linux artifact cannot be tested
  on any machine they own.

  Outcome: merged, PR #13 -> dev @ e4b517c, 244/244. Two opus review passes, both of which
  earned their keep. Pass 1 (request_changes) found a real regression the implementation had
  introduced — spawnDaemon() never killed the child on its reject paths, an unbounded leak of
  one Electron-weight daemon per retry against a 5s poller, which it reproduced live as 3
  simultaneous orphans — and it DISPROVED cause #3 of NCOW-22's own description by repacking
  with the original narrow asarUnpack and watching a packaged build cold-bootstrap successfully
  anyway. The broadened asarUnpack was therefore reverted (electron-builder.yml ends up
  byte-identical to base dev) and the factually-wrong rationale comments corrected in two files.
  Pass 1 also closed coverage holes both the worker and the orchestrator had flagged: it ran the
  full suite on all three platforms and tested the PACKAGED artifact, which nobody had done —
  significant because cause #3 only ever lived in packaged builds. Pass 2 (approve) refused to
  trust the fix pass's before/after and independently reconstructed the leak repro from
  extracted pre/post copies of the module, counting orphans two independent ways (pre-fix 3,
  post-fix 0), then verified child.kill() reaches a detached child, no-ops safely after exit,
  and never fires on the success path.

  Process note: both subagents in this wave went idle WITHOUT returning their structured result
  the first time; each returned it correctly when asked directly. Neither had actually failed —
  the work and commits were real and complete in both cases. Worth expecting on future waves:
  check the branch state before assuming an idle agent failed, and just ask for the result.

  Three follow-up candidates were surfaced to the user rather than filed unilaterally: (1) the
  win32 NIM_PROXY_TEST_HOME hole (paths.js resolveConfigDir ignores the injected homedir because
  APPDATA is always set — confirmed live, a real hole in this project's documented safe-testing
  mechanism); (2) the bootstrapped daemon outliving the app while holding the app's own binary,
  which on Windows locks a running image and may interfere with NCOW-10 auto-update / NSIS
  uninstall replacing the exe; (3) the x86_64-only Linux release vs this user's all-aarch64
  Linux fleet.

- 2026-08-02 — wave 7 (task: NCOW-10.3, AC#3 only): dispatched solo at the user's explicit choice
  after wave 6 settled. **Blocked on environment availability, not on the mechanism** — winvm was
  offline for the entire wave at the Tailscale layer (ssh timed out; `tailscale ping` timed out;
  status showed 'offline, last seen 19m ago' with rx stuck at 0; ~7 minutes of bounded polling
  never connected; every other tailnet peer was normal). winvm HAD been reachable at the start of
  this session and was used successfully by NCOW-22's reviewer earlier the same session, so it
  dropped mid-session. The worker also checked for a way to power it on indirectly from mbam5 and
  found none (no prlctl/VBoxManage/vmrun, no Parallels install).

  Deliberately NOT routed through an opus reviewer despite the worker self-reporting `blocked`:
  the escalation policy exists so an uncorroborated 'unfinishable' is never trusted, and the
  orchestrator corroborated it directly with two independent probes. A reviewer cannot power on a
  VM, and nothing about the mechanism was in question. Nothing was touched on winvm, no pm2
  daemon started, no repo files changed, worktree released and branch deleted with zero commits.

  Correction recorded for future waves: the assumption that NCOW-22's fix makes wave 5's
  pre-start-a-daemon unblocker unnecessary is WRONG for this test, because both published builds
  (v0.1.0 and v0.1.1) predate the fix — it is on dev but in no published artifact. The unblocker
  is still required unless a new release is published (deliberately not done; the campaign
  authorized exactly two permanent releases and both exist). One useful spec detail was still
  established by code trace: NCOW-10.1's defined behavior is stopStatusPoller() ->
  stopProxyForShutdown() (15s-bounded, degrades gracefully) -> markShuttingDown() ->
  quitAndInstall(), with NO proxy auto-start on relaunch (purely user/tray-driven) — that is what
  AC#3's 'after' state should be judged against.

- 2026-08-02 — wave 8 (task: NCOW-10.3, AC#3 only, retry after wave 7's environment block): the
  user powered winvm back on and the wave was re-dispatched immediately. **AC#3 verified and
  NCOW-10.3 closed, which in turn closed the whole NCOW-10 epic** (user approved closing the
  parent; all 8 of its ACs map to reviewed subtask evidence).

  The worker solved a genuinely new obstacle worth remembering: a bare `ssh ... "pm2 ping"` spawns
  a pm2 daemon that dies the instant the SSH session ends (Windows job-object teardown), so no
  daemon ever survived the invoking command — very likely part of why earlier waves struggled to
  get the proxy running at all. A scheduled-task launch produces a daemon that persists. Also
  found: `SetForegroundWindow` silently fails for background-launched processes (Windows
  foreground-lock), so direct `SendMessage(BM_CLICK)` on enumerated child button HWNDs is more
  reliable for driving the NSIS wizard than the technique recorded in earlier waves.

  The review was the strongest of the campaign so far and is worth imitating: rather than re-run
  the update, it re-derived the entire event timeline from machine-written artifacts the worker
  had never cited — the pm2 daemon's own log, pm2's dump records, litellm's access log, Windows
  Prefetch, NTFS timestamps, the uninstall registry. Four independent artifact families agreed
  with the worker's narrative and none contradicted it. It proved the crux wave 5 failed (that the
  proxy was under the app's OWN programmatic control) from the pm2 dump env: PM2_PROGRAMMATIC
  present and PM2_USAGE absent, the latter being something pm2's CLI sets unconditionally. It also
  corrected the worker's one overclaim (the polling timeline is corroborative, not the primary
  ordering proof) and corrected an orchestrator speculation: the 15-18s slow Electron exit is NOT
  evidence for NCOW-24, because the daemon in this run was plain node.exe and no pm2 process was
  holding the Electron image at all.

  Process note repeated from wave 6: no code changed in this wave, so there was no PR and nothing
  to merge — a pure verification wave, released with zero commits.

- 2026-08-02/03 — wave 9 (tasks: NCOW-23, NCOW-25, NCOW-26): restore 3 found zero drift against
  the prior handover; winvm re-confirmed reachable. First 3-way parallel wave of this campaign
  round: NCOW-23 (the one live-Windows slot, per the prior handover's stated priority — fixes the
  safety mechanism NCOW-21/24 both depend on), NCOW-25 (live-Linux on `linuxvm`, an independent
  resource from winvm), NCOW-26 (pure code + tests, no VM) — file-citation check found no overlap
  among the three members' expected files, confirmed clean by three separate treehouse-leased
  worktrees off the same pinned wave base.

  NCOW-23: implemented and approved in one review pass, all 6 ACs independently confirmed via
  fresh live before/after evidence on winvm (see Resolved). NCOW-26: implemented, took 2 review
  passes (pass 1 found and live-reproduced a real daemon-leak defect in the new regression test's
  own cleanup logic; fix pass resolved it; pass 2 approved via two independent reproductions
  against real processes — see Resolved). Both merged via the serial merge queue in confirmed
  queue order (NCOW-23 first, then NCOW-26 rebased cleanly on top — no file overlap, as predicted
  at dispatch), each re-verified with a full `npm test` pass after rebase before pushing.

  NCOW-25: implemented (arm64 decided supported on a native GH-hosted runner, built and verified
  live on real aarch64 hardware) but its live verification surfaced a NEW, far more severe,
  platform/architecture-INDEPENDENT defect: packaged `proxy.start()` fails on every platform this
  app ships, via a pm2 managed-app interpreter that can't read `app.asar` (the same class of
  problem NCOW-22 already solved for the DAEMON itself, but never extended to the process pm2
  launches on the daemon's behalf). The reviewer independently reproduced this live on TWO
  packaged artifacts (macOS and Linux arm64), traced the exact root cause in pm2's own
  `God/ForkMode.js`, and validated a fix recipe live (fixed packaged macOS start/stop/restart
  end-to-end including a real LLM completion through the running proxy). Confirmed this is not a
  NCOW-25 regression: no prior wave had ever called `proxy.start()` from a genuinely packaged
  artifact — NCOW-22's own verifications were all source runs (except a packaged `getStatus()`
  check, which never forks the managed app), and NCOW-10.3's Windows verification relied on an
  already-running proxy under a pre-started daemon. Reviewer verdict: escalate (human_needed) —
  severity vastly exceeds this task's own MEDIUM framing, Windows is untested for this specific
  failure, and there's a real open AppImage-packaging question (process.execPath is an ephemeral
  FUSE-mounted path once running, which pm2 persists into `dump.pm2`) entangled with NCOW-24.

  Escalation surfaced directly to the user (per this skill's R4j — a human_needed escalation
  should be seen promptly, not scroll past under routine merges) via AskUserQuestion rather than
  guessed past: user approved (a) filing the defect as its own new HIGH-priority task — created as
  **NCOW-27** with the reviewer's full root cause, live reproduction, and validated fix recipe —
  and (b) merging NCOW-25 now with AC#3 left honestly partial/documented rather than holding the
  branch, since NCOW-27 is unrelated to arm64 specifically and blocks every platform equally.
  NCOW-25 then rebased cleanly (no overlap with NCOW-23/26's files) and merged last in the queue.

  All three branches' worktrees released back to the treehouse pool (2 warm-reused slots plus 1
  newly created — pool grew from 2 to 3 on demand with no `max_trees` friction), all three
  branches deleted (local + remote) after their respective merges. `dev` finished the wave at
  254/254 tests (244 baseline + 8 from NCOW-23 + 2 from NCOW-26), 4 real PRs merged (#14, #15,
  #16, plus the file-only NCOW-27 creation commit). Also flagged and resolved in-session: a
  subagent's returned review report for NCOW-23 triggered the harness's own prompt-injection
  pattern-match (tag: "settings-json"); on inspection this was a false positive (bracket
  placeholders like `<fakehome>\.claude\settings.json` describing real file paths, not an actual
  embedded instruction) — flagged transparently to the user per policy, nothing in the report was
  treated as a directive.
