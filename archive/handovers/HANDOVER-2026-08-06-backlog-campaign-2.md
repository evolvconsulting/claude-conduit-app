# Handover — wave 14 complete (NCOW-55 Done, 2 fix cycles + 1 cleanup cycle, 3 tasks filed)

**Date**: 2026-08-06 | **Grounded against**: `dev` @ `0748b1b`,
clean, 0 ahead / 0 behind `origin/dev` (verified after this session's final commit was pushed) |
**Tracker**: doc-5

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. Wave 14 is
fully merged and settled — NCOW-55 — 24 tasks resolved across waves 1-14.
Queue order confirmed by user on 2026-08-04; do not re-ask.

Queue is now 3 items: NCOW-56, NCOW-57, NCOW-58 (all on NCOW-55, Done — all
ready by dependency). UNLIKE THE LAST FEW WAVES, wave 15 is NOT automatically
solo — you need a REAL conflict-graph computation this time, via the
file-citation method (read each task's description/AC, resolve the files it's
expected to touch, don't rely on the shared "tray-notify" cluster label alone
as proof of conflict OR proof of safety).

Provisional (NOT yet verified — re-derive fresh, this is a guess to start
from, not ground truth):
- NCOW-56 (tray still silent on {ok:false}): primary file src/main/tray.js
  (extending runAction/notifyFailure to also inspect a resolved value, not
  just a caught rejection).
- NCOW-57 (Windows/Linux notification deliverability): primary files likely
  src/main/index.js (app.setAppUserModelId call site) and
  electron-builder.yml; POSSIBLY also src/main/tray.js if isSupported()'s
  framing needs softening — this is the collision risk with NCOW-56, verify
  it directly rather than assuming.
- NCOW-58 (document the notification behavior): primary files README.md,
  DESIGN.md — pure docs, no code, likely disjoint from the other two BUT its
  own AC#3 asks it to reflect NCOW-57's actual resolution ("whichever is
  accurate at the time this task is done") — consider sequencing it after
  NCOW-57 rather than true-parallel, or brief its worker to write the caveat
  provisionally and let review catch any mismatch if dispatched together.

NCOW-57 also requires live-verifying the app on Windows (winvm) and Linux —
the Shared Machine State rule caps live-app verification to ONE wave member
at a time regardless of file-conflict status, so if NCOW-56/58 are dispatched
alongside NCOW-57 in the same wave, only NCOW-57 gets to touch the live app;
NCOW-56/58 must be satisfiable via unit/harness tests alone (NCOW-56 plausibly
is, matching wave 8/13/14's createTrayActions() test precedent — verify this
at dispatch, don't assume).

CRITICAL CONTEXT CARRIED FROM WAVE 14, READ THIS BEFORE DISPATCHING:

This campaign hit 2 fix cycles on NCOW-55's own review — not because the
implementation was wrong, but because a comment fix used a RELATIVE git ref
(`HEAD~1`) that self-invalidated the moment the fix itself was committed
(committing shifts what HEAD resolves to). The eventual correct fix used an
ABSOLUTE SHA (the branch's own merge-base, `e9f0c4f`) instead. Generalize
this for wave 15: if ANY worker or reviewer needs to write a comment or test
that references "the pre-fix state" of a file being committed to IN THE SAME
COMMIT OR A LATER ONE IN THE SAME BRANCH, brief them explicitly to use an
absolute SHA (the branch's base, or a specific already-merged commit) —
never HEAD, HEAD~N, or any other ref relative to a commit still being
written.

The wave-14 integration review also found: (a) NCOW-53's own first-pass
comments (not a later correction) contained factually inaccurate claims about
counterfactual pre-fix behavior — the pattern is now proven to recur inside
ORIGINAL work, not just correction passes; and (b) NCOW-55's own test data
contained a fabricated pm2 error code (PM2_RESTART_TIMEOUT, which doesn't
exist — restart delegates to start, so the real code is PM2_START_TIMEOUT).
Both were caught by integration review, not task-level review. Brief every
wave-15 worker AND reviewer explicitly: any comment/test-data describing what
OLD or DIFFERENT code does/did, or citing a specific error code/message, must
be independently verified against the actual current source — never assumed
or pattern-matched from a similar-sounding sibling.

Not queued this round (unchanged; re-check fresh — a human may have acted):
NCOW-7 (parked pending NCOW-15), NCOW-11 (open metrics-source design
question), NCOW-13 (depends on undecomposed NCOW-14), NCOW-14 and NCOW-15
(both self-described as needing subtask decomposition). Last freshly checked
this session (2026-08-06) — still all last-updated 2026-07-31, nothing changed.

No in-flight worktrees, branches, or PRs. All 4 treehouse pool trees are
released and available at ~/.treehouse/claude-conduit-163fa4/{1,2,3,4} (HEADs
stale/detached — whichever gets leased must be re-pinned to the fresh wave
base). Tree 1 has now been leased and released cleanly across 3 consecutive
tasks this session (NCOW-55's own implementation, its 2 fix passes, and the
wave-14 cleanup) with zero adverse effect — this campaign's warm-pool-reuse
streak continues to hold.

This session stopped between waves on a self-assessed context-pressure
checkpoint after 2 full waves (13 and 14), NOT because the queue emptied.
```

## State

| Item | Status |
| --- | --- |
| Waves 1-13 (NCOW-32 … NCOW-53) | Done, merged prior sessions (PRs #24-#57) |
| Wave 14 (NCOW-55) | Done, merged this session (PR #58 `76a7c3c`) |
| Wave 14 cleanup | Merged this session (PR #59 `66d5aa0`, 1 review pass, zero fix cycles) |
| Tracker (doc-5) | Settled for wave 14, committed + pushed (`1300f0a`) |
| Queue | 3 tasks (NCOW-56, NCOW-57, NCOW-58), all To Do, ready by dependency, filed this session with user approval |
| Worktrees/branches/PRs | None in flight; all 4 pool trees released; no open PRs |
| Working tree | Clean, `dev` @ `0748b1b`, in sync with origin |
| Test count on merged dev | **467/467 passing** (independently verified by the orchestrator and by all task-level and cleanup review passes — not inferred) |

## This session's in-flight wave

None. Wave 14 fully settled: dispatch (fresh conflict-graph computation trivial — NCOW-55 was
the only ready item, solo by construction) → implement (worker, in a treehouse-leased worktree:
attempted IPC-broadcast, abandoned it after finding a real conflict with 2 pre-existing
identity-guard tests, pivoted to Electron's native `Notification` API; 461→467 tests) →
task-level review, **3 passes**: pass 1 approved the substance but found 2 comment-only issues;
pass 2 found one "fix" had reintroduced the same defect via a self-invalidating relative git
ref; pass 3 confirmed the absolute-SHA correction holds → serial merge (PR #58, squash-merge
`76a7c3c`) → wave-level integration review (found a fabricated pm2 error code and a
mischaracterized test comment) → 3 user-approved follow-up tasks filed (NCOW-56/57/58) →
cleanup dispatch (comment/test-data-only) → cleanup review (opus, `approve`, first pass) →
cleanup merge (PR #59, `66d5aa0`) → settlement (check-ac 1-6, final-summary, `-s Done`) →
tracker update → this handover.

## Next steps

1. Run `/backlog-handover restore`. Recompute the ready set. Expect 3 ready (NCOW-56/57/58) —
   **a genuine conflict-graph computation is needed this time**, unlike the last several solo
   waves. Read all 3 tasks' full descriptions/ACs via `backlog task view`, resolve their file
   footprints via the file-citation method, and don't assume the shared cluster label proves
   anything either way.
2. **NCOW-57 needs live app verification (winvm + Linux)** — confirm no other wave member also
   needs live verification before dispatching alongside it (Shared Machine State rule).
3. **Brief every worker and reviewer this wave on the absolute-SHA-vs-relative-ref lesson**
   from NCOW-55's own 2 fix cycles, and on independently verifying any claim about
   counterfactual/pre-fix behavior or specific error codes — both are now well-established,
   recurring failure classes in this campaign, not one-off mistakes.
4. Once NCOW-56/57/58 are done, re-run inventory (I1) rather than assuming NCOW-7/11/13/14/15
   are still correctly excluded — several waves have passed since they were last freshly
   checked (last fresh check: wave-14 dispatch, 2026-08-06).

## Critical context / traps

- **Doc-4 must not be reopened — doc-5 is the live tracker.**
- **The integration review has now found real material in every wave, 1 through 14, without
  exception.** Wave 14 reinforces a variant first seen at wave 13: the false claims can be in
  the ORIGINAL work (NCOW-53's first-pass comments, NCOW-55's fabricated test data), not only
  in a later correction pass. Never skip or shortcut the integration-review step.
- **A NEW failure sub-class this wave: a self-invalidating relative git reference.** A comment
  that says `git show HEAD:...` or `git show HEAD~N:...` to describe "the pre-fix state" of a
  file is describing something that shifts every time a NEW commit touches that same file —
  including the very commit that writes the comment. The fix is always an ABSOLUTE SHA (a
  specific, already-existing commit — typically the branch's own base/merge-base), never
  another relative offset. This took 2 fix cycles to converge on for NCOW-55 because the first
  "fix" just swapped one relative ref for another. Brief this explicitly whenever a worker or
  reviewer needs to write this kind of reproduction recipe.
- **A minimal, call-site-local fix beat a more invasive alternative for the second time running**
  — NCOW-55 chose Electron's native `Notification` API specifically because the IPC-broadcast
  alternative would have required changing `createTrayActions`'s first-argument shape, which 2
  pre-existing tests hardcode via regex. When an implementation choice is genuinely open (as
  NCOW-55's own ACs deliberately left it), a worker discovering a real test-compatibility
  constraint mid-implementation and pivoting away from its first attempt — rather than forcing
  the original plan through — is exactly the right behavior, and should be recorded as such
  rather than treated as a sign something went wrong.
- **Fabricated/invented test data (a plausible-sounding but nonexistent error code) is a
  distinct failure class from stale-claim drift** — it was never true, rather than having become
  untrue. Both classes are now proven recurring in this campaign; the mitigation is the same
  (independently verify against actual source before writing or trusting any specific claim),
  but it's worth naming them separately when briefing workers, since "check if this is still
  accurate" (drift) and "check if this was ever accurate" (fabrication) are different mental
  motions.
- **User-approved follow-up filing worked exactly as designed again this wave** — 3 real,
  separate-scope findings (NCOW-56/57/58) were proposed via AskUserQuestion (multiSelect,
  letting the user choose which to file) rather than created unilaterally, all approved, all
  filed with clear descriptions/ACs and a dependency on NCOW-55, deliberately leaving open
  design questions (e.g. NCOW-56's manifest-check decision) for the eventual worker/reviewer
  rather than prescribing them at filing time.
- **This session stopped between waves on a self-assessed context-pressure checkpoint** after
  completing 2 full waves (13 and 14) with multiple review/fix/cleanup cycles each — not because
  the queue emptied. Wave 15 has 3 queued items and needs real dispatch-time judgment (conflict
  graph, live-verification sequencing), which is exactly the kind of decision a fresh session
  should make with full context budget, not a tail-end decision in an already-long session.

## Do not repeat

- **`path` is a zsh-special variable tied to `PATH`.** Assigning `path=/some/dir` in a Bash tool
  call destroys `PATH` and every subsequent command in that invocation fails with
  `command not found`. Use `WT`, `wt_path`, anything but `path`.
- **The Agent tool's own `isolation: "worktree"` parameter conflicts with this skill's
  treehouse-managed worktree convention — do not pass both.** When this skill has already
  leased and branched a treehouse worktree for a worker, never pass `isolation: "worktree"`
  (or any isolation parameter) to that worker's Agent call.
- **`treehouse get --lease --json` prints an update banner before the JSON**, so piping straight
  into a JSON parser yields nothing. Extract the object first (`grep -o '{.*}'`).
- **Embedding literal apostrophes/backticks inside a single-quoted bash argument silently
  corrupts the text** rather than erroring. Use a heredoc (`$(cat <<'EOF' ... EOF)`) assigned to
  a shell variable, then pass `"$VAR"` as the argument, for any Backlog CLI text field
  containing an apostrophe or backtick-quoted code span — including `backlog doc update
  --content`. This session again wrote the tracker content to a scratchpad file first, edited
  it there with the Edit tool, then loaded it via `$(cat file)` before passing `"$VAR"`.
- **`backlog task edit --remove-ac N` repeated N times to clear all ACs does NOT reliably remove
  all of them** — use `--clear-ac` followed by fresh `--ac` calls instead. (Not needed this
  wave.)
- **A background `ScheduleWakeup` fallback of ~900-1200s per dispatched agent worked cleanly
  this session** for every worker/reviewer stage across both waves (implementation runs
  ~5-11min, review passes ~3-12min, fix passes ~2-5min) — none of the fallback wakeups actually
  fired before the real task-completion notification arrived. Keep scheduling one after every
  background dispatch rather than polling.
- No Agent dispatch failures this session — no 529s, no `pane_not_found`, no unexplained
  interruptions. No `name` parameter was passed to any Agent call — keep omitting it.
- When archiving a consumed handover, `ls archive/handovers/` first for the actual next free
  suffix. This session's handover archived cleanly at the base name (no `2026-08-06` collision
  yet), unlike the `2026-08-05` name which had accumulated through `-8`.
- **Do not run `backlog` writes from inside a worktree**, and do not let workers run them at
  all — every dispatch this session was explicitly barred from this and none violated it.
- **User approval for new tasks was sought and obtained via AskUserQuestion (multiSelect) before
  filing NCOW-56/57/58** — the correct, load-bearing sequence, even when the integration
  review's case for filing is strong across multiple candidates at once.
