# Handover — wave 12 complete (NCOW-49 Done, 1 fix cycle + 1 integration-review cleanup)

**Date**: 2026-08-05/06 | **Grounded against**: `dev` @ `683cdcd`,
clean, 0 ahead / 0 behind `origin/dev` (verified after this session's final commit was pushed) |
**Tracker**: doc-5

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. Wave 12 is
fully merged and settled — NCOW-49 — 22 tasks resolved across waves 1-12.
Queue order confirmed by user on 2026-08-04; do not re-ask.

Queue is now just 1 item: NCOW-53 (on NCOW-52, Done). Since it's the only queued
task, wave 13 will be solo by definition — no conflict-graph computation is
needed to establish that, but RE-VERIFY its citations fresh regardless (this
project's own file pair has drifted in every wave that touched it).

CRITICAL CONTEXT CARRIED FROM WAVE 12, READ THIS BEFORE DISPATCHING NCOW-53:

Wave 12 deferred NCOW-53 out of wave 12 specifically because NCOW-49's own new
AC#8 explicitly named `src/main/mutex.js` as a sanctioned implementation
surface, and mutex.js was a proven hub file for this exact pairing one wave
earlier (NCOW-50/NCOW-53 both touched it at wave 11). THAT PREDICTED COLLISION
DID NOT MATERIALIZE: NCOW-49 as actually merged (PR #54, `d49f86f`) implemented
AC#8 entirely inside `ipc.js` and never touched `mutex.js` at all (confirmed via
identical blob SHA, independently, by both the task-level reviewer and the
wave-12 integration reviewer). So there is no longer any FILE-level conflict
between the two tasks' merged/queued states.

BUT the wave-12 integration review found a narrower, real consideration to brief
NCOW-53's own worker on instead of a file conflict:

1. NCOW-49 added 4 places that quote `mutex.js:53`'s exact
   `chain = run.catch(() => {})` line verbatim as justification for its own
   AC#8 mechanism: `src/main/ipc.js:117-118`, `:155`, `:233` (inside a thrown
   error message), and `src/main/engine-context.js:309`. If NCOW-53's own fix
   changes that line's shape (moves it, rewords it, or changes what it does),
   those 4 quotations go stale in the SAME PR as the change that invalidates
   them — brief the worker to check for this, and re-verify these citations
   are still accurate regardless (this pair of files moves every wave).

2. `withLocks()` (`ipc.js`, currently ~line 755-761 as of the wave-12 merge —
   re-verify) invokes each acquired lock and DISCARDS every returned promise
   except the shared one; only `mutex.js:53`'s own `.catch(() => {})` is what
   marks the other N-1 discarded promises as "handled" so they don't become
   unhandled rejections. This was independently verified this session with a
   direct probe: a naive AC#2 implementation that logs-and-rethrows at
   `mutex.js:53` (rather than swallowing) produces 3 unhandled rejections on a
   throwing 3-lock `uninstall:run`, and would permanently break that domain's
   lock for all subsequent callers. **Recommend NCOW-53 satisfy its AC#2 at the
   `tray.js` call site** (wrap `mutexes.proxy.run(() => handlers.proxy.stop())`
   in its own `.catch(...)` there, matching the minimal-footprint approach
   NCOW-49's own worker used for its analogous choice) **rather than inside
   `mutex.js` itself.** If NCOW-53's worker judges a `mutex.js`-level change is
   still the better solution, it must keep a rejection handler attached to
   `run` and re-verify the throwing-multi-lock case doesn't regress.

Full reasoning, the exact quoted-line citations, and the reviewer's own
verification method are recorded in doc-5's Frontier section (wave 12
SETTLEMENT note) and the NCOW-53 row of the Queue table — read both before
dispatch, don't just trust this paste-ready summary.

Not queued this round (unchanged; re-check fresh — a human may have acted):
NCOW-7 (parked pending NCOW-15), NCOW-11 (open metrics-source design
question), NCOW-13 (depends on undecomposed NCOW-14), NCOW-14 and NCOW-15
(both self-described as needing subtask decomposition).

No in-flight worktrees, branches, or PRs. All 4 treehouse pool trees are
released and available at ~/.treehouse/claude-conduit-163fa4/{1,2,3,4} (HEADs
stale/detached — whichever gets leased must be re-pinned to the fresh wave
base). Tree 1 was leased twice this session (NCOW-49's task, then the wave-12
cleanup PR) with zero adverse effect, continuing this campaign's now-long
streak of clean warm-pool reuse.

Once NCOW-53 is done the queue empties for the second time this campaign round
— re-run inventory (I1) rather than assuming NCOW-7/11/13/14/15 are still
correctly excluded; several waves have now passed since they were last freshly
checked (last fresh check: wave-12 dispatch, 2026-08-06).
```

## State

| Item | Status |
| --- | --- |
| Waves 1-11 (NCOW-32 … NCOW-54) | Done, merged prior sessions (PRs #24-#53) |
| Wave 12 (NCOW-49) | Done, merged this session (PR #54 `d49f86f`) |
| Wave 12 integration follow-up | Merged this session (PR #55 `b148f4b`, 1 review pass, zero fix cycles) |
| Tracker (doc-5) | Settled for wave 12, committed + pushed (`683cdcd`) |
| Queue | 1 task (NCOW-53), To Do, no known file conflict but a semantic mutex.js:53 coupling to brief the worker on (see above) |
| Worktrees/branches/PRs | None in flight; all 4 pool trees released; no open PRs |
| Working tree | Clean, `dev` @ `683cdcd`, in sync with origin |
| Test count on merged dev | **457/457 passing** (independently verified by the orchestrator and by both task-level review passes plus the cleanup's own review pass — not inferred) |

## This session's in-flight wave

None. Wave 12 fully settled: dispatch (fresh conflict-graph computation over the ready set
{NCOW-49, NCOW-53}, reasoned deviation from the wave-11 "disjoint" call once NCOW-49's own AC#8
existed to consider — solo wave, NCOW-49 only) → implement (worker, first pass: 440→454 tests) →
task-level review pass 1 (`request_changes` on AC#1 alone — a transparent `.run`-forwarding
wrapper evaded the initial guard while still chain-sharing) → fix pass 1 of 2 allowed (switched
the dedupe key to `.run` identity, bundled 2 non-blocking findings; 454→457 tests) → task-level
review pass 2 (`approve`, all 8 ACs independently reconfirmed with fresh reproduction) → serial
merge (rebase, re-verify, PR #54, squash-merge `d49f86f`) → wave-level integration review (found
real material for the 12th consecutive wave: 2 stale test counts + 1 factually-mischaracterized
claim added in the fix pass — this campaign's 4th "correction introduces a new false claim"
instance, caught before it could compound) → cleanup dispatch (direct worker follow-up, no new
task) → cleanup review (approve, first pass, reviewer independently re-reproduced the corrected
claim's exact numbers) → cleanup merge (PR #55, `b148f4b`) → settlement (check-ac 1-8,
final-summary, `-s Done`) → tracker update → this handover.

## Next steps

1. Run `/backlog-handover restore`. Recompute the ready set. Expect 1 ready (NCOW-53) — a
   trivially solo wave since it's the only queued item, but still re-verify its file citations
   fresh at dispatch (this file pair — `dashboard-view.js`, `tray.js`, `mutex.js` — has not
   itself drifted between waves the way the `ipc.js`/`ipc-mutex.test.js` pair repeatedly has,
   but confirm rather than assume).
2. **Brief NCOW-53's worker on the mutex.js:53 semantic-coupling note above** — 4 stale-quotation
   risk sites plus the unhandled-rejection hazard on the multi-lock throwing path — before
   dispatch, not as an afterthought during review.
3. Once NCOW-53 is done, the queue is empty for the first time since this round's init (2026-08-04)
   — re-run inventory (I1) rather than assuming NCOW-7/11/13/14/15 are still correctly excluded.

## Critical context / traps

- **Doc-4 must not be reopened — doc-5 is the live tracker.**
- **The integration review has now found real material in every wave, 1 through 12, without
  exception.** Never skip or shortcut this step, even on a solo wave with a clean task-level
  review — wave 12 itself is proof: NCOW-49's own task-level review was thorough (2 passes,
  fresh reproduction of every AC) and still missed a real, mischaracterized claim the fix pass
  introduced, caught only by the separate integration-review pass reading the merged state fresh.
- **The "correction introduces a new false claim" failure class has now recurred a FOURTH time**
  (PR #45, PR #48/#50, wave 11's PR #53, and this wave's fix-pass comment claiming a regression
  "hangs" a test when it actually gets cancelled by node's test runner). Every occurrence so far
  has been in a comment/doc correction written under less scrutiny than the original claim it
  was fixing. The mitigation that has worked every time: brief the reviewer on this specific
  pattern explicitly before dispatching it against any cleanup/correction branch, and have it
  independently REPRODUCE the new claim's exact numbers rather than just re-reading them. Keep
  doing this — four occurrences across twelve waves means this is a durable structural property
  of the work, not something that fades with campaign experience.
- **A pre-implementation conflict prediction resolved WRONG in the "no collision" direction this
  wave — the second time this campaign has seen this exact pattern** (the first: NCOW-32 was
  predicted to touch `src/main/index.js` at waves 4/5 and didn't). NCOW-49's AC#8 was dispatched
  solo specifically because it might have needed `mutex.js`, which would have collided with
  NCOW-53's own deferred `mutex.js:53` target. It didn't need `mutex.js` at all. **This is not a
  failure of the over-approximate-on-ambiguity conflict-graph method** — over-approximating from
  a real, reasoned risk before a task is implemented is still the correct conservative call, and
  it cost exactly one wave of parallelism (NCOW-53 pushed out by one wave), never a real merge
  conflict. The lesson is the same one this campaign already learned from NCOW-32: a
  pre-implementation conflict prediction is provisional in EITHER direction and must be
  re-verified once the branch actually exists, not carried forward as settled fact.
- **A wrong prediction, once resolved, can still leave behind a real (if narrower) risk worth
  carrying forward — this wave found exactly that.** The `mutex.js` FILE conflict is gone, but
  NCOW-49 created a semantic coupling to `mutex.js:53` (4 verbatim quotations of its exact code
  shape, plus a genuine unhandled-rejection hazard on the multi-lock throwing path if that line's
  swallow-behavior is ever changed carelessly) that NCOW-53's own worker needs briefing on. Don't
  let "the predicted conflict didn't happen" collapse into "there's nothing to brief the next
  wave on" — re-derive what's ACTUALLY true of the merged state, which is not the same question
  as whether the original prediction was right.
- **Review-fix cycles keep earning their keep.** Wave 12 needed exactly one, on AC#1 alone, and
  the pattern that made it succeed was unchanged from every prior instance: the reviewer's
  finding named a specific, reproducible case (the exact Proxy/`Object.assign`/copied-`.run`
  shapes, with observed lock counts and handler-entry booleans), and the fix pass was handed
  that finding verbatim rather than a vague "look at AC#1 again."
- **Concurrency primitives keep earning their proportionally deeper review, and it paid off
  again this wave.** NCOW-49 is squarely in the family NCOW-45/46/47/50 already established as
  needing extra scrutiny (it directly reworks `resolveDomainLocks()`/`assertLockOrderIsConsistent()`
  themselves). Both review passes reproduced every AC directly against mutated source rather than
  trusting the delivered tests, and pass 2 specifically hunted for (and ruled out) a NEW evasion
  the AC#1 fix itself might have introduced — not just re-confirming the fix closed the OLD one.
- **`esprima.tokenize` remains the standard tool for proving a change is comment-only**, used
  independently by the task reviewer (twice, across both passes), the integration reviewer, and
  the cleanup reviewer this wave alone — zero token-stream diffs confirmed `engine-context.js`'s
  changes were comment-only at every stage.
- **Test-count ownership discipline (`CLAUDE.md:51`, `README.md:331`) needed an explicit cleanup
  this wave** (440→457) rather than staying current in-branch, unlike several recent waves where
  the primary branch's own reviewer caught and fixed it before merge. Worth normalizing: brief
  every task-level worker to check/update these two lines as part of its own commit when its
  change adds tests, the way NCOW-52's wave did, rather than relying on the wave-level cleanup to
  catch it after the fact.

## Do not repeat

- **`path` is a zsh-special variable tied to `PATH`.** Assigning `path=/some/dir` in a Bash tool
  call destroys `PATH` and every subsequent command in that invocation fails with
  `command not found`. Use `WT`, `wt_path`, anything but `path`.
- **The Agent tool's own `isolation: "worktree"` parameter conflicts with this skill's
  treehouse-managed worktree convention — do not pass both.** This session initially dispatched
  NCOW-49's worker with `isolation: "worktree"` alongside a prompt that also named an
  already-leased, already-branched treehouse path as the required cwd. That's two independent
  worktree-management mechanisms fighting over the same task. Caught immediately (before any
  real work happened) by checking `git worktree list --porcelain` for a stray extra worktree —
  found none, the agent hadn't gotten that far — stopped the agent via `TaskStop`, verified the
  treehouse worktree was still clean and on the right branch, and redispatched with `isolation`
  omitted entirely. **When this skill has already leased and branched a treehouse worktree for a
  worker, never pass `isolation: "worktree"` (or any isolation parameter) to that worker's Agent
  call — the cwd instruction in the prompt is the only worktree-management mechanism needed, and
  is sufficient on its own.**
- **`treehouse get --lease --json` prints an update banner before the JSON**, so piping straight
  into a JSON parser yields nothing. Extract the object first (`grep -o '{.*}'`).
- **Embedding literal apostrophes inside a single-quoted bash argument silently corrupts the
  text** rather than erroring. Use a heredoc (`$(cat <<'EOF' ... EOF)`) assigned to a shell
  variable, then pass `"$VAR"` as the argument, for any Backlog CLI text field containing an
  apostrophe or backtick-quoted code span. The same heredoc-to-variable technique is also the
  right approach for `backlog doc update --content`, whose payload is far too large and
  backtick-heavy to hand-type safely as an inline CLI argument — this session again wrote the
  tracker content to a scratchpad file first, edited it there with the Edit tool (never touching
  the real tracked doc file directly), then loaded it into a shell variable via `$(cat file)`
  before passing `"$VAR"` to `backlog doc update`.
- **`backlog task edit --remove-ac N` repeated N times to clear all ACs does NOT reliably remove
  all of them** — use `--clear-ac` followed by fresh `--ac` calls instead when you need to fully
  replace a list. (Not needed this wave.)
- **A background `ScheduleWakeup` fallback of ~1200s per dispatched agent worked cleanly this
  session** for every worker/reviewer stage (implementation ~24min, review ~54min, fix pass
  ~10min, re-review ~7min, integration review ~9min, cleanup worker ~2min, cleanup review ~4min)
  — none of the fallback wakeups actually fired before the real task-completion notification
  arrived; they served purely as the required backstop. Keep scheduling one after every
  background dispatch rather than polling.
- No Agent dispatch failures this session beyond the `isolation` mistake above (self-caught,
  no wasted work) — no 529s, no `pane_not_found`, no unexplained interruptions. No `name`
  parameter was passed to any Agent call — keep omitting it.
- When archiving a consumed handover, `ls archive/handovers/` first for the actual next free
  suffix. This session found base through `-7` taken and used `-8`.
- **Do not run `backlog` writes from inside a worktree**, and do not let workers run them at
  all — every dispatch this session was explicitly barred from this and none violated it.
