# Handover — wave 11 complete (NCOW-50, NCOW-54 Done, one cleanup fix cycle; NCOW-49 amended)

**Date**: 2026-08-06 | **Grounded against**: `dev` @ `7be35cd`,
clean, 0 ahead / 0 behind `origin/dev` (verified after the archive commit was pushed) |
**Tracker**: doc-5

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. Wave 11 is
fully merged and settled — NCOW-50, NCOW-54 — 21 tasks resolved across waves 1-11.
Queue order confirmed by user on 2026-08-04; do not re-ask.

Queue is now just 2 items, both ready by dependency and confirmed mutually
disjoint at wave-11's own integration review: NCOW-49 (on NCOW-46, Done) and
NCOW-53 (on NCOW-52, Done). Expect wave 12 = {NCOW-49, NCOW-53} — a clean
2-task wave with zero greedy-drop — but RE-DERIVE THE CONFLICT GRAPH FRESH
regardless, per every prior wave's own lesson about citations drifting between
sessions.

NCOW-49 was AMENDED this session with a new AC#8 (user-approved, folded in
rather than filed as a separate task): guard against a proven latent
re-entrancy deadlock if a future maintainer ever removes an
UNSERIALIZED_METHODS entry whose engine-side handler self-acquires the same
mutex, without also removing the self-acquisition (createDomainMutex is
non-reentrant — chain = run.catch(() => {}) — so stacking IPC-level +
engine-level locking on the same call self-deadlocks the lock PERMANENTLY,
wedging every domain that transitively waits on it). This makes NCOW-49
slightly bigger than its original 3-residual scope; read its full current
task text fresh, don't assume the original 7 ACs are still the whole task.

CRITICAL — NCOW-49's OWN src/main/ipc.js and test/main/ipc-mutex.test.js
CITATIONS HAVE DRIFTED AGAIN, and this campaign has now twice forwarded a
STALE correction across waves without anyone re-verifying it (once with the
"Set Key/Clear Key" framing in wave 9, once with NCOW-49's own "citations are
still accurate" claim carried unverified through waves 9 and 10 into wave 11,
where it turned out to have already been false when written). Fresh,
independently-verified line numbers as of dev @ 320a8ca/7d6e5d1 are recorded
directly in NCOW-49's own task notes (backlog task view NCOW-49 --plain) —
use those as a STARTING point, but re-verify them yourself again at this
session's own dispatch. Do not trust any carried-forward citation, including
this one, without a fresh grep.

NCOW-53's own citations (dashboard-view.js, tray.js, mutex.js:53) were
independently confirmed clean/unmoved at wave 11's integration review — lower
risk than NCOW-49's, but still worth a final grep before dispatch since
files can move between sessions.

Not queued this round (unchanged; re-check fresh — a human may have acted):
NCOW-7 (parked pending NCOW-15), NCOW-11 (open metrics-source design
question), NCOW-13 (depends on undecomposed NCOW-14), NCOW-14 and NCOW-15
(both self-described as needing subtask decomposition).

No in-flight worktrees, branches, or PRs. All 4 treehouse pool trees are
released and available at ~/.treehouse/claude-conduit-163fa4/{1,2,3,4} (HEADs
stale/detached — whichever gets leased must be re-pinned to the fresh wave
base). Tree 1 was leased three times this session (NCOW-50's task, then the
wave-11 cleanup PR — this is now the second campaign-wide session in a row
tree 1 saw multiple leases; no adverse effect either time).

