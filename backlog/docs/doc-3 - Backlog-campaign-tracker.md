---
id: doc-3
title: Backlog campaign tracker
type: other
created_date: '2026-08-01 00:06'
updated_date: '2026-08-01 00:06'
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

## Frontier

The "ready now" set is ALWAYS recomputed live from the Backlog task list + this table
at the start of every restore/wave — never trust a persisted "next wave" plan.
As of init (2026-07-31): 2 ready now (NCOW-16, NCOW-12), 1 blocked-but-tracked (NCOW-9), 6 not
queued.

## Queue (confirmed order)

| # | Task ID | Cluster | Deps (mirrors each task's real `dependencies` field) | Status | Wave | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | NCOW-16 | diagnostics | (none) | To Do | | ready now |
| 2 | NCOW-12 | rebrand | (none) | To Do | | ready now; repo rename stays manual (see above) |
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

- <date> — wave N (tasks: <task-ids>): <what happened per task, any
  request_changes/escalate verdicts (reviewer's stated reasoning) and how they
  resolved, merged SHAs, any wave-level integration-review finding>
