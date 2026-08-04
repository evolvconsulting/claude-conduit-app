---
id: doc-5
title: Backlog campaign tracker
type: other
created_date: '2026-08-04 20:04'
updated_date: '2026-08-04 20:58'
---
# Backlog campaign tracker

Protocol: restore → compute the ready/conflict graph → mark the wave Dispatched
→ dispatch (parallel workers + review) → serialize the merge →
update this tracker once more at settlement → loop until the queue is empty or
blocked → write handover.

Driven by the `backlog-handover` skill (`.claude/skills/backlog-handover/SKILL.md`). This is a
new campaign round following the prior one (see `doc-4`, now complete — waves 1-15, all of
NCOW-9/10/12/16/17/18/19 and NCOW-31 Done there). This round exists specifically because
NCOW-31's own two review passes filed five follow-up tasks (NCOW-32 through NCOW-36) that
doc-4's inventory predates.

## Confirmed at init (2026-08-04) — do not re-ask

Fresh inventory of all 10 open Backlog tasks (`backlog task list --exclude-status Done`) at
this init: NCOW-7, NCOW-11, NCOW-13, NCOW-14, NCOW-15, NCOW-32, NCOW-33, NCOW-34, NCOW-35,
NCOW-36. Classification:

- **NCOW-32 through NCOW-36 are queued.** All five are follow-ups filed directly from
  NCOW-31's review passes, each names a concrete, objectively-verifiable acceptance criteria
  set, and each depends only on NCOW-31, which is Done — none blocked.
- **NCOW-7, NCOW-11, NCOW-13, NCOW-14, NCOW-15 remain excluded, unchanged since doc-4's
  round (all last updated 2026-07-31, before this init).** Re-checked fresh rather than
  trusted from the old tracker — still correctly not agent-resolvable as filed:
  - NCOW-7: explicitly PARKED (its own implementation notes) pending NCOW-15, since NCOW-13/15
    would likely make a rebuilt wizard structure throwaway work.
  - NCOW-11: has an open, unresolved design question (where do usage metrics actually come
    from against a stock, database-free LiteLLM install) that must be answered before the
    work is even scopeable.
  - NCOW-13: depends on NCOW-14, which is itself undecomposed.
  - NCOW-14: its own description says "Expect this to want splitting into subtasks when it is
    picked up" — a deep, multi-provider abstraction, not a single agent-sized unit.
  - NCOW-15: same self-described need to split into subtasks, plus multiple undecided design
    questions (single vs. multi-proxy, client-config-on-switch behavior).
  These five need a separate planning/decomposition session before a future campaign round
  can queue them — not something this round can resolve.

## Confirmed queue order (2026-08-04) — do not re-ask

User confirmed the proposed order: docs-only and comment-only fixes first (lowest risk,
zero/near-zero behavior change), then isolated hardening, then the tray refactor (structural
but well-scoped, precedent in menu.js), then the mutex-serialization change (most
behaviorally significant, touches live uninstall/auto-update proxy-stop paths) last.

## Frontier

The "ready now" set is ALWAYS recomputed live from the Backlog task list + this table
at the start of every restore/wave — never trust a persisted "next wave" plan.
As of wave 1 dispatch (2026-08-04): 4 dispatched (NCOW-34/33/36/35), 1 ready-but-deferred
(NCOW-32, held out of wave 1 by conflicts), 0 blocked, 5 excluded pending human decomposition
(see Not queued).

Wave 1 conflict graph (file-citation read against real code, not just cluster labels):
NCOW-34 = README.md/DESIGN.md only. NCOW-33 = engine-context.js comment only (lines ~187-204).
NCOW-36 = src/engine/configGen.js only. NCOW-35 = src/main/tray.js (new/extracted factory) +
src/main/index.js (createTray call site, ~lines 174-197) + a new/updated test file. NCOW-32 =
src/main/engine-context.js (uninstall handler, ~lines 521-527) + src/main/index.js (autoUpdate's
stopProxyForShutdown wiring, ~lines 102-130) + possibly src/main/autoUpdate.js. Confirmed
conflicts: NCOW-32↔NCOW-33 (both touch engine-context.js — matches the prior round's note) AND
**NCOW-32↔NCOW-35 (both touch src/main/index.js — a new finding this restore; index.js already
destructures `mutexes` from createEngineContext and uses it in the tray creation block, so
NCOW-32's mutex-wrap of the autoUpdate stopProxyForShutdown call and NCOW-35's tray-factory
extraction are two edits to the same file)**. NCOW-34/33/36/35 are mutually conflict-free
(4 disjoint file sets) and form wave 1; NCOW-32 is deferred to wave 2 regardless — it would
have been excluded by the engine-context.js conflict with NCOW-33 alone, but the index.js
finding means it stays deferred as a solo wave 2 even after wave 1 fully lands.

None of wave 1's four tasks require live-verifying the running app/proxy (NCOW-35's new
behavioral test fakes electron in require.cache the way `ipc-mutex.test.js` already does,
per its own AC #1 — no live app needed) — no Shared Machine State conflicts this wave.

## Queue (confirmed order)

| # | Task ID | Cluster | Deps (mirrors each task's real `dependencies` field) | Status | Wave | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | NCOW-34 | docs | NCOW-31 (Done) | Dispatched | 1 | README/DESIGN.md doc-only update, no code |
| 2 | NCOW-33 | proxy-mutex | NCOW-31 (Done) | Dispatched | 1 | Comment-only correction in engine-context.js, no behavior change |
| 3 | NCOW-36 | configgen | NCOW-31 (Done) | Dispatched | 1 | Harden thrown-value logging guard against unstringifiable throws |
| 4 | NCOW-35 | tray | NCOW-31 (Done) | Dispatched | 1 | Extract tray actions into a testable factory, matching menu.js precedent |
| 5 | NCOW-32 | proxy-mutex | NCOW-31 (Done) | To Do | | Serialize Uninstall + auto-update proxy-stop against the shared proxy mutex — deferred to wave 2 (conflicts with NCOW-33 via engine-context.js AND NCOW-35 via index.js) |

## Resolved

| # | Task ID | Status/date/wave | Evidence summary |
| --- | --- | --- | --- |

## Not queued — needs a human / blocked

- NCOW-7: PARKED pending NCOW-15 (own implementation notes, 2026-07-31) — rebuilding the
  Setup wizard now would likely be thrown away once NCOW-13/15 land.
- NCOW-11: open design question unresolved — where usage metrics come from against a stock,
  database-free LiteLLM install is not yet established, so the work isn't scopeable yet.
- NCOW-13: depends on NCOW-14, which is itself undecomposed — not resolvable until NCOW-14 is
  split and at least partly landed.
- NCOW-14: self-described as needing decomposition into subtasks before it's agent-sized; a
  deep multi-provider abstraction, not a single unit of work.
- NCOW-15: same — self-described need to split into subtasks, plus undecided design
  questions (single vs. multi-proxy, client-config-on-switch behavior) that need a human
  product decision first.

## Wave log

- 2026-08-04 — wave 1 dispatched (tasks: NCOW-34, NCOW-33, NCOW-36, NCOW-35): ground-truth
  drift check found no leftover branches/worktrees/PRs from prior init; treehouse pool had 3
  available (unleased) trees. File-citation conflict read found a new NCOW-32↔NCOW-35
  conflict via src/main/index.js not previously noted (see Frontier). Wave dispatch in
  progress — worktree setup and worker dispatch follow this tracker update.
