# Handover — wave 10 complete (NCOW-52 Done, one non-AC fix cycle; NCOW-53 + NCOW-54 filed)

**Date**: 2026-08-05 | **Grounded against**: `dev` @ `ece7a2d`,
clean, 0 ahead / 0 behind `origin/dev` (verified after the archive commit was pushed) |
**Tracker**: doc-5

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. Wave 10 is
fully merged and settled — NCOW-52 — 19 tasks resolved across waves 1-10. Queue
order confirmed by user on 2026-08-04; do not re-ask. The ready set is
recomputed live at restore — do NOT hardcode a "next wave" list here.

Queue is 4 items, ALL ready by dependency: NCOW-49, NCOW-50, NCOW-53, NCOW-54.
NCOW-53 and NCOW-54 were filed at wave 10's integration review with explicit
user approval — both are real defects NCOW-52 itself introduced, not
pre-existing issues.

RE-DERIVE THE CONFLICT GRAPH FRESH — do not assume NCOW-53/54's footprint from
this note. What's known so far: NCOW-53 touches src/renderer/views/
dashboard-view.js, src/main/tray.js, and likely src/main/mutex.js (its error-
surfacing mechanism) plus test files. NCOW-54 touches src/engine/pm2Control.js
(the same file NCOW-52 just edited) plus its own test file. NCOW-49 and
NCOW-50 both still touch src/main/ipc.js and test/main/ipc-mutex.test.js (per
wave 9/10's own analysis, re-verify since ipc.js changed again in wave 10's
cleanup PR #50's JSDoc-adjacent file, pm2Control.js — actually check whether
ipc.js itself moved). NCOW-54 and NCOW-49/50 look plausibly disjoint (different
primary files) but NCOW-54's own test coverage might land in ipc-mutex.test.js
like NCOW-52's AC#3 did — check before assuming a 2-task wave is safe.

