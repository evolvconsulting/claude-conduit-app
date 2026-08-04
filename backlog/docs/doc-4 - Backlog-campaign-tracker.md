---
id: doc-4
title: Backlog campaign tracker
type: other
created_date: '2026-08-02 00:16'
updated_date: '2026-08-04 15:17'
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

Restore 4 / wave 10 dispatch (2026-08-03): all three remaining ready tasks (NCOW-21, NCOW-24,
NCOW-27) turn out to conflict pairwise, so this wave has exactly one member. NCOW-21 and NCOW-27
both cite `src/engine/configGen.js` (NCOW-21: the generated launcher's `cmdQuoteArg`
embedded-quote escaping; NCOW-27: `renderEcosystemConfigCjs()`'s managed-app entry) — treated as
a real file conflict, not a cluster-tag heuristic, per the tracker's own note from wave 9.
NCOW-24 and NCOW-27 don't share a file but both require live-verifying this app's actual
start/stop/restart behavior on a real packaged Windows build against the SAME shared `winvm`
daemon/process state — treated as a Shared-Machine-State conflict. NCOW-21's own Windows AC also
exercises the same generated launcher pm2 uses to start litellm, so it was conservatively treated
as contending for the same live-Windows resource too, per the "ambiguous match → keep the
conflict" rule. **Wave 10 = NCOW-27 alone** (HIGH priority, release-blocking — no published
release has ever proven `proxy.start()` works from a packaged install — and its core fix needs no
VM at all for the macOS/Linux portion, only its own AC#2 needs winvm). NCOW-21 and NCOW-24 remain
queued for a future wave once NCOW-27 releases the shared file/winvm resources.

As of wave 10 settlement (2026-08-03): **NCOW-27 is Done** (see Resolved) — merged, PR #17 ->
`08d8ecf`. Its opus review live-verified the fix on all three platforms (macOS, Linux arm64
AppImage, and Windows via winvm) and surfaced two adjacent, independent defects while doing so,
both user-approved and filed between waves: **NCOW-28** (HIGH — Windows litellm banner
`UnicodeEncodeError` on cp1252 stdout, blocks every packaged Windows install from starting the
proxy even after NCOW-27's fix) and **NCOW-29** (MEDIUM — `apiKey.validateAndSave` silently
reports success when `secretStore.save()` fails with `ENCRYPTION_UNAVAILABLE`, found on a headless
Linux box with no keyring backend).

**Restore 5 ground-truth check (2026-08-03) found one piece of drift**: the previous session
crashed after `backlog task edit`'s on-disk write for NCOW-27's settlement (status Done, all 5 ACs
checked, final summary) but before its git commit — the tracker doc itself was also never updated
past wave 10 dispatch. Reconciled: `npm test` re-verified 258/258 against dev @ `08d8ecf` before
committing the recovered settlement write (now `0dd283c`); this tracker update is the matching
catch-up for the doc side. No code, branch, worktree, or PR drift — `dev`/`origin/dev` were
already in sync, no leftover worktrees/branches/PRs from wave 10.

Four tasks remain queued, none blocked by a dependency: NCOW-21, NCOW-24, NCOW-28, NCOW-29.
**CHECK winvm REACHABILITY FIRST** — confirmed reachable again at this restore
(`~/.scripts/winvm.sh "hostname"` → `winvm`). Needs live Windows: NCOW-21, NCOW-24, NCOW-28 (AC#1/
#2). NCOW-29's live-reproduction AC (#3) needs a Linux box with no available keyring backend —
the same `linuxvm` characteristics used for NCOW-25 should qualify, needs reconfirming reachable
before dispatch. Shared Machine State still limits any wave to at most one live-Windows task.
NCOW-28 likely touches the same generated-launcher code path (`configGen.js` / `run.js`) that
NCOW-21 and NCOW-27 already contended over — treat as a probable file conflict with NCOW-21 until
the next wave's file-citation check confirms or clears it, not just a cluster-tag heuristic.

**Wave 11 dispatch (2026-08-03):** all four ready tasks need one of two contended resources.
NCOW-21, NCOW-24, and NCOW-28 all require live winvm (Shared Machine State caps them to one per
wave regardless of file overlap); NCOW-29 instead needs a Linux box with no keyring backend
(`linuxvm`, an independent resource, reachable and already qualified by NCOW-25). Among the three
winvm-contending tasks, NCOW-28 was chosen for the single live-Windows slot over NCOW-21 (LOW
priority, cosmetic hardening with no live exploit path today) and NCOW-24 (HIGH, but open-ended
characterization work with no fix recipe yet) — NCOW-28 is HIGH priority, directly continues
NCOW-27's exact defect class (packaged proxy still cannot start on a whole platform), and already
has a reviewer-validated fix recipe (`PYTHONIOENCODING=utf-8`) ready to implement, so it is both
the highest-severity and highest-confidence pick for the contended slot. **Wave 11 = {NCOW-28,
NCOW-29}** — no file overlap (NCOW-28 touches `configGen.js`/`run.js`, NCOW-29 touches
`engine-context.js`/renderer setup UI) and no shared-machine-state overlap (winvm vs linuxvm).
NCOW-21 and NCOW-24 remain queued for a future wave once winvm's single slot frees up again.

As of wave 11 settlement (2026-08-03): **NCOW-28 and NCOW-29 are both Done** (see Resolved) —
merged PR #18 -> `a6d80ea` and PR #19 -> `230ca0d`, both approved with independent live A/B
verification, wave-level integration review found the merged result `clean` (no cross-task
conflicts, all three configGen.js fixes across NCOW-22/27/28 coexist correctly, npm test 261/261
on merged dev). One real follow-up candidate surfaced across both reviews and the integration
pass: `configGen.generateAll()` has exactly one caller (the setup wizard), so an existing install
upgrading in place never regenerates `ecosystem.config.cjs` and keeps whatever
NCOW-22/27/28-vintage fixes (or lack thereof) it had at first setup — proposed to the user for
filing as a new task, not created unilaterally. A second candidate (`secretStore.js`'s
`importFromExistingEnvFile()` swallowing a save failure identically to NCOW-29's fixed bug) was
confirmed by the integration review to be dead code with zero production callers — not proposed
for filing.

User approved filing the ecosystem-regeneration gap between waves — created as **NCOW-30** (HIGH:
both real published releases, v0.1.0 and v0.1.1, predate NCOW-27 entirely, so every real user who
has ever completed setup against a published build is currently exposed). NCOW-30 needs no VM to
start (it's a code/detection-logic task), though its own AC#1 wants live before/after verification
of an in-place upgrade, and AC#2/#3 call for coordinating scope with NCOW-24 and NCOW-10's
auto-update path if picked up alongside either.

Four tasks remain queued, none blocked by a dependency: NCOW-21, NCOW-24, NCOW-30. **CHECK winvm
REACHABILITY FIRST** — NCOW-21 and NCOW-24 both need it, and Shared Machine State still limits any
wave to one live-Windows task; NCOW-30 doesn't need winvm to implement but treat it as a probable
NCOW-24 conflict (shared daemon-lifecycle scope per its own AC#3) until a wave's file-citation
check confirms or clears it.

**Wave 12 dispatch (2026-08-04):** all three ready tasks (NCOW-21, NCOW-24, NCOW-30) turned out to
conflict pairwise (NCOW-21/NCOW-30 both cite `src/engine/configGen.js`; NCOW-21/NCOW-24 both need
the single live-winvm slot; NCOW-24/NCOW-30 plausibly share pm2 daemon-lifecycle code per NCOW-30's
own AC#3), so this wave shrank to its correct degraded size of one, same shape as waves 10 and 3.
**Wave 12 = NCOW-30 alone** — chosen over NCOW-24 (also HIGH, but open-ended characterization work
with no fix recipe yet) because it's fully scoped with clear ACs, doesn't consume the winvm slot,
and closes real-user exposure that has existed since the very first published release.

As of wave 12 settlement (2026-08-04): **NCOW-30 is Done** (see Resolved) — merged, PR #20 ->
`6485ff2`. Took 2 review passes (opus): pass 1 found a real blocking regression via live A/B
testing (a corrupt/truncated `manifest.json` — exactly what NCOW-30's own new write path can
itself produce on a crash/power-loss — crashed `createEngineContext()` before any window could
open); pass 2 independently re-verified the fix with two different corruption shapes and approved.
Two non-blocking follow-up candidates (background restart not serialized behind `ipc.js`'s proxy
mutex; a failed restart isn't retried since the version stamp is written before the restart
attempt) were user-approved and filed together as **NCOW-31** (LOW — narrow, recoverable race plus
a non-retry gap, not user-facing today).

Three tasks remain queued, none blocked by a dependency: NCOW-21, NCOW-24, NCOW-31. **CHECK winvm
REACHABILITY FIRST** if picking up NCOW-21 or NCOW-24 — not re-checked since wave 12's restore
(confirmed reachable then). NCOW-31 needs no VM to start (pure code path, same call site NCOW-30
just touched) but treat it as a probable file conflict with anything else touching
`engine-context.js`/`pm2Control.js` until a fresh file-citation check confirms or clears it against
whatever else is ready at the next wave.

**Wave 13 dispatch (2026-08-04):** restore 7 found zero drift against the wave-12 handover
(`dev`/`origin/dev` in sync at `ba04f9d`, clean tree, no leftover worktrees/branches/open PRs, all
3 treehouse leases in pool `claude-conduit-163fa4` available). winvm re-confirmed reachable
(`~/.scripts/winvm.sh "hostname"` → `winvm`). File-citation check against the real code (`grep`,
not the cluster-tag heuristic): NCOW-24 cites `src/main/engine-context.js` and
`src/engine/pm2Control.js` (pm2 daemon bootstrap/lifecycle code); NCOW-31 cites the same
`src/main/engine-context.js` plus `src/engine/configGen.js` (`regenerateStaleConfig()`/
`needsRegeneration()`) and `src/main/ipc.js` (the mutex it needs to share) — a confirmed file
conflict on `engine-context.js`, not just the probable one flagged at wave 12 settlement. NCOW-21
cites only `src/engine/configGen.js`/`test/engine/configGen.test.js` (`cmdQuoteArg()`), which also
conflicts with NCOW-31 on `configGen.js`. NCOW-21 and NCOW-24 additionally both require the single
live-winvm slot (Shared Machine State) even though they cite no common file. All three ready tasks
therefore conflict pairwise (NCOW-21/NCOW-24: Shared Machine State; NCOW-21/NCOW-31:
`configGen.js`; NCOW-24/NCOW-31: `engine-context.js`), so the wave shrinks to its correct degraded
size of one, same shape as waves 3/10/12. **Wave 13 = NCOW-24 alone** — the only HIGH-priority
task left in the queue (NCOW-21 and NCOW-31 are both LOW), queued since wave 6 and repeatedly
deferred to lower-priority-but-more-scoped work each time the winvm slot was contended; winvm is
confirmed reachable now and NCOW-24's own ACs require live Windows verification regardless of
what else is picked.

As of wave 13 settlement (2026-08-04): **NCOW-24 is Done** (see Resolved) — merged, PR #21 ->
`4441f40`. Took 3 opus review passes: pass 1 found the fix broke Linux daemon bootstrap entirely
(a missing `libffmpeg.so` companion file), found the recorded "NSIS update is blocked"
characterization did not actually reproduce (only uninstall does, intermittently), and found no
integrity check against a partially-copied companion file — all three fixed in fix pass 1 with
live re-verification on both a real Linux container and winvm. Pass 2 independently re-verified
all three fixes with different reproductions than pass 1 (linux-arm64 instead of x64, genuine
signed release installers, a different corrupted file) and found one remaining documentation-only
inconsistency between two docs, fixed in fix pass 2. Pass 3 (final) approved with all 6 ACs
independently confirmed. npm test 293/293, re-verified after rebase onto dev (one earlier local
run showed 292/293 before a rebase-triggered re-run came back clean twice in a row — treated as a
flaky/timing-sensitive result, not a regression, consistent with this campaign's prior flaky-test
notes).

Two tasks remain queued, none blocked by a dependency: NCOW-21, NCOW-31. **CHECK winvm
REACHABILITY FIRST** if picking up NCOW-21 — not re-checked since this wave's dispatch (confirmed
reachable then). NCOW-31 needs no VM to start. A fresh file-citation check at the next wave should
confirm whether they still conflict now that NCOW-24 (which conflicted with both) is done — NCOW-21
touches `configGen.js`/`test/engine/configGen.test.js`; NCOW-31 touches `engine-context.js`,
`configGen.js`, and `ipc.js` — so a `configGen.js` conflict between them likely still holds, but
re-verify rather than assume.

**Wave 14 dispatch (2026-08-04):** restore 8 found zero drift against the wave-13 handover
(`dev`/`origin/dev` in sync at `98eac16`, clean tree, no leftover worktrees/branches/open PRs, all
3 treehouse leases in pool `claude-conduit-163fa4` available). winvm re-confirmed reachable
(`~/.scripts/winvm.sh "hostname"` → `winvm`). A fresh file-citation check via `grep` confirmed the
predicted conflict holds: NCOW-21's `cmdQuoteArg()` (line 172) and NCOW-31's
`regenerateStaleConfig()` (line 475) both live in `src/engine/configGen.js` — a confirmed file
conflict, not the "likely" one flagged at wave 13 settlement. The wave shrinks to one, same shape
as waves 3/10/12/13. **Wave 14 = NCOW-21** — ahead of NCOW-31 in confirmed queue order (#3 vs #14)
and the only one of the two needing the live-winvm slot, so it's picked first while winvm is
already confirmed reachable.

## Queue (confirmed order)

| # | Task ID | Cluster | Deps (mirrors each task's real `dependencies` field) | Status | Wave | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 3 | NCOW-21 | release | none | Dispatched | 14 | small follow-up from NCOW-20's review: harden cmd.exe embedded-quote escaping + doc wording; needs live winvm |
| 14 | NCOW-31 | pm2/packaging | none | To Do | | serialize config-regeneration's background restart behind ipc.js's proxy mutex + retry a failed regeneration instead of stamping the version before the restart succeeds; filed wave 12 from NCOW-30's reviews, LOW priority; no VM needed to start, probable file conflict with anything touching engine-context.js/pm2Control.js |

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
| 10 | NCOW-27 | Done, 2026-08-03, wave 10 | Fixed the packaged proxy.start() defect on all three platforms: configGen.js's renderEcosystemConfigCjs() now emits interpreter: process.execPath (a literal expression, never frozen at generate time) + env: { ELECTRON_RUN_AS_NODE: '1' } for the managed litellm-nim pm2 entry, mirroring the existing daemon-spawn pattern NCOW-22 already established. Independently verified live by an opus reviewer on all three platforms, including an A/B negative control that reverted the fix and reproduced the original MODULE_NOT_FOUND/HEALTH_CHECK_TIMEOUT failure on a real packaged macOS build, then confirmed the fix resolves it: packaged macOS (npm run pack) and a real Linux arm64 AppImage both proxy.start()/stop()/restart() cleanly with genuine LLM completions through the running proxy; Windows (winvm) confirmed the same asar-path defect and same fix mechanism (against the shared daemon, since Windows hardcodes pm2's RPC pipe regardless of PM2_HOME) once two unrelated Python/Windows environment issues were separately worked around. AC#3 (AppImage's ephemeral process.execPath persisted into pm2's dump.pm2): confirmed this app never calls resurrect()/pm2 startup itself, so no self-inflicted failure within its own lifecycle; added an advisory AppImage-specific caveat to pm2Control.js's getBootPersistenceGuidance() without touching NCOW-24's scope (that function currently has no caller in src/, so the caveat is correct but not yet user-visible -- a pre-existing gap, not introduced here). AC#4: regression tests prove the interpreter expression isn't frozen at generate time (verified to fail without the fix, and to fail again against a plausible-wrong JSON.stringify(process.execPath) implementation) and that the env field is present. Two minor comment-accuracy findings from review (a stale "no interpreter needed" claim; an overly narrow ELECTRON_RUN_AS_NODE justification) were folded in as a follow-up commit, re-confirmed doc-only via a byte-identical-after-stripping-comments diff check. npm test 258/258. Squash-merged PR #17 -> dev @ 08d8ecf. Two adjacent defects found during review were filed as separate follow-ups per user approval: NCOW-28 (Windows litellm banner UnicodeEncodeError blocking every packaged Windows install) and NCOW-29 (apiKey.validateAndSave silently discarding a secretStore.save() ENCRYPTION_UNAVAILABLE failure). |

| 11 | NCOW-28 | Done, 2026-08-03, wave 11 | Added PYTHONIOENCODING: 'utf-8' to configGen.js's renderEcosystemConfigCjs() generated env object for the managed litellm-nim pm2 entry, alongside NCOW-27's ELECTRON_RUN_AS_NODE. Fixes litellm's startup banner crashing with UnicodeEncodeError on Windows' default cp1252 stdout codepage (previously timed out as HEALTH_CHECK_TIMEOUT under pm2) -- blocked every packaged Windows install even after NCOW-27's fix. Opus review independently confirmed all 5 ACs with an A/B control on a real Windows VM (winvm): a matched no-fix build reproduced the exact crash/crash-loop (HEALTH_CHECK_TIMEOUT, restarts 3->4, the exact UnicodeEncodeError string), the fix build ran proxy.start/stop/restart cleanly with a real LLM completion before and after restart. Mutation-tested the regression test (fails without the fix, passes with it). npm test 259/259 (261/261 after rebase onto NCOW-29). Squash-merged PR #18 -> dev @ a6d80ea. |
| 12 | NCOW-29 | Done, 2026-08-03, wave 11 | apiKey.validateAndSave in engine-context.js now propagates secretStore.save()'s {ok:false, error} instead of discarding it and always reporting success. No renderer change needed -- setup-view.js already branched on result.ok and rendered result.error?.message in its existing .fail span, gated on wiz.apiKeyValidated. Opus review independently reproduced the bug and fix live on a headless Linux box (linuxvm) with a genuine, unforced ENCRYPTION_UNAVAILABLE precondition (no desktop D-Bus session, confirmed with a standalone probe): before the fix, the setup UI showed a misleading pass state with Continue enabled despite the key never being persisted (getMasked() null, generate() NO_KEY); after, a clear .fail error with Continue disabled; a happy-path control (XDG_CURRENT_DESKTOP=GNOME) confirmed normal key persistence still works. npm test 260/260 (261/261 after rebase onto NCOW-28). Squash-merged PR #19 -> dev @ 230ca0d. Two adjacent findings recorded on the task but out of scope: an identical swallowed-failure pattern in secretStore.js's importFromExistingEnvFile() (confirmed by the wave integration review to be dead code, zero production callers) and a pre-existing, environment-specific flaky pm2Control test on Linux (confirmed unrelated to this change, its own orphaned daemon cleaned up by the reviewer). |
| 14 | NCOW-30 | Done, 2026-08-04, wave 12 | Fixed the gap where an existing install never regenerated its generated ecosystem.config.cjs/run.js/manifest.json across app upgrades. manifest.json now records generated_by_version; configGen.js's needsRegeneration()/regenerateStaleConfig() detect a version mismatch (or absent/corrupt stamp) and re-render from the manifest's already-recorded settings, restarting the proxy via the app's existing getStatus()/startOrRestart() mechanism if it's currently running; engine-context.js runs this once at every launch, fire-and-forget. Two opus review passes: pass 1 request_changes -- found a real blocking regression via live A/B testing (a corrupt/truncated manifest.json, which this task's own write path can itself produce on a crash/power-loss, threw past createEngineContext()'s constructor and silently prevented the app from ever opening a window); fix pass made the manifest read resilient (falls back to null/absent, matching the existing missing-manifest treatment) plus added failure logging, a dev/nightly staleness caveat comment, and 4 new tests. Pass 2 approve -- independently re-verified the fix with two different corruption shapes, re-confirmed AC#1/#2/#4/#5 live (an old-shaped install regenerates on launch with all prior state and real keys preserved; a running proxy is cleanly restarted onto the regenerated config, not corrupted or orphaned), reviewed AC#3 by inspection (pm2Control.js untouched, no NCOW-24 overlap). npm test 282/282 (261 baseline + 21 new), re-verified after rebase onto dev. Squash-merged PR #20 -> dev @ 6485ff2. Two non-blocking follow-up candidates (background restart not serialized behind ipc.js's proxy mutex; a failed restart isn't retried since the version stamp is written before the restart attempt) were user-approved and filed together as NCOW-31. Housekeeping: a stray, harmless litellm-nim artifact entry the wave-1-review's live testing had left in the user's real shared pm2 daemon (dump.pm2) was found and cleaned up by the orchestrator between review passes. |
| 15 | NCOW-24 | Done, 2026-08-04, wave 13 | Fixed the bootstrapped pm2 daemon (spawned via ELECTRON_RUN_AS_NODE when no daemon exists) locking this app's own installed binary indefinitely, since it used that binary as the daemon's interpreter. Live characterization on a real Windows VM found an NSIS update is NOT blocked (NSIS renames the locked image aside via PendingFileRenameOperations, which Windows permits on a locked file) but an NSIS uninstall IS blocked, intermittently (exits 0, deregisters the app, deletes every other file, leaves the locked exe running with no UI path back to it -- unless a preceding update already relocated the original image). resolveDaemonInterpreter() in pm2Control.js now copies the interpreter plus required companion files (icudtl.dat, snapshot_blob.bin, v8_context_snapshot.bin, libffmpeg.so on Linux) into `<pm2Home>/daemon-interpreter/` on win32/linux, staged atomically so a crash mid-copy never leaves a broken half-copy reused silently; spawnDaemon() hands the daemon this relocated copy instead of the live installed binary. Never kills anything -- the no-pm2-kill constraint is untouched, the daemon still outlives the app by design, it just no longer locks the installed file. README/DESIGN.md/CLAUDE.md/About dialog now accurately document what persists after quit/uninstall and why (the ~227MiB relocated copy is never cleaned up by any uninstall path). Three opus review passes: pass 1 request_changes -- found the initial fix broke Linux daemon bootstrap entirely (missing libffmpeg.so, live-reproduced in a real Linux container), found the recorded Windows characterization inaccurate (only uninstall is blocked, not update), found no integrity check against a partially-copied companion file. Pass 2 -- independently re-verified all three fixes with different reproductions (linux-arm64 instead of x64, genuine signed release installers, a different corrupted file), confirmed all fixed; withheld on one remaining doc-only inconsistency between README and the About dialog. Pass 3 (final, would have auto-escalated on another request_changes per the 2-retry cap) approved with all 6 ACs independently confirmed. npm test 293/293, re-verified after rebase onto dev (one earlier local run showed 292/293, resolved as flaky on two clean re-runs, not a regression). Squash-merged PR #21 -> dev @ 4441f40. |

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

- 2026-08-03 — wave 10 (task: NCOW-27): restore 4 found all three remaining ready tasks conflicting
  pairwise (NCOW-21/NCOW-27 share configGen.js; NCOW-24/NCOW-27 share the live-winvm resource;
  NCOW-21's own Windows AC conservatively treated as contending for the same resource too), so the
  wave shrank to its correct degraded size of one: NCOW-27 alone, dispatched as the highest-priority,
  release-blocking item whose core fix needed no VM to implement.

  Implemented per the fix recipe the wave-9 reviewer had already validated live: configGen.js's
  renderEcosystemConfigCjs() now emits `interpreter: process.execPath` (a literal expression, not
  frozen at generate time) plus `env: { ELECTRON_RUN_AS_NODE: '1' }` for the managed litellm-nim pm2
  entry. One opus review pass, approve, all 5 ACs independently confirmed with LIVE verification on
  all three platforms rather than trusting the implementer: an A/B negative control on packaged
  macOS (revert the fix, reproduce the original MODULE_NOT_FOUND/HEALTH_CHECK_TIMEOUT failure; reapply,
  confirm the fix resolves it) plus real start/stop/restart with a genuine LLM completion through the
  running proxy on packaged macOS and a real Linux arm64 AppImage; Windows (winvm) independently
  confirmed the identical asar-path defect and fix mechanism against the shared daemon after working
  around two unrelated Python/Windows environment issues. AC#3 (AppImage's ephemeral
  `process.execPath` persisted into pm2's `dump.pm2`): confirmed this app never calls
  `resurrect()`/pm2 startup itself, so no self-inflicted failure within its own lifecycle — an
  advisory caveat was added to `pm2Control.js`'s `getBootPersistenceGuidance()` without touching
  NCOW-24's scope. AC#4: regression tests prove the interpreter expression isn't frozen at generate
  time and that the env field is present. Two minor comment-accuracy findings were folded into a
  doc-only follow-up commit (byte-identical after stripping comments, re-confirmed by the reviewer).
  npm test 258/258. Squash-merged PR #17 -> dev @ `08d8ecf`.

  Two adjacent, independent defects surfaced live during the same review pass were surfaced to the
  user rather than filed unilaterally (per Task-write concurrency): (1) a Windows-only litellm
  startup-banner `UnicodeEncodeError` on cp1252 stdout that still blocks every packaged Windows
  install even after NCOW-27's fix, with a reviewer-validated `PYTHONIOENCODING=utf-8` recipe already
  in hand — user approved filing as **NCOW-28** (HIGH); (2) `apiKey.validateAndSave` silently
  discarding a `secretStore.save()` `ENCRYPTION_UNAVAILABLE` failure and reporting success anyway,
  reproduced live on a headless Linux box with no keyring backend — user approved filing as
  **NCOW-29** (MEDIUM). Both created between waves with the reviewer's full evidence carried onto
  the new tasks.

  Worktree released back to the treehouse pool, branch deleted (local + remote) after merge. Per
  this skill's R4j, this session stopped after wave 10 rather than dispatching a further wave — not
  because of an escalation this time, but because the settlement write for NCOW-27 (task edit to
  Done + all ACs + final summary) was interrupted by a session crash before it could be committed,
  and the tracker doc itself was never updated past the wave 10 dispatch note. **Restore 5
  (2026-08-03) reconciled this drift**: `npm test` re-verified 258/258 against dev @ `08d8ecf` before
  committing the recovered settlement write (commit `0dd283c`); no other drift was found (`dev`/
  `origin/dev` in sync, no leftover worktrees/branches/open PRs). This tracker update is the matching
  catch-up for the doc side, folding in NCOW-27's Resolved-table entry and NCOW-28/NCOW-29's Queue
  rows in the same pass.

- 2026-08-03 — wave 11 (tasks: NCOW-28, NCOW-29): dispatched immediately after restore 5's
  reconciliation, first real parallel wave since wave 9. Of the four ready tasks (NCOW-21, NCOW-24,
  NCOW-28, NCOW-29), three needed the single live-winvm slot; NCOW-28 was chosen for it over NCOW-21
  (LOW priority, no live exploit today) and NCOW-24 (HIGH but open-ended, no fix recipe yet) since it
  is HIGH priority, directly continues NCOW-27's exact defect class, and already had a
  reviewer-validated fix recipe. NCOW-29 ran in parallel against `linuxvm` instead (independent
  resource, no file overlap with NCOW-28's `configGen.js`/`run.js`).

  Both implemented cleanly, one opus review pass each, both **approve** with independently-confirmed
  evidence rather than trusted implementer claims — both reviewers went further than either worker,
  building their own A/B control pairs (revert-the-fix / reapply-the-fix) live on real hardware
  rather than accepting the workers' before/after narratives: NCOW-28's reviewer built its own
  packaged Windows arm64 artifact pair and reproduced the exact `UnicodeEncodeError`/
  `HEALTH_CHECK_TIMEOUT`/crash-loop without the fix, clean start/stop/restart plus two real LLM
  completions with it; NCOW-29's reviewer independently established that `ENCRYPTION_UNAVAILABLE` is
  a genuine unforced condition on a headless Linux desktop session (not an artificial trigger) before
  reproducing the silent-success bug and its fix live over CDP, plus a happy-path control proving the
  fix doesn't break normal key persistence. Both mutation-tested their regression tests (removing the
  fix makes the new test fail, restoring it passes).

  Merged serially in confirmed queue order: NCOW-28 first (clean rebase, re-verified 259/259, PR #18
  -> dev @ `a6d80ea`), then NCOW-29 (clean rebase onto NCOW-28's merge, re-verified 261/261, PR #19 ->
  dev @ `230ca0d`) — no file overlap, as predicted at dispatch. Wave-level integration review (opus)
  over the cumulative diff came back `clean`: confirmed no shared code path between the two changes,
  confirmed all three configGen.js env-object fixes (NCOW-22-era daemon pattern, NCOW-27, NCOW-28)
  coexist correctly and additively with nothing clobbered, re-ran the full suite on merged dev
  (261/261), and confirmed neither change violates any of CLAUDE.md's hard constraints (no renderer
  touched at all this wave, so the banned-dialog/CSP checks were trivially clean).

  Both worktrees released back to the treehouse pool, both branches deleted (local + remote) after
  their respective merges. One real follow-up candidate surfaced independently by both individual
  reviews and confirmed by the integration pass: `configGen.generateAll()` has exactly one caller
  (the setup wizard), so an existing install upgrading in place never regenerates
  `ecosystem.config.cjs` and keeps whatever fix-vintage it had at first setup, meaning NCOW-27/28's
  fixes don't reach an existing Windows install without a fresh setup run — proposed to the user for
  filing rather than created unilaterally. A second candidate (`secretStore.js`'s
  `importFromExistingEnvFile()`, same swallowed-failure pattern as NCOW-29) was confirmed dead code
  with zero production callers by the integration review, so it was not proposed for filing.

- 2026-08-04 — wave 12 (task: NCOW-30): restore 6 found zero drift against the wave-11 handover
  (dev/origin/dev in sync, no leftover worktrees/branches/PRs, treehouse pool fully released).
  winvm confirmed reachable. Of the three ready tasks, all conflicted pairwise (NCOW-21/NCOW-30
  share configGen.js; NCOW-21/NCOW-24 both need the single live-winvm slot; NCOW-24/NCOW-30
  plausibly share pm2 daemon-lifecycle code per NCOW-30's own AC#3), so the wave shrank to one:
  NCOW-30, chosen over NCOW-24 for being fully scoped, not needing winvm, and closing exposure
  that's existed since the first real release.

  Implemented cleanly per plan (generated_by_version stamp + needsRegeneration()/
  regenerateStaleConfig() in configGen.js, wired into engine-context.js at every launch). Review
  pass 1 (opus): request_changes -- a live A/B (dev vs branch, same truncated manifest.json) proved
  a real blocking regression: the manifest read this task added ran synchronously outside any
  try/catch, so a corrupt manifest (which the task's own new write path can itself leave behind on
  a crash) crashed app startup into a windowless zombie process, contradicting the code's own
  "must never block or fail app startup" comment. Also recorded 4 non-blocking findings (silent
  regeneration/restart failures, no mutex serialization on the background restart, exact-version-
  equality staleness as a dev/nightly trap, two untested branches).

  Fix pass wrapped the manifest read in a try/catch falling back to null/absent (matching the
  existing missing-manifest treatment), added failure logging, a doc comment on the dev/nightly
  caveat, and 4 new regression tests; deliberately left the mutex-serialization finding unaddressed
  as a real cross-module architectural change out of scope for a fix pass, flagging it explicitly
  rather than dropping it silently. Review pass 2 (opus): approve -- independently rebuilt the A/B
  with two different corruption shapes (distinct from the fix-pass worker's own), confirmed the fix
  general rather than overfit, confirmed the null-fallback introduces no new data loss (manifest/
  config files byte-identical after a corrupt-manifest launch), re-confirmed AC#1/#2/#4/#5 live,
  and accepted the mutex-serialization deferral as correctly out of scope. Two new non-blocking
  findings surfaced this pass (the new failure logging doesn't cover startOrRestart()'s
  {ok:false,error} return shape, only a genuine throw; a failed restart is never retried since the
  version stamp is written before the attempt) -- folded into the same follow-up as the deferred
  mutex finding rather than reopening request_changes.

  Merged: rebased cleanly onto origin/dev (no conflicts -- solo wave), npm test re-verified 282/282
  post-rebase, squash-merged PR #20 -> dev @ `6485ff2`. Worktree released back to the treehouse
  pool, branch deleted (local + remote). No wave-level integration review needed (solo wave, same
  as waves 3/10 -- nothing to cross-check against a sibling that wasn't in flight). Housekeeping:
  the orchestrator found and deleted a stray, harmless `litellm-nim` entry the wave-1-review's own
  live testing had left in the user's REAL shared pm2 daemon (`dump.pm2`, pointing at a since-
  deleted scratchpad path) between review passes 1 and 2 -- confirmed the six unrelated user apps
  were untouched before and after.

  User approved filing the two deferred/newly-surfaced findings together as one combined task --
  created as **NCOW-31** (LOW: a narrow, recoverable race plus a non-retry gap, neither user-facing
  today). Session continues; ready set for the next wave is {NCOW-21, NCOW-24, NCOW-31}.


- 2026-08-04 — wave 13 (task: NCOW-24): restore 7 found zero drift against the wave-12 handover
  (dev/origin/dev in sync at `ba04f9d`, clean tree, no leftover worktrees/branches/PRs, all 3
  treehouse leases available). winvm re-confirmed reachable. A fresh, real (not cluster-tag)
  file-citation check against `grep` found NCOW-24 (`engine-context.js`, `pm2Control.js`) and
  NCOW-31 (`engine-context.js`, `configGen.js`, `ipc.js`) share `engine-context.js` — a confirmed
  conflict, not the "probable" one flagged at wave 12 settlement — and NCOW-21 (`configGen.js`)
  conflicts with NCOW-31 on the same file; NCOW-21 and NCOW-24 additionally both need the single
  live-winvm slot. All three ready tasks conflicted pairwise, so the wave shrank to one:
  **NCOW-24** — the only HIGH-priority task left in the queue, queued since wave 6 and repeatedly
  deferred to lower-priority-but-more-scoped work every time the winvm slot was contended.

  Implemented: characterized the daemon-file-lock behavior empirically on winvm rather than
  assuming (per AC#1) — found a real NSIS silent update actually succeeds against a locked exe
  (Windows permits renaming a running image; NSIS moves it aside and queues a delete via
  `PendingFileRenameOperations`), while a real NSIS silent uninstall genuinely fails to remove the
  locked exe, intermittently (only when a preceding update hasn't already relocated it).
  `resolveDaemonInterpreter()`/`spawnDaemon()` in `pm2Control.js` now relocate the daemon's
  interpreter into `<pm2Home>/daemon-interpreter/` so the *installed* file is never the one held
  open. Documentation (README/DESIGN.md/CLAUDE.md/About dialog) updated to state accurately what
  persists after quit/uninstall and why.

  Took all 3 allowed opus review passes (the maximum before auto-escalation on retry-budget
  exhaustion): pass 1 `request_changes` — live-reproduced that the initial fix's companion-file
  list omitted `libffmpeg.so`, silently breaking pm2 cold-bootstrap on every shipped Linux target
  (the exact case NCOW-22 exists to fix); live-reproduced that the recorded "NSIS update is
  blocked" claim did not actually hold (the implementer's supporting evidence — an unchanged
  reinstall `LastWriteTime` — was confounded, since NSIS preserves archive timestamps regardless
  of locking; the reviewer ran the missing unlocked control and got the identical result); and
  live-reproduced that a partially-copied companion file (e.g. a crash mid-copy) was silently
  reused forever with no self-heal. Fix pass 1 added `libffmpeg.so` to the companion list
  (live-verified in a real Ubuntu container against a genuine Electron Linux binary, both `ldd`-
  and real-daemon-bootstrap level), corrected the characterization everywhere it appeared to
  "update: not blocked; uninstall: blocked, intermittently", and made the copy operation
  integrity-checked and atomic (stage-then-rename, so a crash mid-copy can't leave a
  looks-complete-but-broken state). Pass 2 independently re-verified all three fixes with
  deliberately different reproductions than pass 1 used (linux-arm64 instead of x64, genuine
  signed 0.1.0/0.1.1 release installers instead of dev builds, FileId/registry tracking instead of
  timestamps, a different corrupted companion file) — all three confirmed genuinely fixed —  but
  found one last documentation-only defect: README and the About dialog each still asserted a
  false "you can clean it up by running uninstall again" remedy that contradicted the correct
  claim ("never removed") stated elsewhere in the same documents. Fix pass 2 corrected exactly
  those two sentences (no code-logic or test changes). Pass 3 (final) approved: both corrected
  sentences read accurately and consistently across all four touched docs, no scope creep in the
  fix-pass-2 commit, all 6 ACs independently confirmed.

  npm test 293/293, re-verified after rebase onto dev — one earlier local run on the rebased branch
  came back 292/293; two immediate re-runs came back clean, so this was treated as a flaky/timing-
  sensitive result rather than a real regression (this campaign has seen isolated flaky pm2-related
  tests before, e.g. wave 11's note on a Linux-only flake). Rebased cleanly onto origin/dev (solo
  wave, no sibling to conflict with). Squash-merged PR #21 -> dev @ `4441f40`. Worktree released
  back to the treehouse pool, branch deleted (local + remote). No wave-level integration review
  needed (solo wave, same as waves 3/10/12). Shared pm2 daemons on both this Mac and winvm confirmed
  untouched (pid, `dump.pm2` byte-identical) throughout all three review passes.

  Process note: review pass 2's returned report triggered the harness's own prompt-injection
  pattern-match (tag: "settings-json"), same false-positive class as wave 9's NCOW-23 review —
  flagged transparently to the user, inspected, and confirmed benign (the flagged text was the
  reviewer legitimately reporting real config-file hash checks it ran to prove nothing sensitive
  was touched, not an embedded instruction). Nothing in the report was treated as a directive.

  Two tasks remain queued, none blocked by a dependency: NCOW-21, NCOW-31. Ready set for the next
  wave should be recomputed fresh rather than assumed — NCOW-24, which conflicted with both, is now
  done, but NCOW-21/NCOW-31 likely still conflict with each other on `configGen.js`.
