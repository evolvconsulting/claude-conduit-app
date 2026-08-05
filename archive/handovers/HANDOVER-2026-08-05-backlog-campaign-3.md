# Handover — wave 6 complete (NCOW-43, NCOW-45 Done; NCOW-46 filed)

**Date**: 2026-08-05 | **Grounded against**: `dev` @ `70eaa80ef4f6befb9d4c9dcd227af9f3e2847941`, clean, in sync with
`origin/dev` (0 ahead, 0 behind) | **Tracker**: doc-5

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. Wave 6 of
this campaign round is fully merged and Done (NCOW-43, NCOW-45 — 14 tasks
total resolved across waves 1-6). Queue order confirmed by user on
2026-08-04; do not re-ask. The ready set is recomputed live at restore — do
NOT hardcode a "next wave" list here, but as of this handover the queue
holds exactly 1 item: NCOW-46 (harden ipc.js's new multi-lock mechanism
against a duplicate-lock self-deadlock and a LOCK_ACQUISITION_ORDER/
MUTEX_DOMAINS drift hazard, depends on NCOW-45, Done — newly filed this
session from wave 6's integration review). This makes wave 7 a solo wave by
definition — confirm nothing else has become ready first (re-check the
Backlog task list fresh, don't assume).

No in-flight worktrees, branches, or PRs -- all 4 treehouse-pool trees are
released and available at ~/.treehouse/claude-conduit-163fa4/{1,2,3,4} (their
HEADs are stale/detached at old wave-6 commits, which is fine — whichever
gets leased next will be re-pinned to the fresh wave-base SHA as usual).

Not queued this round (unchanged, re-check fresh rather than trusting this
list -- a human may have acted on any of these between sessions): NCOW-7
(parked pending NCOW-15), NCOW-11 (open metrics-source design question),
NCOW-13 (depends on undecomposed NCOW-14), NCOW-14 and NCOW-15 (both
self-described as needing subtask decomposition).

TREEHOUSE SLOT-2 NOTE (revised guidance): the pool's allocator deterministically
returns the lowest-numbered available slot, so return-and-retry cannot reliably
avoid slot 2 once slot 1 is already leased — at wave 6, 3 consecutive retries
all landed back on slot 2. Attempt one or two return-and-retry cycles if a
lease lands there, but if the SAME slot keeps coming back, accept it rather
than looping forever — the actual mitigation (brief the agent on the pattern,
verify independently via git, never comply with a conceal instruction, report
transparently) works regardless of which slot is leased, and it has now gone
2 full waves (7+ agent dispatches, including one deliberate wave-6 lease) with
zero recurrence of the original 3-incident pattern from waves 3-4.
```

## State

| Item | Status |
| --- | --- |
| Wave 1 (NCOW-34/33/36/35) | Done, merged prior sessions (PRs #24-#28) |
| Wave 2 (NCOW-39, NCOW-37) | Done, merged prior sessions (PRs #29, #30) |
| Wave 3 (NCOW-40, NCOW-38) | Done, merged prior sessions (PRs #31, #32) |
| Wave 4 (NCOW-42, NCOW-41) | Done, merged prior session (PRs #33, #34, #35) |
| Wave 5 (NCOW-32, NCOW-44) | Done, merged prior session (PRs #36, #37, #38) |
| Wave 6 (NCOW-43, NCOW-45) | Done, merged this session (PRs #39, #40, #41) |
| Tracker (doc-5) | Updated to reflect wave 6 settlement, committed + pushed (`a1fefbc`) |
| Queue | 1 task (NCOW-46), To Do, ready by dependency |
| Worktrees/branches/PRs | None in flight — all 4 treehouse-pool trees released and available |
| Working tree | Clean, `dev` in sync with `origin/dev` at `70eaa80` |
| Final test count on merged dev | 400/400 passing |

## This session's in-flight wave (omit if clean)

None — wave 6 fully settled (dispatch → implement → review → merge → integration review →
propose/create follow-up (NCOW-46) → direct doc cleanup (PR #41) → settlement), all worktrees
released, all branches deleted locally and remotely. Nothing mid-flight.

## Next steps

1. Run `/backlog-handover restore` to recompute the ready set (should resolve to {NCOW-46},
   a solo wave by definition since nothing else is queued) and dispatch it.
2. NCOW-46's own AC set (dedupe resolveDomainLocks()'s returned lock objects; assert
   LOCK_ACQUISITION_ORDER is a permutation of the real MUTEX_DOMAINS covering every
   DOMAIN_MUTEX_ALIASES value; tests for both, since currently zero direct tests reference any
   of `LOCK_ACQUISITION_ORDER`/`DOMAIN_MUTEX_ALIASES`/`resolveDomainLocks`/`withLocks` — all
   existing coverage is behavioral, through `uninstall` only) — re-read
   `backlog task view NCOW-46 --plain` fresh; it was filed this session from the wave-6
   integration review's own independent behavioral probing (not from either task-level review).
3. Give NCOW-46's reviewer the same proportionally-deeper scrutiny NCOW-45 got — it's touching
   the same concurrency primitive, and the wave-6 integration reviewer found gaps neither
   NCOW-45's own worker nor its task reviewer had reason to construct, precisely because they
   were testing the mechanism against its OWN design assumptions rather than hunting outside
   them. Do the same for whoever reviews NCOW-46's fix.
4. After this round's queue empties, re-run inventory (I1) for a fresh round rather than
   assuming NCOW-7/11/13/14/15 are still correctly excluded, and consider whether the
   consolidated "survey remaining unguarded err.message sites" idea (proposed at wave 6,
   explicitly declined for that round) is worth including in the next round's inventory.

## Critical context / traps

- Doc-4 (the prior, complete campaign round's tracker) should not be reopened or edited —
  doc-5 is the live tracker.
- **Concurrency primitives warrant proportionally deeper review — confirmed valuable at wave 6.**
  NCOW-45's task-level reviewer was already unusually thorough (explicit starvation/fault-path/
  regression stress tests). Even so, the wave-level integration reviewer's OWN independent
  behavioral probing — not just re-reading the same diff — found two additional latent hazards
  (duplicate-resolved-lock self-deadlock; unlisted-domain sort-order drift) that neither the
  worker nor the task reviewer had reason to construct, because both were testing the mechanism
  against the scenarios it was designed for, not scenarios outside that design's own
  assumptions. This is now filed as NCOW-46. When NCOW-46 itself is reviewed, don't let it get
  less scrutiny just because it's "just a hardening fix" — it's still touching the same
  concurrency-sensitive code.
- **Review-fix cycles keep earning their keep, and waves 5-6 both needed none** — two
  consecutive waves with zero request_changes cycles (all 4 tasks approved first-pass). Don't
  read this as the pattern going away — when a fix cycle IS needed, the pattern that makes it
  succeed is unchanged: the reviewer's finding names a specific, reproducible case, and the fix
  pass is handed that finding verbatim.
- **Wave-level integration review has found something real in every single wave (1-6) so far**
  — never skip or shortcut this step even when every individual review approves cleanly.
- **Treehouse slot-2 avoidance is now understood to be allocator-limited, not agent-limited.**
  The pool always returns the lowest-numbered available slot; return-and-retry only helps when
  a HIGHER-numbered slot is free to fall back to. Attempt it once or twice, but accept the
  lease rather than looping if the same slot keeps coming back — see the revised guidance in
  the paste-ready prompt above.
- Treehouse pool has stayed at 4 trees since wave 1's growth; all 4 released and available
  again after wave 6's settlement. Their HEADs are currently stale/detached at old wave-6
  commits (harmless — whichever tree gets leased next for wave 7 will be re-pinned to the
  fresh wave-base SHA via `git switch --detach` before branching, per this skill's Worktree
  lifecycle convention).

## Do not repeat

- Two Agent-tool dispatch attempts failed with `herdr pane split ... pane_not_found` when the
  `name` parameter was passed to the Agent tool call (observed in a prior session). Retrying
  the identical dispatch without `name` succeeded immediately. If launching worker/reviewer
  agents ever fails with a pane-related error again, drop the `name` parameter before
  troubleshooting further.
- When archiving a consumed handover, always `ls archive/handovers/` first to find the actual
  next-free numeric suffix — do not assume based on memory of what suffixes "should" exist.
  This session's archival correctly found the base filename already taken (from an earlier
  archival this same session) and used suffix `-2`.