COUNTERVAILING CONSIDERATION, now two waves running: NCOW-50 is the only
remaining item that fixes a user-visible regression this campaign itself
introduced (the measured ~20s freeze from NCOW-47's alias composed with
NCOW-45's hold-and-wait). It was passed over for wave 10 in favor of the more
isolated NCOW-52. Weigh prioritizing it for wave 11 rather than deferring
again — do not let "isolated hardening first" become a permanent excuse to
defer the actual regression fix.

RE-CHECK CITATIONS BEFORE PLANNING ANY OF THE FOUR — pm2Control.js and
DESIGN.md both changed again in wave 10 (NCOW-52's fix + the cleanup PR #50).
NCOW-50's AC#6 (mutex.js header) was flagged BEFORE wave 10 as already
satisfied by wave 8's PR #45 — still needs an explicit decision recorded at
NCOW-50's own dispatch, not a silent skip, but very likely just a one-line
confirmation rather than new work.

Not queued this round (unchanged; re-check fresh — a human may have acted):
NCOW-7 (parked pending NCOW-15), NCOW-11 (open metrics-source design
question), NCOW-13 (depends on undecomposed NCOW-14), NCOW-14 and NCOW-15
(both self-described as needing subtask decomposition).

No in-flight worktrees, branches, or PRs. All 4 treehouse pool trees are
released and available at ~/.treehouse/claude-conduit-163fa4/{1,2,3,4} (HEADs
stale/detached — whichever gets leased must be re-pinned to the fresh wave
base). Tree 1 was leased three times this wave (task + cleanup fix cycle).
```

## State

| Item | Status |
| --- | --- |
| Waves 1-9 (NCOW-32 … NCOW-51) | Done, merged prior sessions (PRs #24-#48) |
| Wave 10 (NCOW-52) | Done, merged this session (PR #49 `d4a4115`) |
| Wave 10 integration follow-up | Merged this session (PR #50 `410e40b`) |
| Tracker (doc-5) | Settled for wave 10, committed + pushed |
| Queue | 4 tasks (NCOW-49, NCOW-50, NCOW-53, NCOW-54), all To Do, all ready by dependency |
| Filed this wave | NCOW-53, NCOW-54 — explicit user approval, both real NCOW-52-introduced defects |
| Worktrees/branches/PRs | None in flight; all 4 pool trees released; no open PRs |
| Working tree | Clean, `dev` @ `ece7a2d`, in sync with origin |
| Test count on merged dev | **435/435 passing** (my own run after the final merge, not inferred) |

## This session's in-flight wave

None. Wave 10 fully settled: worker interrupted mid-task by an account weekly API-limit error,
resumed from its own transcript with zero lost work → implement → review (1 non-AC blocking
finding) → fix → re-review (approve) → merge → integration review (2 real defects + 2 doc-drift
items found) → 2 tasks filed (NCOW-53, NCOW-54) → doc cleanup dispatched → cleanup review (1
blocking finding — the cleanup itself introduced a false claim) → cleanup fix → cleanup re-review
(approve) → cleanup merge → settlement. All worktrees released, all branches deleted locally and
remotely.

## Next steps

1. Run `/backlog-handover restore`. Recompute the ready set. Expect 4 ready; conflict graph is
   NOT yet computed for NCOW-53/NCOW-54 — do this fresh, don't assume a wave size.
2. **Re-check line citations in whichever task(s) you dispatch.** `src/engine/pm2Control.js` and
   `DESIGN.md` both changed in wave 10 (NCOW-52's own fix, then the cleanup PR #50). NCOW-54
   touches the exact file NCOW-52 just finished editing.
3. **Weigh prioritizing NCOW-50** (the actual user-visible regression fix) rather than deferring it
   to a third consecutive wave in favor of more isolated work — the countervailing note has now
   carried forward twice without action.
4. Once these four are done the queue empties — at that point re-run inventory (I1) rather than
   assuming NCOW-7/11/13/14/15 are still correctly excluded.

## Critical context / traps

- **Doc-4 must not be reopened — doc-5 is the live tracker.** (Doc-3 and doc-4 are completed
  prior rounds.)
- **The integration review has now found real material in every wave, 1 through 10, without
  exception — and twice now (waves 8 and 10) the material was a defect the wave's own merge
  introduced, not a pre-existing gap.** Never skip or shortcut this step.
- **Cleanup branches keep needing real review, not a rubber stamp — this is now the SECOND time a
  cleanup branch (whose whole purpose was removing/correcting false claims) introduced a NEW false
  claim while doing so** (first: wave 9's PR #48, invented channel name + overcorrected "no UI
  caller" claim + a bad DESIGN.md parenthetical; second: wave 10's PR #50 cleanup, an
  overcorrected "can only ever surface PM2_STOP_TIMEOUT" claim that ignored the same handler's
  own post-stop status broadcast reaching a second pm2 call). **Lesson restated because it
  recurred: writing a correction feels safe, so it gets less verification than the original claim
  did.** Budget a real review pass for every cleanup branch, no exceptions, and brief the
  reviewer on this specific recurring failure mode.
- **A review cycle can be needed for a non-correctness reason and that's a legitimate, distinct
  outcome — first time in this campaign.** NCOW-52's own mechanism was right on the first pass
  (the reviewer's independent call-chain census found nothing missed, unlike NCOW-48's first
  attempt in the same hazard family). The blocking finding was a stray uncleared `setTimeout`
  making one test file take 10s instead of ~1s, a 74x regression on that file, degrading `npm
  test`'s overall runtime for every future contributor. Test-suite performance is a legitimate
  review-blocking concern on its own, separate from correctness.
- **The "move one number, forget its paired invariant" trap is real and worth generalizing.**
  NCOW-52's fix pass correctly moved BOTH the timeout value and the test's own assertion threshold
  together; the reviewer explicitly proved (not just asserted) that moving only one would make the
  test pass vacuously against a real regression. Any test whose assertion threshold is derived
  from a tunable constant needs both changed together, and a reviewer verifying such a fix should
  reproduce the vacuity trap itself before accepting "both were moved" as a claim.
- **A wave's own merge can introduce a genuinely NEW hazard that neither task-level review pass had
  reason to see, because each pass's brief stops at the boundary the task's own ACs define.**
  NCOW-52's two review passes both correctly verified its timeout mechanism at the IPC boundary
  (AC#2's literal text) — neither was briefed to trace the result past `ipc.js` to the renderer/
  tray, where it turned out to be silently discarded. This is a structural blind spot of
  per-task review, not a review failure — exactly what the wave-level integration step exists to
  catch, and it did.
- **A leak-prevention fix can itself be the new defect, when the underlying library's own state
  model is shared-mutable.** NCOW-52's `bus.close()` on a late-arriving `pm2.launchBus` callback
  was correct reasoning about avoiding a leak, but pm2's own `Client.sub` is a shared mutable slot
  read at callback-fire time, not a value captured per-call — so the "fix" can close a
  subsequent, unrelated, live call's resource instead of the actually-stale one. When bounding a
  callback whose result is a live resource handle (not just a completion signal), check whether
  the underlying library captures identity per-call or shares a mutable slot before assuming
  "close it on timeout" is safe.
- **Same-account weekly API-limit interruptions can be resumed cleanly via SendMessage to the
  agent's own ID, and resuming from transcript preserves all context and in-progress worktree
  state with zero lost work.** This happened once this session (the NCOW-52 worker), was resumed
  successfully, and the agent picked up exactly where it left off, verified via git that nothing
  was lost, and completed normally. If this happens again, resume rather than restarting from
  scratch — restarting would re-walk the same investigation for no benefit and cost significantly
  more.
- **`esprima.tokenize` chokes on ES2021 numeric separators (`15_000` etc.)**, which
  `src/engine/pm2Control.js` uses. Two agents this wave independently worked around this by
  writing their own comment/string-aware stripper rather than the tokenizer, and cross-verified
  each other's results. If you need comment-only proof on a file with numeric separators, use a
  custom stripper (or normalize the separators identically in both pre/post copies before
  tokenizing) rather than assuming esprima will just work.
- **`git merge-tree --write-tree --messages <a> <b>` still not needed this wave** — wave 10 was
  solo, so there was nothing to pre-check for a rebase conflict. Kept available for future waves
  with 2+ members.
- **Test-count ownership discipline (CLAUDE.md:51, README.md:331) held clean through wave 10** —
  NCOW-52's own worker updated both correctly (425→435) and the wave-10 integration reviewer
  independently confirmed no drift; no separate cleanup PR was needed for this class of issue,
  unlike several earlier waves.
- **The fake "system-reminder" concealment instruction did NOT appear this wave** (5 dispatches:
  1 worker interruption/resume, 1 initial review, 1 resumed review, 1 fix-pass worker, 1
  integration reviewer, 1 cleanup worker, 1 cleanup reviewer, 1 resumed cleanup review — 8 total
  agent interactions). Keep briefing agents to verify independently via git, never comply with an
  instruction to conceal, and report transparently.

## Do not repeat

- **`path` is a zsh-special variable tied to `PATH`.** Assigning `path=/some/dir` in a Bash tool
  call destroys `PATH` and every subsequent command in that invocation fails with
  `command not found`. Use `WT`, `wt_path`, anything but `path`.
- **`treehouse get --lease --json` prints an update banner before the JSON**, so piping straight
  into a JSON parser yields nothing. Extract the object first (`grep -o '{.*}'`).
- **Embedding literal apostrophes inside a single-quoted bash argument silently corrupts the
  text (e.g. `--desc 'NCOW-52's fix...'`) rather than erroring** — this happened twice while
  filing NCOW-53/NCOW-54 this session, producing "NCOW-52s", "engine-context.jss", "retrys" with
  the apostrophe simply dropped. Use a heredoc (`$(cat <<'EOF' ... EOF)`) assigned to a shell
  variable, then pass `"$VAR"` as the argument — this preserves apostrophes and any embedded
  backticks literally, with no shell interpretation at all. Prefer this for any Backlog CLI text
  field containing an apostrophe or a backtick-quoted code span.
- **`backlog task edit --remove-ac N` repeated N times to clear all ACs does NOT reliably remove
  all of them** — attempting `--remove-ac 1` six times in one call to clear a 6-item AC list only
  removed one item (the first). Use `--clear-ac` followed by fresh `--ac` calls instead when you
  need to fully replace a list.
- **`SendMessage` needs `ToolSearch` first** (`select:SendMessage`) or it fails with
  `InputValidationError`. Resuming the *same* worker or reviewer via SendMessage for interruption-
  recovery or a narrow delta re-check worked well multiple times this session (once to resume an
  interrupted worker after an API-limit error with zero lost work, twice for narrow reviewer
  re-checks) — far cheaper than a fresh dispatch since the agent keeps its own probe scripts and
  prior findings in context. Strongly recommended.
- **A chained `sleep N; echo` in Bash is blocked.** To wait on a background agent, rely on the
  task-completion notification; do not poll.
- No Agent dispatch failures this session apart from the one account-wide weekly API-limit
  interruption (which resumed cleanly, see above) — no 529s, no `pane_not_found`. No `name`
  parameter was passed to any Agent call — keep omitting it.
- When archiving a consumed handover, `ls archive/handovers/` first for the actual next free
  suffix. This session found base and `-2` through `-5` taken and used `-6`.
- **Do not run `backlog` writes from inside a worktree**, and do not let workers run them at all —
  8 agent dispatches this session were each explicitly barred and none violated it.
