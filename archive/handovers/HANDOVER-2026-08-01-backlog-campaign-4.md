# Handover — backlog campaign wave 3 done (waves: 3, tasks: NCOW-16, NCOW-17, NCOW-18, NCOW-12)

**Date**: 2026-08-01 | **Grounded against**: `dev` @ `d43f8c6b193ac5b39d0a5a6c6a218446286d7475`,
clean, 0 ahead/0 behind `origin/dev` | **Tracker**: doc-3

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. 3 waves
completed so far (wave 1: NCOW-16 via PR #2; wave 2: NCOW-17 + NCOW-18 via
PR #4 and PR #3; wave 3: NCOW-12 via PR #5). Queue order confirmed by the
user on 2026-08-01. NCOW-19 (small, no deps, no live verification) is next
and needs no further ordering confirmation. NCOW-9 (deps: NCOW-12) is newly
unblocked -- read its full task detail fresh at restore, it has not been
scoped/conflict-checked yet this campaign. The ready set is recomputed live
at restore -- do NOT hardcode a "next wave" list here; the tracker (doc-3)
is the source of truth.

Locked decisions (see doc-3's "Confirmed at init/restore #2/restore #3"
sections for the full record, still valid, do not re-ask):
- NCOW-14 and NCOW-15 stay excluded from this campaign -- both need subtask
  splitting first, out of scope for a wave dispatch.
- NCOW-12's GitHub repo rename (evolvconsulting/nvidia-cowork ->
  claude-conduit) was, and remains, a MANUAL step nobody has run yet --
  the code-level rename is done and merged, but the actual `gh repo rename`
  has NOT happened. This machine's git remote still points at
  evolvconsulting/nvidia-cowork. Don't assume it's done; don't run it
  autonomously either -- surface it to the user if a future task's scope
  depends on the repo already being renamed.
- `origin/dev` is the real, full mainline. All wave worktrees fork from
  `dev`.
