# Handover — new campaign round: NCOW-31 follow-ups (waves: 0, tasks: NCOW-32, NCOW-33, NCOW-34, NCOW-35, NCOW-36)

**Date**: 2026-08-04 | **Grounded against**: `dev` @ `25a9806`, clean, in sync with `origin/dev`
(no ahead/behind) | **Tracker**: doc-5

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. This is
wave 0 (no waves run yet) of a fresh campaign round just initialized. Queue
order confirmed by user on 2026-08-04; do not re-ask. The ready set is
recomputed live at restore — do NOT hardcode a "next wave" list here.

Queue (confirmed order, all currently unblocked — sole dependency NCOW-31 is
Done): NCOW-34 (docs-only), NCOW-33 (comment-only), NCOW-36 (configGen
hardening), NCOW-35 (tray actions extraction), NCOW-32 (proxy-mutex
serialization for uninstall/auto-update).

NCOW-33 and NCOW-32 share the `proxy-mutex` cluster and both plausibly touch
engine-context.js — expect the wave builder to keep them in separate waves
even though neither task depends on the other in Backlog's own Dependencies
field.

No in-flight worktrees, branches, or PRs from this init — treehouse pool has
3 available (unleased) trees at ~/.treehouse/claude-conduit-163fa4/{1,2,3}.

Not queued this round (re-checked fresh at this init, unchanged since the
prior round's doc-4): NCOW-7 (parked pending NCOW-15), NCOW-11 (open metrics-
source design question), NCOW-13 (depends on undecomposed NCOW-14), NCOW-14
and NCOW-15 (both self-described as needing subtask decomposition before
they're agent-sized). These need a human planning/decomposition session, not
another restore.
```

## State

| Item | Status |
| --- | --- |
| Prior campaign (doc-4) | Complete, waves 1-15, archived state — not touched this session |
| New tracker (doc-5) | Created and populated this session, committed + pushed (`25a9806`) |
| Queue | 5 tasks, To Do, wave 0 (not yet dispatched) |
| Worktrees/branches/PRs | None in flight |
| Working tree | Clean, `dev` in sync with `origin/dev` |

## This session's in-flight wave (omit if clean)

None — this session only ran Init mode (inventory, user confirmation, tracker creation). No
wave was dispatched.

## Next steps

1. Run `/backlog-handover restore` to compute the ready/conflict graph over NCOW-32..36 and
   dispatch the first wave. Expect NCOW-34/33/36/35 to be conflict-free against each other
   (different clusters: docs, proxy-mutex [comment-only], configgen, tray) and thus
   plausibly all fit in one wave; NCOW-32 shares the `proxy-mutex` cluster with NCOW-33 and
   should be treated as conflicting with it (both plausibly touch `engine-context.js`) even
   though the file-citation check should confirm this independently rather than trusting this
   note blindly.
2. After NCOW-32..36 resolve, re-run inventory: this queue does not include NCOW-7/11/13/14/15
   by design — they need a separate human planning/decomposition pass before a future round
   can queue them (see doc-5's "Not queued" section for the specific reasons per task).

## Critical context / traps

- Doc-4 (the prior, complete campaign tracker) should not be reopened or edited — doc-5 is
  the live tracker now.
- NCOW-32 and NCOW-33 both touch the proxy-mutex area introduced by NCOW-31
  (`src/main/mutex.js`, `engine-context.js`) — even though only NCOW-32 lists NCOW-33 or vice
  versa nowhere as a Backlog dependency, treat them as same-cluster/conflicting for wave
  building, per doc-5's Frontier note.
- NCOW-35's acceptance criteria specifically call out a known weakness in NCOW-31's own
  tray-mutex regression test (a source-check regex that a nested-scope-shadowing mutation
  could defeat) — the reviewer for NCOW-35 should confirm the new behavioral test actually
  catches that specific mutation class, not just that it passes.
- NCOW-36's AC #2 requires all 12 of a specific adversarial thrown-value set (from NCOW-31's
  own review pass 2) to still log sensibly — don't let a worker narrow scope to just the one
  null-prototype-object regression in AC #1.

## Do not repeat

(none — this was a clean init with no failed attempts)
