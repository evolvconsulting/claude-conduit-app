---
id: doc-4
title: Backlog campaign tracker
type: other
created_date: '2026-08-02 00:16'
updated_date: '2026-08-02 03:25'
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
  `--dep NCOW-10.1 --dep NCOW-10.2`. **Dispatched wave 3 — see Queue.**

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
live (`hostname` → `winvm`, `ver` → Windows 10.0.26200.8894) before dispatch. The wave-3 worker
is briefed to use this script for every remote command against the VM rather than any other
access path. Do not re-ask which environment to use for this campaign round.

## Frontier

The "ready now" set is ALWAYS recomputed live from the Backlog task list + this table at the
start of every restore/wave — never trust a persisted "next wave" plan.
As of restore 2 / wave 3 dispatch (2026-08-02): NCOW-10.1 and NCOW-10.2 are both Done and merged
to `dev`. NCOW-10.3 is dispatched as a solo wave 3 (no conflicts — last task in this campaign
round) using the Windows VM described above for live verification.

## Queue (confirmed order)

| # | Task ID | Cluster | Deps (mirrors each task's real `dependencies` field) | Status | Wave | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | NCOW-10 | release | NCOW-9 (done), NCOW-12 (done) | Split | | epic; split into 10.1/10.2/10.3 at restore 1 |
| 2 | NCOW-10.3 | release | NCOW-10.1 (done), NCOW-10.2 (done) | Dispatched | 3 | real end-to-end auto-update install verification on winvm (Windows), via `~/.scripts/winvm.sh` |

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
- 2026-08-02 — wave 3 dispatch (task: NCOW-10.3): restore 2 found zero drift against the wave-2
  handover (dev clean @ dc28048, both treehouse slots available, no leftover branches/PRs).
  User confirmed a Windows VM ("winvm") is available over Tailscale SSH via
  `~/.scripts/winvm.sh`; connectivity verified live before dispatch. NCOW-10.3 marked
  Dispatched/In Progress; worker being set up in a fresh worktree next.
