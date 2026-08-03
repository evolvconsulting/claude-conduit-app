# Handover — NCOW-10 auto-update campaign, wave 5 done (waves: 1, tasks: NCOW-10.3 partial AC1/AC2, NCOW-22 filed)

**Date**: 2026-08-02 | **Grounded against**: `dev` @ `09e53fd86f1f7f54323151f8c3c20c539c7084ac`,
clean, 0 ahead/0 behind `origin/dev` | **Tracker**: doc-4

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. This is
the same campaign round (doc-4) as the prior handovers. Wave 5 (NCOW-10.3
retry) got major news: AC#1 and AC#2 (real end-to-end auto-update
download+install+relaunch, observed live on the Windows VM) are now FULLY
VERIFIED AND CHECKED, independently re-derived by an opus reviewer (byte-exact
sha512 match against the real published release, live CDP confirmation the
app now reports v0.1.1). AC#3 (LiteLLM proxy restart behavior across the
update) is still open -- it hit a NEW bug, not anything NCOW-20 already fixed:
pm2's connect attempt hangs forever when no pm2 daemon already exists on the
machine (masked on this dev Mac by its own long-running global daemon,
present since before this campaign). The reviewer traced this to three
stacked causes in pm2 itself and how this app packages it (see NCOW-10.3's
full notes and the new NCOW-22 task for the complete technical detail).

Three ready tasks now exist, all wanting live winvm access at some point
(Shared Machine State conflict still applies -- at most one per wave):