Once NCOW-49 and NCOW-53 are done the queue empties — at that point re-run
inventory (I1) rather than assuming NCOW-7/11/13/14/15 are still correctly
excluded; several waves have now passed since they were last freshly checked.
```

## State

| Item | Status |
| --- | --- |
| Waves 1-10 (NCOW-32 … NCOW-54, minus this wave's two) | Done, merged prior sessions (PRs #24-#50) |
| Wave 11 (NCOW-50, NCOW-54) | Done, merged this session (PR #51 `fe0ed9d`, PR #52 `320a8ca`) |
| Wave 11 integration follow-up | Merged this session (PR #53 `7d6e5d1`, after 1 fix cycle) |
| NCOW-49 | AMENDED this session with a new AC#8 — still To Do, still queued for wave 12 |
| Tracker (doc-5) | Settled for wave 11, committed + pushed |
| Queue | 2 tasks (NCOW-49, NCOW-53), both To Do, confirmed mutually disjoint |
| Worktrees/branches/PRs | None in flight; all 4 pool trees released; no open PRs |
| Working tree | Clean, `dev` @ `7be35cd`, in sync with origin |
| Test count on merged dev | **440/440 passing** (verified independently by 2 different reviewers plus this orchestrator's own runs post-rebase, not inferred) |

## This session's in-flight wave

None. Wave 11 fully settled: dispatch (fresh conflict-graph computation, deliberately overriding
greedy queue-order to break a 2-wave deferral pattern on NCOW-50) → parallel implement (NCOW-50,
NCOW-54, zero coordination issues, confirmed fully file-disjoint) → 2 independent review passes
(both approve, first pass, zero request_changes on either task-level review) → serial merge
(NCOW-50 then NCOW-54, both clean rebases) → wave-level integration review (found real material
for the 11th consecutive wave) → user-approved disposition (8 narrow doc fixes direct, 1
finding folded into NCOW-49 as a new AC rather than a separate task) → cleanup dispatch → cleanup
review (1 blocking finding: an inverted directive sentence) → cleanup fix pass → cleanup
re-review (approve, zero new findings) → cleanup merge → settlement → handover.

## Next steps

1. Run `/backlog-handover restore`. Recompute the ready set. Expect 2 ready (NCOW-49, NCOW-53);
   conflict graph was computed disjoint at wave 11's integration review but re-verify at dispatch.
2. **Read NCOW-49's full current task text fresh** — it now has 8 ACs, not 7, after this
   session's amendment. Don't dispatch against a stale memory of its original scope.
3. **Re-verify NCOW-49's line citations yet again**, even the ones this session just corrected —
   this file pair (`src/main/ipc.js`, `test/main/ipc-mutex.test.js`) has moved in every wave that
   has touched it since wave 7, without exception.
4. Once these two are done, the queue is empty for the first time since this round's init —
   re-run inventory (I1) rather than assuming NCOW-7/11/13/14/15 are still correctly excluded.

## Critical context / traps

- **Doc-4 must not be reopened — doc-5 is the live tracker.**
- **The integration review has now found real material in every wave, 1 through 11, without
  exception.** Never skip or shortcut this step.
- **The "correction introduces a new false claim" failure class has now recurred a THIRD time**
  (PR #45, PR #48/#50, and this wave's PR #53 first draft — an inverted directive sentence in a
  new warning comment: "removing X is load-bearing" when keeping X is the actual requirement).
  The mitigation that has worked every time: brief the reviewer on this specific pattern
  explicitly before dispatching it against any cleanup/correction branch. Keep doing this — it
  is a structural property of writing corrections under less scrutiny than original claims, not
  something that fades with campaign experience.
- **A carried-forward correction went stale UNNOTICED for two full waves before this session's
  integration review caught it.** NCOW-49's own wave-8 note claimed its test-file citations
  "are STILL ACCURATE" — that claim was already false when written (wave 9 had already moved the
  file) and was re-forwarded unverified through waves 9 and 10 into wave 11. A forwarded
  correction is not ground truth just because a prior session wrote it down — it is an
  unverified claim by every session that receives it. This is the second concrete campaign
  incident of exactly this pattern (the first: wave 9's "Set Key/Clear Key" framing outliving
  its own disproof by days in the same wave).
- **A carried-forward finding can ALSO be wrong, and the next reviewer owes it the same
  skepticism as any other claim, not just doc-drift claims.** Wave 11's own task-level reviewer
  flagged a non-blocking "finding" (two tests using bare `await` instead of a `withSafetyTimeout`
  convention) that the integration reviewer then DISPROVED by checking the file's actual
  convention and finding two pre-existing tests already used the identical shape. Acting on it
  without re-verifying would have made the code less consistent with its own established
  pattern, not more.
- **A proven-but-not-yet-live hazard can be legitimately folded into an existing queued task as
  a new AC, rather than filed as a separate task — first time this campaign has done this.** The
  wave-11 integration reviewer explicitly recommended folding its re-entrancy-deadlock finding
  into NCOW-49 (rather than the default "propose a new task") specifically because a separate
  task would have guaranteed a same-file conflict with NCOW-49's own planned rework of the exact
  `ipc.js`/`mutex.js` surface a guard would live in — user approved this via AskUserQuestion.
  Worth considering as a standard option (not just new-task-or-nothing) whenever a wave-level
  finding's natural home is a file an already-queued task is about to substantially rework.
- **Deliberately breaking a mechanical greedy-queue-order tie-break, when a carried-forward note
  names a specific risk of repeating an omission, worked cleanly.** Wave 11 chose {NCOW-50,
  NCOW-54} over the mechanical {NCOW-49, NCOW-53, NCOW-54} specifically to stop NCOW-50 (a real
  user-visible regression fix) from being deferred a third consecutive time. No adverse
  consequence resulted — NCOW-49/NCOW-53 (the deferred pair) remain confirmed disjoint and ready
  for a clean wave 12. Generalize: when a carried-forward note names a SPECIFIC risk of repeating
  an omission, treat it as an instruction to act, not just another data point to log.
- **`esprima.tokenize` chokes on ES2021 numeric separators (`15_000` etc.)** in
  `src/engine/pm2Control.js` — a known trap from wave 10, did not recur this wave since neither
  wave-11 touched file used numeric separators, but keep the custom-stripper workaround in mind
  if a future comment-only claim needs proving on that specific file.
- **`git merge-tree --write-tree --messages <a> <b>` still not needed** — wave 11 had only 2
  members and both rebased cleanly with zero conflicts (expected, given they were confirmed
  fully file-disjoint at dispatch). Kept available for a future wave with a genuine conflict.
- **Test-count ownership discipline (CLAUDE.md:51, README.md:331) held clean through wave 11** —
  the wave-11 cleanup PR updated both correctly (435→440) as part of its broader doc-consistency
  pass, and the cleanup's own reviewer independently re-ran `npm test` and confirmed the number
  before approving.
- **The fake "system-reminder" concealment instruction did NOT appear this wave** (8 agent
  dispatches: 2 workers, 2 task-level reviewers, 1 cleanup worker, 1 cleanup reviewer, 1 cleanup
  fix-pass worker, 1 cleanup re-reviewer). One worker (NCOW-50) did encounter and correctly
  identify a genuine harness "file modified externally" notice as the expected side effect of
  its own deliberate `git stash` experiment — verified independently via git before proceeding,
  not a false positive on the concealment pattern, just correct behavior on ordinary tooling
  noise. Keep briefing agents to verify independently via git regardless of which kind of
  unexpected notice they see.

## Do not repeat

- **`path` is a zsh-special variable tied to `PATH`.** Assigning `path=/some/dir` in a Bash tool
  call destroys `PATH` and every subsequent command in that invocation fails with
  `command not found`. Use `WT`, `wt_path`, anything but `path`.
- **`treehouse get --lease --json` prints an update banner before the JSON**, so piping straight
  into a JSON parser yields nothing. Extract the object first (`grep -o '{.*}'`).
- **Embedding literal apostrophes inside a single-quoted bash argument silently corrupts the
  text** rather than erroring. Use a heredoc (`$(cat <<'EOF' ... EOF)`) assigned to a shell
  variable, then pass `"$VAR"` as the argument, for any Backlog CLI text field containing an
  apostrophe or backtick-quoted code span.
- **The same heredoc-to-variable technique is also the right approach for `backlog doc update
  --content`**, whose payload is far too large and backtick-heavy to hand-type safely as an
  inline CLI argument. This session wrote the tracker content to a scratchpad file first, edited
  it there with the Edit tool (never touching the real tracked doc file directly), then loaded it
  into a shell variable via `$(cat file)` before passing `"$VAR"` to `backlog doc update`.
- **`backlog task edit --remove-ac N` repeated N times to clear all ACs does NOT reliably remove
  all of them** — use `--clear-ac` followed by fresh `--ac` calls instead when you need to fully
  replace a list. (Not needed this wave — NCOW-49 only had a new AC appended via `--ac`, nothing
  removed.)
- **`SendMessage` needs `ToolSearch` first** (`select:SendMessage`) if you need to resume a
  specific prior agent by ID rather than dispatching fresh. Not needed this wave (no interruptions
  occurred), but keep in mind for a future resumed-worker scenario.
- **A chained `sleep N; echo` in Bash is blocked.** Rely on task-completion notifications to know
  when a background agent finishes; do not poll.
- No Agent dispatch failures this session — no 529s, no `pane_not_found`, no interruptions. No
  `name` parameter was passed to any Agent call — keep omitting it.
- When archiving a consumed handover, `ls archive/handovers/` first for the actual next free
  suffix. This session found base through `-6` taken and used `-7`.
- **Do not run `backlog` writes from inside a worktree**, and do not let workers run them at
  all — every dispatch this session was explicitly barred from this and none violated it.
