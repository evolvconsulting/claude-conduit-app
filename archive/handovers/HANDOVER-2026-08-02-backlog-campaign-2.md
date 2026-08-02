# Handover — NCOW-10 auto-update campaign, waves 1-2 done (waves: 2, tasks: NCOW-10.1, NCOW-10.2)

**Date**: 2026-08-02 | **Grounded against**: `dev` @ `dc28048c8810d9d111a8b3b0c89456c260f12ee1`,
clean, 0 ahead/0 behind `origin/dev` | **Tracker**: doc-4

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. This is
the same campaign round (doc-4) as the prior handover -- 2 waves completed
this session, NCOW-10.1 and NCOW-10.2 both Done and merged (PR #9 -> dev
@6633b4a, PR #10 -> dev @0325e2c). The ready set is recomputed live at
restore -- do NOT hardcode a "next wave" list here, but as of this writing
the only remaining queued item is NCOW-10.3 (real end-to-end auto-update
install verification on Windows and/or Linux), now unblocked (both its
deps -- NCOW-10.1, NCOW-10.2 -- are Done). No task-splitting or
re-scoping decision needed this time -- NCOW-10.3 was already sized as its
own task at restore 1.

Read NCOW-10.3's full detail fresh with `backlog task view NCOW-10.3
--plain` before dispatching (already read once, but re-read per the
skill's own R4a discipline -- and its scope may want re-confirming given
what wave 2 discovered, see Critical context below).

Standing user authorization from campaign init carries forward: this
round has explicit approval to publish real, unsigned GitHub Releases on
evolvconsulting/claude-conduit during implementation/verification. Wave 2
already exercised this twice (clearly-labeled `v0.0.0-ci-smoketest` tag,
cleaned up both times) without needing to re-ask -- the same standing
authorization covers NCOW-10.3's real install-and-update verification.
```

## State

| Item | Status |
| --- | --- |
| Campaign tracker | doc-4, NCOW-10.1 and NCOW-10.2 moved to Resolved this session with full evidence; NCOW-10.3 is the sole remaining Queue row, marked ready |
| `dev` / `origin/dev` | In sync, `dc28048`, `npm test` confirmed 220/220 at wave 2 settlement |
| Worktrees / treehouse pool | Both slots in pool `claude-conduit-163fa4` (`/1`, `/2`) released and available |
| Branches | No leftover `feat/NCOW-*`/`fix/NCOW-*` branches, local or remote — both wave branches deleted post-merge |
| Open PRs | None from this campaign. One unrelated open PR exists from another contributor (`tturnerevolv:feat/spec-rev3-and-test-harness`) — not part of this campaign, leave alone |
| `.claude/handovers/` | This file (gitignored) |
| `archive/handovers/` | Now contains 5 prior handovers from this and the last round (`HANDOVER-2026-08-01-backlog-campaign.md` through `-5.md`) |

## This session's in-flight wave (omit if clean)

(clean — no wave dispatched this session, nothing in flight)

## Next steps

1. `/backlog-handover restore` — R1/R2/R3 should find a clean, matching state (no drift). R4
   builds the next wave: NCOW-10.3 is the only ready task. Since it's a solo wave member with
   no conflicts (nothing else is queued), dispatch it directly — no AskUserQuestion needed for
   wave composition this time.
2. NCOW-10.3's original ACs (from the campaign tracker's restore-1 notes): "Platforms where
   silent/auto-update is possible actually download and install a newer version end-to-end,
   observed live" and "Verified by installing an older version and updating to a newer one on
   at least one platform, with evidence captured," plus confirming the LiteLLM proxy's defined
   restart behavior holds across a real update. Read the task's live current text with
   `backlog task view NCOW-10.3 --plain` before dispatch — don't trust this summary.
3. This is real, externally-visible, higher-stakes work than waves 1-2: it requires actually
   installing an OLDER built version of the app on a real machine (or VM), then using the now-
   merged CI workflow (NCOW-10.2) to cut a real release the older install should detect and
   silently update from, and observing that it actually happens. Narrate this clearly, same
   category of care as the smoke-test releases in wave 2 — those didn't need a fresh ask
   (standing authorization already covers it), but if anything about NCOW-10.3's execution
   goes beyond "install old, publish new, watch it update, clean up" (e.g. needing to tag a
   real-looking version number, or leaving artifacts around longer than a smoke test would),
   pause and check with the user rather than assuming.

