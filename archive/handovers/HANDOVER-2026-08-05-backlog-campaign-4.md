# Handover — wave 7 complete (NCOW-46 Done; NCOW-47/48/49 filed; init queue fully drained)

**Date**: 2026-08-05 | **Grounded against**: `dev` @ `e486658851c078fb14f11fca9fb6a3f1ab9d9c4e`,
clean, 1 commit ahead of `origin/dev` at write time (the archive commit — pushed immediately
after this file was written) | **Tracker**: doc-5

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. Wave 7 is
fully merged and Done (NCOW-46 — 15 tasks resolved across waves 1-7). Queue order
confirmed by user on 2026-08-04; do not re-ask. The ready set is recomputed live
at restore — do NOT hardcode a "next wave" list here.

MILESTONE: the queue as confirmed at init is now FULLY DRAINED — NCOW-32 through
NCOW-46 are all Done. The queue's current 3 items (NCOW-47, NCOW-48, NCOW-49)
were all filed at wave 7's integration review, with explicit user approval, and
all three are ready by dependency (47/49 on NCOW-46 Done, 48 on NCOW-45 Done).

EXPECT SEQUENTIAL SOLO WAVES, not a batch of 3. All three target src/main/ipc.js
and/or test/main/ipc-mutex.test.js, and NCOW-47 additionally touches
src/main/mutex.js — so the conflict graph should come out fully connected and the
wave builder should correctly degrade to one task at a time. Verify that with a
fresh file-citation read rather than trusting this note; if it holds, budget
accordingly (3 sequential waves is a lot for one session — consider stopping
after 1-2).

ORDERING: this round's confirmed principle (isolated hardening first, structural
next, mutex-serialization last) does not cleanly discriminate here — all three
are mutex work. Prior sessions slotted follow-ups "using the identical
already-confirmed principle rather than re-asking the user"; the tracker's Queue
lists them 47, 48, 49. Treat that as the tie-break, not a promise.

Not queued this round (unchanged; re-check fresh rather than trusting this list —
a human may have acted on any of these between sessions): NCOW-7 (parked pending
NCOW-15), NCOW-11 (open metrics-source design question), NCOW-13 (depends on
undecomposed NCOW-14), NCOW-14 and NCOW-15 (both self-described as needing
subtask decomposition).

