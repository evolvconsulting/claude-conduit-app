# Handover — wave 9 complete (NCOW-23, 25, 26 Done; NCOW-27 filed, HIGH priority)

**Date**: 2026-08-03 | **Grounded against**: `dev` @ `28d9671`, clean, 0 ahead / 0 behind
`origin/dev` | **Tracker**: doc-4

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. Same
campaign round (doc-4). One wave ran last session: wave 9 dispatched NCOW-23,
NCOW-25, NCOW-26 in parallel (3 treehouse worktrees, no file conflicts). All
three implemented, reviewed, and merged (PRs #14, #15, #16). Tests are at
254/254 on dev.

BIG NEWS: NCOW-25's live verification on real aarch64 hardware surfaced a
severe, platform/architecture-INDEPENDENT defect — packaged proxy.start()
fails on EVERY platform this app ships (pm2's managed-app interpreter can't
read app.asar; the same class of problem NCOW-22 already solved for the
DAEMON itself, never extended to the managed app). No prior campaign wave had
ever called proxy.start() from a genuinely packaged artifact before NCOW-25's
verification — every prior "verified live" claim (NCOW-22, NCOW-10.3) was
either a source run or relied on an already-running proxy. This means
v0.1.0 and v0.1.1, as published, have never been proven to actually start
litellm from a real packaged install on any platform.

This was escalated to the user in-session (human_needed) and resolved: user
approved filing it as NCOW-27 (HIGH priority, with the reviewer's full root
cause AND an already-live-validated fix recipe for macOS — see the task
itself) and approved merging NCOW-25 now with AC#3 left honestly partial/
documented rather than holding the branch.

Per this skill's own rule, a human_needed escalation this wave means this
session stopped here rather than dispatching a further wave, even though it
was fully resolved — the user should see it promptly, which happened via
AskUserQuestion, and the tracker/task records already capture the outcome.

Three tasks remain queued, none blocked by a dependency: NCOW-21, NCOW-24
(both need live winvm — CHECK REACHABILITY FIRST via
~/.scripts/winvm.sh "hostname"), and the new NCOW-27 (no VM needed to start —
its own fix is already prototyped, though one of its ACs requires live
Windows verification). Shared Machine State still limits any wave to one
live-Windows task at a time, so at most one of {NCOW-21, NCOW-24, NCOW-27's
Windows-verification step} can run per wave alongside the others.

The ready set is recomputed live at restore — do NOT hardcode a next-wave
list. Queue order confirmed by the user across prior sessions; do not re-ask
about repo visibility, release versioning, the two permanently-published
releases, or any of the "do not re-ask" items already recorded in doc-4.
```

## State

| Item | Status |
| --- | --- |
| Campaign tracker | doc-4. Resolved now also holds NCOW-23, NCOW-25, NCOW-26. Queue holds NCOW-21, NCOW-24, NCOW-27. |
| `dev` / `origin/dev` | In sync at `28d9671`. `npm test` **254/254** verified on merged dev. |
| Merged this session | PR #14 (NCOW-23) → `0b2c7ad`, PR #15 (NCOW-26) → `3ea0fb3`, PR #16 (NCOW-25) → `b06a05e`. |
| New task filed | NCOW-27 (HIGH) — packaged proxy.start() fails on every platform; user-approved, created between waves per this campaign's rules. Has a reviewer-validated fix recipe for macOS already recorded on the task. |
| Worktrees / treehouse | All 3 slots in pool `claude-conduit-163fa4` released and available (pool grew from 2 to 3 on demand this session, no `max_trees` friction). |
| Branches / PRs | No campaign branches (local or remote), no open campaign PRs. |
| Real GitHub Releases | `v0.1.0` and `v0.1.1` still published permanently, untouched. **No new release was published.** Note: both are now known to predate NCOW-27's fix, same as they predate NCOW-22's. |
| `winvm` | Was reachable at this session's start (used by NCOW-23's worker and reviewer). Not re-checked at session end — **re-verify reachability at the start of the next restore** before assuming. |
| `linuxvm` | Reachable, used by NCOW-25's worker and reviewer this session. Reviewer left it clean (no stray processes, no dump.pm2, throwaway artifacts including a fake-home dir containing a plaintext NVIDIA key were all removed). |
| This dev Mac | Only the user's own long-running pm2 daemon (pid 1479, `~/.pm2`) present throughout; multiple subagents created and cleaned up their own throwaway `PM2_HOME`s during testing/mutation-testing — all verified clean at session end. |

## This session's in-flight wave

(clean — nothing in flight. Wave 9 fully settled: all three worktrees released, all three branches deleted, both PRs and the escalation resolved.)

## Next steps

1. `/backlog-handover restore`. R2/R3 should find no drift.
2. Re-check winvm reachability first if picking up NCOW-21 or NCOW-24.
3. Build a wave from {NCOW-21, NCOW-24, NCOW-27}. NCOW-27 is the highest-priority item (HIGH,
   release-blocking, and has a validated fix recipe ready to implement) — likely worth leading
   with, but NCOW-27's own AC#2 (Windows verification) competes with NCOW-21/24 for the single
   live-Windows slot if all three are considered for the same wave. NCOW-27's macOS/Linux fix
   itself needs no VM to implement, only to verify on Windows — consider whether to split its
   implementation (no VM) from its Windows-verification AC (needs winvm) across the wave's
   dispatch if that reduces Shared-Machine-State contention.
4. NCOW-27 also touches configGen.js (NCOW-21's file) — if both are ever in the same wave, treat
   as a real file conflict per the conflict-graph rule, not just a cluster-tag heuristic.

## Critical context / traps

- **No packaged build has ever been proven to actually start the LiteLLM proxy**, on any
  platform, until NCOW-27 lands and is verified. This retroactively qualifies NCOW-10's and
  NCOW-22's "Done" evidence (both correctly scoped to what they set out to prove, but neither
  ever exercised a cold `proxy.start()` from a genuinely packaged artifact) — this caveat is now
  recorded directly on NCOW-10's own Resolved-table entry in doc-4, do not treat it as new
  information needing re-discovery.
- **NCOW-27's fix recipe is already validated live on macOS** (recorded on the task): add
  `interpreter: process.execPath` (as a literal expression, NOT interpolated/frozen at generate
  time — the generated `.cjs` is `require()`'d by whichever binary is currently running the pm2
  client) and `env: { ELECTRON_RUN_AS_NODE: '1' }` (load-bearing — without it, a pre-existing
  daemon this app didn't spawn would boot a second GUI copy of the app on managed-app launch) to
  configGen.js's `renderEcosystemConfigCjs()`'s generated app entry.
- **NCOW-27 has two real open questions, not yet answered**: Windows is completely untested for
  this specific failure (only macOS/Linux were reproduced and fix-verified); and there's a
  genuine unresolved AppImage-packaging question (`process.execPath` inside a running AppImage is
  an ephemeral per-launch FUSE-mounted path, and pm2 persists the interpreter into `dump.pm2`, so
  `pm2 save`/`resurrect`/autorestart-after-quit could reference a dead path post-unmount) that
  entangles with NCOW-24's already-filed daemon-persistence concerns — do not assume either is
  already answered just because the core fix is validated.
- **The package-lock.json version-drift nit (0.1.0 vs 0.1.1) noted since wave 3 is now RESOLVED**
  — fixed incidentally as its own commit during NCOW-25. Don't re-flag it.
- **Do not `pm2 kill` any daemon on any machine, ever** — this bit multiple subagents' mutation
  testing this session (all cleaned up correctly by hand afterward, never via `pm2 kill`).
- A subagent's returned review report for NCOW-23 tripped the harness's own prompt-injection
  pattern-match (tag: "settings-json") this session — on inspection it was a false positive
  (bracket placeholders like `<fakehome>\.claude\settings.json` describing real file paths, not an
  embedded instruction). Flagged transparently to the user per policy; nothing in the report was
  treated as a directive. Mentioning here only so a future session isn't surprised if it happens
  again and needs the same judgment call.
- Diskutil guidance from a much earlier wave still stands: never `unmountDisk`/`eject` a whole
  disk identifier locally.

## Do not repeat

- Do not re-verify NCOW-23/25/26's ACs — all closed with independently-reproduced live evidence
  (see doc-4's Resolved table and each task's own notes for exactly what was confirmed and how).
- Do not re-ask about repo visibility, release versioning, the two permanent releases, the queue
  order, or the package-lock.json drift (now fixed) — all settled and still valid.
- Do not publish a GitHub Release or push a tag without explicit user authorization.
- Do not assume NCOW-27's fix is "already done" just because a validated recipe exists on the
  task — no code has been written for it yet; it is a fresh To Do item.
- Do not trust an agent's self-report that it cleaned up a shared resource (linuxvm's throwaway
  fake-home dir was left behind by the worker despite claiming otherwise; the reviewer caught and
  fixed it) — verify.