- NCOW-10.3's AC#3 retry: the reviewer identified a SPECIFIC unblocker --
  pre-start a real pm2 daemon on winvm (`npm i -g pm2 && pm2 ping`, which
  creates the Windows named pipe `\\.\pipe\rpc.sock` pm2's client polls for)
  BEFORE testing. This is explicitly within this app's own documented design
  assumption (pm2Control.js's header: the app deliberately shares the user's
  default PM2_HOME/daemon) -- NOT a workaround, faithful to the real design.
  With a daemon already present, the app's real pm2-orchestrated start/stop
  should be testable end to end; brief whoever picks this up on the
  unblocker explicitly so they don't rediscover the hang and stall again.
- NCOW-21 (small follow-up from NCOW-20's review: harden cmd.exe
  embedded-quote escaping + doc-comment wording) -- no dependencies, ready,
  unchanged from before wave 5 (not dispatched this session, Shared Machine
  State conflict with NCOW-10.3's own live-VM need this wave).
- NCOW-22 (new, this wave: pm2 cold-bootstrap defect itself -- fix the
  underlying bug, not just retry-around it) -- no dependencies, ready.
  Flagged by the reviewer as likely CROSS-PLATFORM (only Windows has been
  live-tested; macOS/Linux reach of two of the three causes is inferred from
  code, not yet independently verified) and a likely shipping-blocker for
  any genuinely fresh install. One of NCOW-22's own ACs requires explicit
  user sign-off if a fix ever considers dropping pm2 (would reopen the
  AGPL-because-of-pm2 licensing decision) -- do not make that call
  unilaterally if it comes up.

The ready set is recomputed live at restore -- do NOT hardcode a "next wave"
list here. Consider whether NCOW-22 (fixing the real bug) should come before
or after NCOW-10.3's AC#3 retry (using the reviewer's workaround-unblocker) --
the tracker doesn't mandate an order, but doing NCOW-22 first might make the
AC#3 retry moot/redundant since a real fix would let AC#3 pass without the
manual pre-start-a-daemon workaround at all. Worth surfacing to the user as a
sequencing question rather than assuming.
```

## State

| Item | Status |
| --- | --- |
| Campaign tracker | doc-4. NCOW-10.3 stays in Queue (not Resolved — partial: AC1/AC2 checked, AC3 open). NCOW-21 and NCOW-22 both in Queue as ready. |
| `dev` / `origin/dev` | In sync, `09e53fd`, `npm test` last confirmed 235/235 (no code changed this wave — pure verification) |
| Repo visibility | Still PUBLIC (unchanged) |
| Real GitHub Releases | `v0.1.0` and `v0.1.1` still published permanently. **`v0.1.1` is now genuinely installed and verified running on `winvm`** (upgraded live from `v0.1.0` during this wave's real update test) — this is real, useful persistent state for any future winvm work, not scratch to clean up. |
| Windows VM (`winvm`) persistent state | litellm 1.94.1 + a side-by-side x64 Python 3.11 installed (win_arm64 lacks prebuilt wheels for some of litellm's native deps); the app's generated config's `litellm_path` corrected to point at the real `litellm.exe` directly. All scratch/scheduled-tasks/probe artifacts from this wave's investigation were cleaned up; `~/.pm2` and any `PM2_HOME` env override were left exactly as found (reviewer used a throwaway `PM2_HOME` for its own probing). |
| Worktrees / treehouse pool | Both slots in pool `claude-conduit-163fa4` (`/1`, `/2`) released and available |
| Branches | No leftover `feat/NCOW-*`/`fix/NCOW-*` branches, local or remote (wave 5's worktree/branch was released and deleted without merging — zero code changes, pure verification) |
| Open PRs | None from this campaign. One unrelated open PR from another contributor, unchanged, leave alone |
| `.claude/handovers/` | This file (gitignored) |
| `archive/handovers/` | Now contains 8 prior handovers |

## This session's in-flight wave (omit if clean)

(clean — wave 5's worker → reviewer cycle fully settled: AC1/AC2 checked, AC3 recorded as open
with a specific retry unblocker, NCOW-22 filed. No wave dispatched for NCOW-10.3's AC3 retry,
NCOW-21, or NCOW-22 yet.)

## Next steps

1. `/backlog-handover restore` — R1/R2/R3 should find a clean, matching state (no drift). R4
   builds the next wave from {NCOW-10.3 (AC3 retry), NCOW-21, NCOW-22} — all three want live
   winvm access eventually, so Shared Machine State still caps the wave to one of them.
2. Consider proposing to the user (AskUserQuestion, not assumed): does NCOW-22 (the real fix)
   make more sense to do BEFORE NCOW-10.3's AC3 retry (since a real fix might let AC3 pass
   without any manual pre-start-a-daemon workaround at all, making the retry redundant), or
   should the retry happen first since it's cheaper/faster and would fully close out NCOW-10.3
   quickly with the workaround, leaving NCOW-22 as pure hardening for later? Both are reasonable;
   this wasn't decided this session.
3. For whichever is picked: read the task's full current text fresh (`backlog task view
   NCOW-10.3 --plain` or `backlog task view NCOW-22 --plain`) — both already carry complete
   technical detail (the reviewer's full root-cause trace, the three stacked pm2 defects, the
   specific unblocker for a retry-without-fixing approach) that should not be rediscovered from
   scratch.

## Critical context / traps

- **AC1/AC2 of NCOW-10.3 are genuinely, independently confirmed done** — do not re-verify them
  again in a future session; that would be wasted, expensive live-VM work repeating something
  already cryptographically proven (sha512-matched download, live CDP version confirmation).
  Only AC#3 remains open.
- **This dev Mac's own long-running global pm2 daemon (running since before this campaign) has
  silently masked pm2's cold-bootstrap path in EVERY prior live test in this campaign** — any
  future task that claims "pm2/proxy control works, verified on macOS" should be treated with
  suspicion unless it specifically confirms no daemon pre-existed, given what wave 5 found.
- **The pm2-in-Electron bug has three stacked, independently-confirmed causes** (Windows named
  pipe / `pingDaemon` callback gap; `process.execPath` as daemon interpreter; `asarUnpack` missing
  pm2's hoisted dependency closure like `debug`) — a shallow one-line fix attempt for any single
  cause will very likely still fail on the next cause. See NCOW-22's full description before
  attempting a fix.
- **NCOW-10.1's shutdown path already absorbs this hang gracefully** (a 15s timeout + proceed
  anyway) — this is why real updates could still install despite the bug. Don't mistake "the app
  doesn't hang forever on quit" for "the pm2 bug is fine" — the actual proxy-control functionality
  (start/stop/restart via the UI) is still completely broken on a fresh install today.
- **Live-VM-driving via CDP over an SSH-tunneled `--remote-debugging-port`, and scripting through
  non-silent installer wizards via `SetForegroundWindow`+`BM_CLICK` (since plain SSH commands land
  in Session 0 and can't see/interact with the interactive desktop)** — both proven techniques
  this wave, reusable directly for any future winvm UI-driving need.
- **Diskutil safety guidance from wave 4 still applies** — no local disk/volume operations were
  needed or performed this wave, but the rule stands for any future local test-volume work: never
  `unmountDisk`/`eject` on a whole disk identifier, target only the specific volume.
- **`cmd.exe` quoting subtlety from NCOW-20 still applies to NCOW-21** — insist on live winvm
  verification for anything touching that escaping logic, not reasoning-only review.

## Do not repeat

- Do not re-verify NCOW-10.3's AC1/AC2 — already independently confirmed twice over (worker +
  reviewer), done.
- Do not re-ask about repo visibility, versioning strategy, or any decision already settled in
  prior waves/sessions — all still valid, unchanged.
- Do not assume the pm2 hang is Windows-specific or purely cosmetic — the reviewer explicitly
  flagged it as likely cross-platform and likely a real shipping blocker; don't downgrade its
  severity without checking macOS/Linux directly.
- Do not attempt a fix for the pm2-in-Electron bug that only addresses one of the three stacked
  causes without checking whether the other two still block things — read NCOW-22's full
  description first.
- Do not trust an agent's own "I'm stopping"/"I've stopped" self-report as proof it has released
  a shared resource — carried forward from earlier waves, still valid guidance.