No in-flight worktrees, branches, or PRs. All 4 treehouse-pool trees are released
and available at ~/.treehouse/claude-conduit-163fa4/{1,2,3,4} (HEADs stale/
detached — whichever gets leased next will be re-pinned to the fresh wave-base
SHA as usual). Slot 1 was leased twice this wave with zero incidents.
```

## State

| Item | Status |
| --- | --- |
| Waves 1-6 (NCOW-32/33/34/35/36/37/38/39/40/41/42/43/44/45) | Done, merged prior sessions (PRs #24-#41) |
| Wave 7 (NCOW-46) | Done, merged this session (PR #42, `19d1ff7`) |
| Wave 7 doc cleanup | Merged this session (PR #43, `985389a`) |
| Tracker (doc-5) | Settled for wave 7, committed + pushed (`edc2360`) |
| Queue | 3 tasks (NCOW-47, NCOW-48, NCOW-49), all To Do, all ready by dependency |
| **Init-confirmed queue** | **Fully drained — NCOW-32 through NCOW-46 all Done** |
| Worktrees/branches/PRs | None in flight; all 4 pool trees released, no open PRs |
| Working tree | Clean, `dev` @ `e486658` |
| Test count on merged dev | **410/410 passing** (was 400 — verified by my own run after the final merge, not inferred) |

## This session's in-flight wave

None — wave 7 fully settled (dispatch → implement → review → merge → integration review →
direct doc cleanup + re-review + merge → propose/create 3 follow-ups → settlement). All
worktrees released, all branches deleted locally and remotely.

## Next steps

1. Run `/backlog-handover restore`. Recompute the ready set; expect `{NCOW-47, NCOW-48, NCOW-49}`
   ready but pairwise-conflicting, so wave 8 should build as a solo wave.
2. Re-read each of the three fresh (`backlog task view NCOW-4{7,8,9} --plain`) — they were filed
   from probe evidence, and each description names the exact file:line the probe hit. NCOW-49 in
   particular contains a judgment call the task deliberately does *not* settle (how much drift
   detection `assertLockOrderIsConsistent()` should own vs leave to behavioral tests) — that is
   scope for its worker to decide and its reviewer to check, not a defect in the task.
3. **NCOW-48 is the only one of the three with a live-behavior dimension** (bounding real `pm2`
   calls). It still needs no Electron/proxy launch — the existing `test/engine/` pm2 tests inject
   a fake pm2 — but if any worker on it proposes live verification, that makes it the wave's
   single live-verification slot (Shared Machine State) and it must use `NIM_PROXY_TEST_HOME` +
   `--dev`.
4. Once these three are done, this round's queue empties again — at that point re-run inventory
   (I1) for a fresh round rather than assuming NCOW-7/11/13/14/15 are still correctly excluded,
   and reconsider the "survey remaining unguarded err.message sites" idea (proposed at wave 6,
   declined for that round, still unfiled).

## Critical context / traps

- Doc-4 (the prior complete round's tracker) must not be reopened — doc-5 is the live tracker.
- **A reviewer that re-derives the *evidence* beats one that re-reads the *diff*.** Wave 7's task
  reviewer rejected part of the delivered evidence as too weak (a source-text regex claiming to
  prove the module-load assertion fires) and substituted 5 real `require()` loads of mutated
  module copies, establishing the guarantee more strongly than the implementer had. Ask reviewers
  for this explicitly on NCOW-47/48/49 — all three are concurrency work.
- **Wave-level integration review has now found real material in every single wave, 1 through 7,
  without exception** — including three consecutive waves (5, 6, 7) where every task-level review
  approved first-pass. Never skip or shortcut it. Wave 7's found the stale test count, both
  new-task-worthy hazards, and all three NCOW-46 residuals.
- **Stale documented test counts are a recurring, systematic omission — check them at every
  merge that changes the count.** Wave 6 needed PR #41 for it; wave 7 repeated it and needed
  PR #43. The two live occurrences are `CLAUDE.md:51` and `README.md:330` (now both 410).
  Everything else matching `400` in the docs is HTTP 400 or port 4000. Consider just checking
  these two lines as part of any merge that adds tests, rather than waiting for a reviewer.
- **The module-load assertion added by NCOW-46 is now live in `src/main/ipc.js`.** It is loaded
  by exactly three sites: `src/main/index.js:7` (Electron main, top-level, no enclosing
  try/catch — the intended loud failure), `test/main/ipc-mutex.test.js:41`, and
  `test/main/tray-actions.test.js:43`. Because two suites require it, lock-order drift fails
  `npm test` (410 → 376, both files failing to load) rather than a user's launch. **If either of
  those two suites ever stops requiring `ipc.js`, that CI safety net silently disappears** —
  which is the residual dependency the reviewer flagged when it approved the module-load choice.
- **`resolveDomainLocks()`'s dedupe is by function *identity* only** — two distinct functions
  sharing one FIFO chain still deadlock (reproduced: handler never entered after 80 microtask
  ticks). That is NCOW-49's item 1, not a wave-7 defect, but don't let a future reader assume the
  dedupe is stronger than it is.
- Treehouse pool has stayed at 4 trees since wave 1. Slot 1 was leased twice this session (once
  for NCOW-46, once for the doc cleanup) with zero incidents of the old slot-2 pattern — now 3
  full waves clean.

## Do not repeat

- **`path` is a zsh-special variable tied to `PATH`.** Assigning `path=/some/dir` in a Bash tool
  call destroyed `PATH` mid-script and every subsequent command in that invocation failed with
  `command not found: git`. Use `WT`, `wt_path`, anything but `path`.
- **`treehouse get --lease --json` prints an update banner and setup lines *before* the JSON**, so
  piping it straight into `jq -r .path` yields empty. Extract the JSON object first
  (`grep -o '{.*}'`) or read the fields off the printed object.
- One Agent dispatch failed with `API Error: 529 Overloaded` mid-task. The worktree was verified
  untouched (`git status` clean, HEAD unmoved) and an identical re-dispatch succeeded immediately.
  Check worktree state before retrying, but do not assume a 529 left partial work.
- Two Agent-tool dispatch attempts failed with `herdr pane split ... pane_not_found` when the
  `name` parameter was passed (observed in a prior session). No `name` was passed this session and
  all 5 dispatches worked. Keep omitting it.
- When archiving a consumed handover, always `ls archive/handovers/` first for the actual next
  free suffix. This session correctly found base and `-2` taken and used `-3`.
