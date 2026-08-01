---
id: doc-3
title: Backlog campaign tracker
type: other
created_date: '2026-08-01 00:06'
updated_date: '2026-08-01 00:14'
---
# Backlog campaign tracker

Protocol: restore → compute the ready/conflict graph → mark the wave Dispatched
→ dispatch (parallel workers + review) → serialize the merge →
update this tracker once more at settlement → loop until the queue is empty or
blocked → write handover.

Driven by the `backlog-handover` skill (`.claude/skills/backlog-handover/SKILL.md`).

## Confirmed at init (2026-07-31) — do not re-ask

- Queue order: NCOW-16 before NCOW-12.
- NCOW-14 and NCOW-15 are deliberately EXCLUDED from this campaign. Both explicitly need
  splitting into subtasks before they're wave-sized (their own task descriptions say so), and
  NCOW-14 needs a live OpenRouter credential of unknown availability for AC#3/#10. Scoping them
  is a separate planning session, not a campaign wave. Consequently NCOW-11 (deps: NCOW-15) and
  NCOW-13 (deps: NCOW-14) cannot become ready inside this campaign either — see Not queued.
- NCOW-12's GitHub repo rename (evolvconsulting/nvidia-cowork → claude-conduit) stays a MANUAL
  step outside the wave loop — no worker or the orchestrator itself runs `gh repo rename`
  autonomously. Every code-level rename (package.json, appId, REPO_URL, docs, icons, etc.) is
  in scope for the wave; the actual repo rename is not.

## Resolved at restore #1 (2026-08-01) — base-branch fix

`origin/dev` and `origin/main` were both stuck at the bare initial commit (DESIGN.md only) —
the entire codebase, tests, and Backlog task store (including this tracker) existed only on
the local, never-pushed `feat/nim-proxy-manager` branch. User chose (AskUserQuestion) to
`git push origin feat/nim-proxy-manager:dev` (clean fast-forward, no force needed), then the
orchestrator fast-forwarded its own local `dev` checkout to match and switched onto it. `dev`
is confirmed as GitHub's registered default branch. All future wave worktrees fork from `dev`
per the skill's normal convention — no more deviation needed.

## Frontier

The "ready now" set is ALWAYS recomputed live from the Backlog task list + this table
at the start of every restore/wave — never trust a persisted "next wave" plan.
As of restore #1, wave 1 (2026-08-01): NCOW-16 and NCOW-12 are both ready (no deps), but both
require live-verifying the running proxy/app against the real NVIDIA account or a real
pre-rename install (Shared Machine State — at most one live-verification task per wave).
Wave 1 = NCOW-16 alone, per confirmed queue order; NCOW-12 follows in wave 2. NCOW-9 remains
blocked on NCOW-12.

## Queue (confirmed order)

| # | Task ID | Cluster | Deps (mirrors each task's real `dependencies` field) | Status | Wave | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | NCOW-16 | diagnostics | (none) | Dispatched | 1 | needs live proxy verification (AC#2) — only live-verification task this wave |
| 2 | NCOW-12 | rebrand | (none) | To Do | | ready now; deferred to wave 2 (shared-machine-state conflict with NCOW-16 this wave); repo rename stays manual |
| 3 | NCOW-9 | release | NCOW-12 | Blocked | | unblocks once NCOW-12 resolves |

## Resolved

| # | Task ID | Status/date/wave | Evidence summary |
| --- | --- | --- | --- |

## Not queued — needs a human / blocked

- NCOW-7: blocked on NCOW-15, which is deliberately excluded from this campaign (see Confirmed
  at init). Also explicitly PARKED by a prior-session decision recorded on the task itself —
  revisit after NCOW-15 is scoped/done separately.
- NCOW-10: needs real code-signing certificates (external/human-provisioned) before its ACs
  (a real install→update end to end) can be genuinely verified by an agent. Also depends on
  NCOW-9 and NCOW-12 (dependency graph), so not reachable this campaign regardless.
- NCOW-11: depends on NCOW-15, deliberately excluded from this campaign (see Confirmed at
  init). Revisit once NCOW-15 is scoped/done separately.
- NCOW-13: depends on NCOW-14, deliberately excluded from this campaign (see Confirmed at
  init). Revisit once NCOW-14 is scoped/done separately.
- NCOW-14: too large for a single wave dispatch — the task's own description says "expect this
  to want splitting into subtasks when it is picked up" (10 ACs spanning nearly every engine
  module). AC#3/#10 need a live OpenRouter credential of unknown availability. Excluded from
  this campaign per the 2026-07-31 decision — needs a separate planning/decomposition session.
- NCOW-15: same reasoning as NCOW-14 (its own description: "expect to split this into subtasks
  when it is picked up"), and depends on NCOW-14 besides. Excluded per the same decision.

## Wave log

- 2026-08-01 — wave 1 dispatch (task: NCOW-16): worktree/branch setup in progress; worker +
  reviewer dispatch to follow. (This entry will be replaced by the full wave-1 settlement entry
  at R4i.)
