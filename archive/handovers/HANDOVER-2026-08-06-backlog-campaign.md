# Handover — wave 13 complete (NCOW-53 Done, 1 cleanup cycle, NCOW-55 filed)

**Date**: 2026-08-06 | **Grounded against**: `dev` @ `2026828`,
clean, 0 ahead / 0 behind `origin/dev` (verified after this session's final commit was pushed) |
**Tracker**: doc-5

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. Wave 13 is
fully merged and settled — NCOW-53 — 23 tasks resolved across waves 1-13.
Queue order confirmed by user on 2026-08-04; do not re-ask.

Queue is now just 1 item: NCOW-55 (on NCOW-53, Done). Since it's the only queued
task, wave 14 will be solo by definition — no conflict-graph computation is
needed to establish that, but RE-VERIFY its citations fresh regardless (this
project's own file pairs have drifted in every wave that touched them).

NCOW-55 (filed this session, user-approved from wave-13's own integration
review): give the tray a real user-visible error surface for wedged
Start/Stop/Restart calls. NCOW-53 gave tray Stop a `console.error` diagnostic,
but that's invisible in a packaged build (stderr nobody reads), and tray
Start/Restart never got any error handling at all (out of NCOW-53's AC scope).
Its own ACs deliberately leave the mechanism undecided — native OS notification
vs. an IPC broadcast the renderer can show regardless of which view is mounted —
brief the worker that this is an open design choice for it to make and justify,
not a prescribed implementation.

CRITICAL CONTEXT CARRIED FROM WAVE 13, READ THIS BEFORE DISPATCHING NCOW-55:

This campaign has now hit "a correction introduces a new false claim" as a
recurring failure class enough times that wave 13 found a NEW variant: the
false claims didn't need a later correction pass to appear — NCOW-53's own
first-pass comments already contained several (see doc-5's Resolved table,
NCOW-53 row, for the full list: a "no subscription ever attached" claim that
was false, a self-contradictory "permanently...until unmounted" phrase, and a
test comment claiming a pre-fix revert produces a Node `unhandledRejection`
when it actually produces a caught `AssertionError`). Brief NCOW-55's worker
AND reviewer on this pattern explicitly, same as every wave since it was first
identified — it has not faded with campaign experience, four-plus occurrences
in 13 waves is a durable structural property of writing claims about
counterfactual ("what would happen if this code were different") behavior
without empirically checking them.

Separately: NCOW-55's own review should independently verify whatever
mechanism the worker chooses (native notification vs. IPC broadcast) actually
reaches the user in a way a `console.error` doesn't — don't accept "it calls a
different function" as proof; re-derive what a real user actually sees.

Not queued this round (unchanged; re-check fresh — a human may have acted):
NCOW-7 (parked pending NCOW-15), NCOW-11 (open metrics-source design
question), NCOW-13 (depends on undecomposed NCOW-14), NCOW-14 and NCOW-15
(both self-described as needing subtask decomposition). Last freshly checked
this session (2026-08-06) — still all last-updated 2026-07-31, nothing changed.

No in-flight worktrees, branches, or PRs. All 4 treehouse pool trees are
released and available at ~/.treehouse/claude-conduit-163fa4/{1,2,3,4} (HEADs
stale/detached — whichever gets leased must be re-pinned to the fresh wave
base). Tree 1 was leased twice this session (NCOW-53's own task, then the
wave-13 cleanup PR) with zero adverse effect, continuing this campaign's
long streak of clean warm-pool reuse.

This session stopped between waves on a self-assessed context-pressure
checkpoint, NOT because the queue emptied — NCOW-55 exists and is ready. Do
NOT treat this as the "campaign complete" case; go straight into wave 14's
dispatch after the standard R2 drift check.
```

## State

| Item | Status |
| --- | --- |
| Waves 1-12 (NCOW-32 … NCOW-49) | Done, merged prior sessions (PRs #24-#55) |
| Wave 13 (NCOW-53) | Done, merged this session (PR #56 `f20eb5d`) |
| Wave 13 cleanup | Merged this session (PR #57 `9245a9d`, 1 review pass, zero fix cycles) |
| Tracker (doc-5) | Settled for wave 13, committed + pushed (`b531a3d`) |
| Queue | 1 task (NCOW-55), To Do, ready by dependency, filed this session with user approval |
| Worktrees/branches/PRs | None in flight; all 4 pool trees released; no open PRs |
| Working tree | Clean, `dev` @ `2026828`, in sync with origin |
| Test count on merged dev | **461/461 passing** (independently verified by the orchestrator and by both the task-level and cleanup review passes — not inferred) |

## This session's in-flight wave

None. Wave 13 fully settled: dispatch (fresh conflict-graph computation trivial — NCOW-53 was
the only ready item, solo by construction; file citations re-verified fresh against current
`dev` before dispatch, finding drift from the wave-12 note as expected) → implement (worker,
in a treehouse-leased worktree: dashboard-view.js/tray.js fixed, mutex.js confirmed untouched;
457→461 tests) → task-level review (opus, first pass `approve`, all 6 ACs independently
reconfirmed) → serial merge (clean rebase, PR #56, squash-merge `f20eb5d`) → wave-level
integration review (found real material for the 13th consecutive wave — false claims in
NCOW-53's OWN new comments, not a later correction pass) → user-approved follow-up task filed
(NCOW-55) → cleanup dispatch (comment/test-comment text only, proven via esprima token-stream
identity) → cleanup review (opus, `approve`, first pass — reviewer independently reproduced
every corrected claim, including a real-Electron probe for the highest-risk one) → cleanup
merge (PR #57, `9245a9d`) → settlement (check-ac 1-6, corrected NCOW-53's own false evidence
claim on its task record, final-summary, `-s Done`) → tracker update → this handover.

## Next steps

1. Run `/backlog-handover restore`. Recompute the ready set. Expect 1 ready (NCOW-55) — a
   trivially solo wave since it's the only queued item, but still re-verify its file citations
   fresh at dispatch.
2. **Brief NCOW-55's worker that the error-surface mechanism is an open design choice** (native
   OS notification vs. IPC broadcast to the renderer) — its ACs deliberately don't prescribe
   one, per the task-creation guide's rule against speculative implementation at filing time.
3. **Brief both the worker and reviewer on the "correction/original-comment introduces a false
   claim" pattern** before dispatch, not as an afterthought during review — this is now a
   4th-plus occurrence across the campaign and the mitigation (explicit briefing + independent
   empirical reproduction rather than re-reading) has worked every time it was actually applied.
4. Once NCOW-55 is done, re-run inventory (I1) rather than assuming NCOW-7/11/13/14/15 are still
   correctly excluded — several waves have passed since they were last freshly checked (last
   fresh check: wave-13 dispatch, 2026-08-06), and depending what NCOW-55 turns up, the queue may
   empty for the first time this round.

## Critical context / traps

- **Doc-4 must not be reopened — doc-5 is the live tracker.**
- **The integration review has now found real material in every wave, 1 through 13, without
  exception.** Wave 13 is a new variant on this: the false claims were in the ORIGINAL PR's own
  comments, not a later correction pass — meaning "the task-level reviewer already approved
  this" is not evidence the comments are accurate, only that the ACs are met. Never skip or
  shortcut the integration-review step, even on a solo wave with a clean task-level review.
- **The "correction/original-comment introduces a new false claim" failure class has now
  recurred enough times (PR #45, PR #48/#50, wave 11's PR #53, wave 12's fix pass, and now
  wave 13's ORIGINAL comments) that it should be treated as a standing property of this
  campaign's work, not a fading risk.** The mitigation that has worked every time it was
  applied: brief the reviewer explicitly before dispatch, and have it independently REPRODUCE
  the claim (revert the file, re-run the test, or — as wave 13's cleanup reviewer did for the
  highest-risk claim — actually run the scenario in a real Electron process) rather than just
  re-reading prose for plausibility.
- **A claim about counterfactual behavior ("what the pre-fix code would do") is exactly as
  unverified as any other claim until someone actually runs it.** Every false claim wave 13
  found was of this shape — a description of what OLD code would have done, written without
  empirically checking it. When briefing a worker or reviewer to write or check such a claim,
  say so explicitly: don't reason about it, revert and run it.
- **A minimal, call-site-local fix is often the right choice over touching a shared primitive**,
  and NCOW-53 is the campaign's cleanest example yet: the dispatch brief recommended fixing
  AC#2 at tray.js's call site rather than inside mutex.js, explaining precisely why (the
  promise returned to a caller is never itself swallowed, only mutex.js's internal chain
  variable is) — the worker followed this, two independent reviewers verified mutex.js stayed
  byte-for-byte untouched, and the entire predicted mutex.js/withLocks() hazard from wave 12
  never had to be revisited. When a dispatch brief hands the worker a specific, reasoned
  recommendation with its justification spelled out, following it (rather than defaulting to
  the more invasive alternative) keeps a shared, load-bearing primitive untouched for another
  wave.
- **Non-vacuity checks (AC#4-style) are worth doing more than once, by more than one party.**
  The task-level reviewer independently re-ran 2 of the worker's 3 revert-and-restore probes
  rather than trusting the reported failure messages; the wave-level integration reviewer then
  found that ONE of those reported failure messages (the "unhandled rejection" one) was itself
  wrong, despite having passed a first round of independent review. Depth of review is not the
  same as breadth — a second independent pass with fresh eyes caught what a thorough first pass
  missed.
- **User-approved follow-up filing worked exactly as designed this wave**: the integration
  reviewer surfaced real, separate-scope work (tray error visibility, out of NCOW-53's own AC
  boundary); the orchestrator proposed it via AskUserQuestion rather than creating it
  unilaterally; the user approved; NCOW-55 was filed with a clear description, testable ACs,
  and a dependency on NCOW-53 — and deliberately left the implementation mechanism undecided,
  per the task-creation guide's rule against speculative implementation choices at filing time.
- **This session stopped between waves on a self-assessed context-pressure checkpoint**, not
  because the queue emptied. Do not mistake "only 1 task queued" for "campaign complete" — the
  R6 campaign-complete branch only applies when the queue is genuinely empty, and NCOW-55
  keeps it non-empty.

## Do not repeat

- **`path` is a zsh-special variable tied to `PATH`.** Assigning `path=/some/dir` in a Bash tool
  call destroys `PATH` and every subsequent command in that invocation fails with
  `command not found`. Use `WT`, `wt_path`, anything but `path`.
- **The Agent tool's own `isolation: "worktree"` parameter conflicts with this skill's
  treehouse-managed worktree convention — do not pass both.** When this skill has already
  leased and branched a treehouse worktree for a worker, never pass `isolation: "worktree"`
  (or any isolation parameter) to that worker's Agent call — the cwd instruction in the prompt
  is the only worktree-management mechanism needed.
- **`treehouse get --lease --json` prints an update banner before the JSON**, so piping straight
  into a JSON parser yields nothing. Extract the object first (`grep -o '{.*}'`).
- **Embedding literal apostrophes/backticks inside a single-quoted bash argument silently
  corrupts the text** rather than erroring. Use a heredoc (`$(cat <<'EOF' ... EOF)`) assigned to
  a shell variable, then pass `"$VAR"` as the argument, for any Backlog CLI text field
  containing an apostrophe or backtick-quoted code span — including `backlog doc update
  --content`, whose payload is too large/backtick-heavy to hand-type safely. This session again
  wrote the tracker content to a scratchpad file first, edited it there with the Edit tool
  (never touching the real tracked doc file directly), then loaded it into a shell variable via
  `$(cat file)` before passing `"$VAR"` to `backlog doc update`.
- **`backlog task edit --remove-ac N` repeated N times to clear all ACs does NOT reliably remove
  all of them** — use `--clear-ac` followed by fresh `--ac` calls instead when you need to fully
  replace a list. (Not needed this wave.)
- **A background `ScheduleWakeup` fallback of ~900-1200s per dispatched agent worked cleanly
  this session** for every worker/reviewer stage (implementation ~9.5min, task-review ~5min,
  integration review ~6min, cleanup worker ~8.7min, cleanup review ~7.3min) — none of the
  fallback wakeups actually fired before the real task-completion notification arrived; they
  served purely as the required backstop. Keep scheduling one after every background dispatch
  rather than polling.
- No Agent dispatch failures this session — no 529s, no `pane_not_found`, no unexplained
  interruptions. No `name` parameter was passed to any Agent call — keep omitting it.
- When archiving a consumed handover, `ls archive/handovers/` first for the actual next free
  suffix. This session found base through `-8` taken and used `-9`.
- **Do not run `backlog` writes from inside a worktree**, and do not let workers run them at
  all — every dispatch this session was explicitly barred from this and none violated it.
- **User approval for a new task was sought and obtained via AskUserQuestion before filing
  NCOW-55** — this is the correct, load-bearing sequence (never create a follow-up task
  unilaterally, even when the integration review's case for it is strong).
