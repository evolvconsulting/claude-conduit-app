---
id: doc-4
title: Backlog campaign tracker
type: other
created_date: '2026-08-02 00:16'
updated_date: '2026-08-02 06:53'
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
As of wave 3 settlement + resolution (2026-08-02): **NCOW-20 is ready now** (no dependencies) —
fix the two Windows litellm-launch bugs. NCOW-10.3 is blocked-by-dependency on NCOW-20 (not
human_needed anymore — that part is resolved) and should be re-attempted as one full pass once
NCOW-20 is Done. No other task in this campaign round is ready (see Not queued for
NCOW-7/11/13/14/15, all excluded since init/restore-1 for unrelated reasons).

## Queue (confirmed order)

| # | Task ID | Cluster | Deps (mirrors each task's real `dependencies` field) | Status | Wave | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | NCOW-10 | release | NCOW-9 (done), NCOW-12 (done) | Split | | epic; split into 10.1/10.2/10.3 at restore 1 |
| 2 | NCOW-20 | release | none | To Do | | Windows litellm-launch bugs (.cmd-only discovery, missing shell:true); ready now |
| 3 | NCOW-10.3 | release | NCOW-10.1 (done), NCOW-10.2 (done), NCOW-20 (to do) | Blocked | | full re-verification once NCOW-20 lands; privacy blocker already resolved |

## Resolved

| # | Task ID | Status/date/wave | Evidence summary |
| --- | --- | --- | --- |
| 1 | NCOW-10.1 | Done, 2026-08-02, wave 1 | electron-updater + GitHub Releases feed, documented in new docs/auto-update.md (docs/distribution.md untouched). In-app checker via new update:* IPC channels + non-blocking renderer banner. macOS notify-only (pending signing certs) per campaign decision; Windows/Linux get electron-updater's silent path. Proxy-restart reuses the single existing stop-proxy call site (poller stop -> proxy stop -> shutdown latch -> quitAndInstall). Two opus review passes: pass 1 request_changes (startup-broadcast-vs-late-subscriber race that could silently drop the macOS notification, AC3; plus 3 minor items) -- fixed via status caching/coalescing so a late subscriber gets an accurate replay without a second real check; pass 2 approve, all 5 ACs independently confirmed. 219/219 tests passing. Squash-merged PR #9 -> dev @ 6633b4a. Real E2E install verification deferred to NCOW-10.3 by design. |
| 2 | NCOW-10.2 | Done, 2026-08-02, wave 2 | GitHub Actions release workflow (.github/workflows/release.yml): 3-platform matrix, npm test gate, electron-builder --publish always on a tag push, publishes latest.yml/latest-mac.yml/latest-linux.yml. docs/distribution.md updated. Verified via a real smoke-test tag (v0.0.0-ci-smoketest) against the live repo -- surfaced and fixed 6 real bugs: a genuine Windows production bug in configDirMigration.js's path-rewrite (JSON.stringify backslash-escaping mismatch, would have left real Windows upgraders with a broken pm2 launcher), a broken npm run licenses on Windows (ENOENT then EINVAL, fixed via resolveCliCommand + shell:true), two Windows-only test bugs (hardcoded forward-slash path parsing, hardcoded bare 'node' expectation), and two CI-workflow races (tag/version mismatch, concurrent duplicate-release creation). Also documented a real upstream electron-builder 26.15.3 bug (macOS zip blockmap gets an unsanitized name even through --publish always) as non-load-bearing today. One opus review pass: approve, all 4 ACs independently re-verified against fresh observed output (re-ran npm test, re-checked the real CI run's actual asset listing, reproduced the Windows bug against pre-fix dev code to confirm it was genuine). Test release + tag cleaned up, package.json version reverted. 220/220 tests passing. Squash-merged PR #10 -> dev @ 0325e2c. Note: a concurrency incident occurred mid-implementation -- an earlier worker instance that was told to stand down kept running silently in the background and briefly clobbered a second worker's uncommitted fix-pass edits in the same worktree; caught via direct CI-log inspection by the orchestrator, resolved by force-killing the stale instance via TaskStop, no data lost (fixes were fully re-described and reapplied). |

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
  restarting the app) and a `package-lock.json` version-drift nit (still reads `0.1.0` despite
  `package.json`'s `0.1.1` — `npm ci` tolerated it for the real release builds, but it will
  compound at the next version bump). Both remain only as notes on NCOW-10.3 — revisit if they
  become relevant, but do not file tasks for them without asking again.

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
