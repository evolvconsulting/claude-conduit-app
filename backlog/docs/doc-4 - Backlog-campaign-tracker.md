---
id: doc-4
title: Backlog campaign tracker
type: other
created_date: '2026-08-02 00:16'
updated_date: '2026-08-02 01:09'
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
  deps already satisfied).
- **NCOW-10.2** — CI release workflow publishing artifacts + update metadata (orig. AC#6).
  `--dep NCOW-9` (already Done).
- **NCOW-10.3** — real end-to-end verification on Windows and/or Linux (orig. AC#3, #8).
  `--dep NCOW-10.1 --dep NCOW-10.2`.

File-conflict note: both NCOW-10.1 and NCOW-10.2 cite `docs/distribution.md` (10.1 as a
reference for its mechanism-decision doc, 10.2's AC#4 explicitly requires editing it to point at
the new CI workflow) — treated as a real shared-file conflict per this skill's conflict-graph
rule, not dispatched in the same wave. NCOW-10.1 goes first (more foundational, no dependency on
CI); NCOW-10.2 is expected to be wave 2, rebased on top of NCOW-10.1's merged doc edits.

## Frontier

The "ready now" set is ALWAYS recomputed live from the Backlog task list + this table at the
start of every restore/wave — never trust a persisted "next wave" plan.
As of restore 1, wave 1 (2026-08-02): NCOW-10.1 dispatched alone (file-conflict with NCOW-10.2
on docs/distribution.md — see above). NCOW-10.2 is otherwise ready now (dep NCOW-9 satisfied) and
expected to be wave 2. NCOW-10.3 blocked on both.

## Queue (confirmed order)

| # | Task ID | Cluster | Deps (mirrors each task's real `dependencies` field) | Status | Wave | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | NCOW-10 | release | NCOW-9 (done), NCOW-12 (done) | Split | | epic; split into 10.1/10.2/10.3 at restore 1, see above |
| 2 | NCOW-10.1 | release | (none — parent's deps already satisfied) | Dispatched | 1 | mechanism + in-app checker + proxy-restart |
| 3 | NCOW-10.2 | release | NCOW-9 (done) | To Do | | CI release workflow; conflicts with 10.1 on docs/distribution.md, deferred to wave 2 |
| 4 | NCOW-10.3 | release | NCOW-10.1, NCOW-10.2 | To Do | | real end-to-end verification; blocked until both land |

## Resolved

*(none yet this round — see `doc-3` for the prior round's full Resolved table: NCOW-16, 18, 17,
12, 19, 9 all Done across 4 waves)*

| # | Task ID | Status/date/wave | Evidence summary |
| --- | --- | --- | --- |

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

- 2026-08-02 — wave 1 setup (task: NCOW-10.1): NCOW-10 split into NCOW-10.1/10.2/10.3 per user
  decision at restore. NCOW-10.1 marked Dispatched, In Progress; worker dispatch follows.