## Critical context / traps

- **A worker in wave 2 found and fixed a genuine Windows production bug** in
  `src/engine/configDirMigration.js` (JSON.stringify's backslash-escaping meant the
  legacy-directory migration silently never rewrote `run.js`/`ecosystem.config.cjs` on
  Windows) — this is now fixed and merged, but it's a good reminder that NCOW-10.3's real
  install verification is exactly the kind of check that catches this class of defect. If
  NCOW-10.3 tests an *upgrade* scenario (old install → new install, not just a fresh
  install), and that old install predates NCOW-12's rename, the migration path is now
  correct — but this hasn't been verified end-to-end with a real installer, only with unit
  tests. Worth keeping in mind when scoping NCOW-10.3's exact test scenario.
- **A real, documented, non-blocking gap exists in the release pipeline**: electron-builder
  26.15.3 has an upstream bug where the macOS zip target's `.blockmap` sidecar publishes
  with a corrupted (period instead of hyphen) filename even through `--publish always` —
  documented in `docs/distribution.md`. This does NOT affect `latest*.yml` and is confirmed
  non-load-bearing today because macOS auto-update is notify-only (per NCOW-10.1) — but if
  NCOW-10.3's scope ever expands to test macOS's real silent-update path (it currently
  shouldn't, since macOS is intentionally notify-only pending signing certs), this is a
  known landmine to check first.
- **A concurrency incident happened in wave 2 and is now understood, not just patched
  around**: a worker agent that was told to stand down (because a second instance had
  picked up its work) kept running silently in the background rather than actually
  stopping, and briefly clobbered the second instance's uncommitted edits in their shared
  worktree. It was only caught because the orchestrator cross-checked real CI-log evidence
  directly instead of trusting either agent's self-report of "done" or "stopped." **Lesson
  for the next session**: when resuming/redirecting an agent mid-task (not just at
  dispatch), don't fully trust a "stopping now" acknowledgment — verify via `TaskStop`
  (which returns a definitive kill confirmation) if there's any real risk of a second
  writer touching the same worktree concurrently, rather than assuming a polite message
  achieved the stand-down.
- **CI run polling is unreliable via Monitor in this environment** — the `Monitor` tool's
  polling script kept failing with a bare exit 1 for unclear reasons (possibly a jq/gh
  transient issue in the sandboxed shell) across multiple attempts in wave 2. What
  reliably worked instead: `Bash` with `run_in_background: true` running a plain `until [
  "$(gh run view <id> ... --jq .status)" = "completed" ]; do sleep 15; done` loop — a single
  clean completion notification, no repeated flakiness. Prefer that pattern over `Monitor`
  for watching a single GitHub Actions run to completion.
- **`jq`/`git` occasionally "command not found" inside a single compound `Bash` call
  chaining a `treehouse get --lease --json` capture into `jq`/`git` in the same command
  block** — happened twice in this session for unclear reasons (PATH looked fine when
  checked in a separate call). Workaround that worked reliably: split `treehouse get
  --lease` into its own call, read the printed `path`/`lease_id` directly from that
  command's own stdout (it prints the JSON as its actual output, not just via a variable
  capture), and use those literal values in subsequent separate `Bash` calls rather than
  chaining everything through shell variables in one large heredoc/`$(...)` block.

## Do not repeat

- Do not re-ask the user whether the campaign may publish real unsigned GitHub Releases —
  this was confirmed at init and re-exercised twice in wave 2 without incident.
- Do not trust an agent's own "I'm stopping" / "I've stopped" self-report as proof it has
  actually released a shared worktree — use `TaskStop` for a real kill confirmation before
  treating a worktree as single-writer again.
- Do not use `Monitor` for a single "wait until this one CI run finishes" — use `Bash` with
  `run_in_background: true` and an `until` loop instead (see Critical context above).