```

## State

| Item | Status |
| --- | --- |
| Campaign tracker | doc-3, updated through wave 3 settlement |
| Wave 1 (NCOW-16) | Done. Merged via PR #2 (squash `a56b156`) |
| Wave 2 (NCOW-17, NCOW-18) | Done. Merged via PR #3 (squash `e80b263`) then PR #4 (squash `3cdd1f9`) |
| Wave 3 (NCOW-12) | Done. Merged via PR #5 (squash `5b507e9`) after a `request_changes` → fix → `approve` review cycle, plus one small trailing doc-count fix. AC#5's real-machine leg was completed live this session under the user's explicit supervision — see Critical context. |
| This machine's real state | Now genuinely migrated to the Claude Conduit identity (`~/.config/claude-conduit`, real Claude Desktop entry relabeled, real API key re-entered). This was a deliberate, user-approved live pass, not incidental drift — see Critical context before assuming anything about this machine's config layout. |
| GitHub repo rename | Still NOT done — `evolvconsulting/nvidia-cowork` is unchanged. Manual, out-of-band, per the locked decision. |
| `dev` / `origin/dev` | In sync, `d43f8c6`, `npm test` 176/176 pass |
| Treehouse pool | 2 worktree slots (`claude-conduit-2dea77/1` and `/2`), both released back to `available`, both warm |
| `.claude/handovers/` | This file (gitignored) |
| `archive/handovers/` | Previous handover archived here this session as `HANDOVER-2026-08-01-backlog-campaign-3.md` (collision suffix — two already existed from waves 1/2) |

## This session's in-flight wave (omit if clean)

(clean — wave 3 fully settled, nothing in flight, no open campaign PRs, no leftover branches/worktrees)

## Next steps

1. `/backlog-handover restore` — R1/R2/R3 should find a clean, matching state (no drift). R4
   builds wave 4 live: NCOW-19 is ready (no deps, no conflicts known) — low-risk, single-file
   test fix, no live verification needed, can very likely be dispatched immediately without
   another AskUserQuestion round given how narrow it is. NCOW-9 is newly unblocked (deps:
   NCOW-12 resolved this wave) but has NOT been read/scoped/conflict-checked yet this campaign —
   do that fresh with `backlog task view NCOW-9 --plain` before deciding whether it's wave-4
   material or needs its own AskUserQuestion round (it may have its own live-verification or
   sensitive-state requirements; don't assume it's simple just because NCOW-19 is).
2. Check whether NCOW-19 and NCOW-9 conflict on files before deciding whether to pair them in
   one wave or run them separately — don't assume either way; re-run the file-citation check
   fresh, same discipline as every prior wave.
3. NCOW-10 remains blocked on real code-signing certificates (external/human-provisioned) —
   still not reachable by an agent alone, independent of NCOW-9/NCOW-12 now being resolved.

## Critical context / traps

- **This machine's real state changed this session, deliberately and with explicit user
  consent at two checkpoints.** NCOW-12's AC#5 ("verified against a real pre-rename install")
  could not be honestly satisfied by any worker (per the campaign's own safety rules), so the
  *orchestrator itself* ran the live pass, narrating and getting explicit go-ahead before the
  actual destructive step (per this environment's "hard-to-reverse action" guidance, not just
  the skill's escalation policy). Sequence: took backups first
  (`~/claude-conduit-ncow12-verification-backup-20260801-145438` plus the app's own automatic
  `configLibrary.bak.claude-conduit.*` backup), built a fresh `npm run pack` output, launched it
  directly against real state (no `NIM_PROXY_TEST_HOME`), drove it via CDP over
  `--remote-debugging-port` (per `CLAUDE.md`'s documented pattern — note the two traps that
  bit an earlier attempt this session and cost real time: (1) `process.env.X` set via a bare
  `VAR=val` bash assignment does NOT reach a child `node -e` process unless `export`ed first —
  cost one wasted validate-API-key round-trip where the literal string `"undefined"` got typed
  into the field instead of the real key; (2) the "Apply Gateway Config" button opens this
  project's own custom `<dialog>`-based confirm modal per the `window.confirm` ban in
  `CLAUDE.md` — a plain button click alone does nothing until the dialog's own confirm button
  is also clicked, which looks like a silent no-op if you don't check for an open `<dialog>`).
  End state, fully verified: config dir renamed + paths repaired, key correctly failed to
  decrypt on macOS (expected, Keychain app-name scoping) and was re-entered from `.env`'s real
  key, Claude Desktop entry relabeled with **zero duplication** and a fresh auto-backup, pm2
  shut down cleanly on quit. **User explicitly chose to leave the machine in this migrated
  state** rather than restore from backup — do not "helpfully" revert it in a future session.
- **The GitHub repo itself is still `evolvconsulting/nvidia-cowork`** — only the code-level
  rename landed. If a future task's scope assumes the repo is already renamed (e.g. NCOW-9's
  "publish and install story"), that assumption needs checking against reality, not the
  campaign's own prior code changes.
- **Merge order within a wave is not always safe to leave at the tracker's listed order** (a
  wave-2 lesson, still valid, restated for continuity): when one branch changes a value
  something else's test asserts against, check whether merge *order* matters, not just
  eligibility, before assuming the tracker's listed order is binding.
- **A `request_changes` → fix → re-review cycle is normal and expected**, not a wave failure.
  Wave 3's reviewer found a real, reproducible edge case (narrow, LOW severity) on pass 1; the
  fix pass addressed it with a test that reproduces the exact scenario; pass 2 independently
  *mutation-tested* the fix (reverted it, confirmed the new test fails as expected) before
  approving — that mutation-testing step caught nothing wrong here, but it's a good pattern to
  expect/encourage from reviewers on future waves, not something to prompt for explicitly (it
  emerged on its own).
- **AskUserQuestion for decide-vs-defer moments continues to be the right pattern** — used
  three times this wave alone (file-conflict-check finding vs. the prior handover's assumption
  → pairing decision; go/no-go on the live real-machine pass; final disposition of the migrated
  state). Keep defaulting to it for anything genuinely product-level, irreversible, or touching
  real user data, exactly as the skill's escalation policy specifies.

## Do not repeat

- Don't trust a bare `VAR=value` bash assignment to reach a `node -e '...'` child process's
  `process.env` — it needs `export` first, or use `env VAR=value node -e ...`. Cost one wasted
  round-trip confirming a real API key was "rejected" when it was never actually sent.
- Don't assume a button click in this app's UI completed an action without checking for an open
  `<dialog>[open]` element afterward — several of this app's write actions are gated behind the
  project's own custom confirm modal (never `window.confirm`, per `CLAUDE.md`), and a plain
  click on the triggering button alone is a silent no-op until the modal's own confirm button is
  also clicked.
- Don't skip independently verifying a worker's/reviewer's safety claims about untouched real
  machine state — read-only checking this machine's actual files (mtimes, content) directly is
  cheap and is what caught nothing wrong in wave 3, which is exactly the point of doing it every
  time, not just when something looks suspicious.
