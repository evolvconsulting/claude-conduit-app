# Handover — wave 15 complete (NCOW-56 Done, 3 review passes + 2 fix cycles + cleanup, 1 task filed + 1 rescoped)

**Date**: 2026-08-06 | **Grounded against**: `dev` @ `699dc5f`, clean, 0 ahead / 0 behind
`origin/dev` (verified after this session's final push; the archived handover from the prior
session is the only untracked file, committed as part of this handover's own commit) |
**Tracker**: doc-5

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. Wave 15 is
fully merged and settled — NCOW-56 — 25 tasks resolved across waves 1-15.
Queue order confirmed by user on 2026-08-04; do not re-ask.

Queue is 3 items: NCOW-57, NCOW-58, NCOW-59. All ready by dependency
(NCOW-57/58 on NCOW-55+NCOW-56, NCOW-59 on NCOW-56 — all Done).
RECOMPUTE THE CONFLICT GRAPH LIVE. Provisional, NOT ground truth:
- NCOW-57 and NCOW-59 both land in src/main/tray.js — expect a real conflict.
- NCOW-58 is docs-only (README.md/DESIGN.md), but check whether NCOW-57's own
  AC#2 ("document why the portable-build gap is an accepted gap") would put
  NCOW-57 in README too. If it would, 58 and 57 conflict as well.
- NCOW-57 is the ONLY item needing live app verification. Shared Machine State
  caps that to one wave member regardless of file conflicts.

NCOW-57 environment check done this session (2026-08-06): winvm is LIVE on the
tailnet (100.76.121.102, ping OK, windows). A linuxvm host exists (100.68.142.68)
but was not showing an active connection. NOT VERIFIED: whether linuxvm has a
desktop environment with a running notification daemon. NCOW-57's AC#4 has an
explicit escape hatch ("or the absence is confirmed and documented") if it
doesn't. Verify before dispatching, don't assume.

NCOW-57 sequencing note from the wave-15 review: NCOW-56 inserted a 34-line
comment block IMMEDIATELY AFTER the Notification.isSupported() docstring that
NCOW-57 owns. It did not modify those lines, but NCOW-57 should rebase onto
current dev rather than cherry-pick.

NCOW-58's scope was EXTENDED at wave-15 settlement with user approval — 2 new
ACs (both failure classes now that NCOW-56 landed; plus the tray-Start-vs-
dashboard-#start-btn asymmetry that exists only as a code comment). Its
dependencies are now NCOW-55 + NCOW-56. Re-read it fresh; the version in the
wave-14 handover is stale.

CRITICAL BRIEFING FOR EVERY WORKER AND REVIEWER — two failure classes NEW to
this campaign's catalogue, both found in wave 15:

1. "A CORRECTION THAT FIXES AN INSTANCE RATHER THAN THE CLAIM." Fix pass 1
   corrected a false pm2Control.stop() claim in src/main/tray.js and left a
   VERBATIM DUPLICATE of the same falsehood in test/main/tray-actions.test.js —
   both written by the same branch. Its commit message reported the finding as
   fixed. Cost a full extra review cycle. MITIGATION, now mandatory in every fix
   dispatch: whenever a claim is corrected, sweep the WHOLE repo for every
   restatement of it and REPORT the sweep, including "nothing further". Requiring
   the report is what makes it happen. Extend the sweep to claims corrected in
   EARLIER passes on the same branch.

2. "PASSES PRE-FIX" IS NOT EVIDENCE A TEST IS A DESIGNED CONTROL, AND A COMMENT
   CLAIMING A GUARD IS NOT A GUARD. Two review passes read a test's pre-fix pass
   as deliberate control design; it passed because it was a VERBATIM COPY of a
   pre-existing test. Separately its comment claimed it would fail if
   `result.ok === false` were loosened to `!result.ok` — the integration reviewer
   applied that exact edit and ALL 474 TESTS STILL PASSED. Three separate checks,
   none substituting for another: non-vacuity (revert production, confirm fail);
   novelty (diff the new test body against nearby existing tests); and guard
   claims verified BY EXPERIMENT (make the change the comment says it catches and
   observe a failure). Reading the test is not proof.

The older established classes still apply and still recur — fabricated specifics
(a plausible but nonexistent error code), false claims about counterfactual/
pre-fix behavior, and self-invalidating relative git refs (HEAD/HEAD~N; always
use an absolute SHA). Wave 15 hit the false-counterfactual class in ORIGINAL
work again, not only in corrections.

Not queued this round (re-check fresh — last freshly checked 2026-08-06):
NCOW-7 (parked pending NCOW-15), NCOW-11 (open metrics-source design question),
NCOW-13 (depends on undecomposed NCOW-14), NCOW-14 and NCOW-15 (both
self-described as needing subtask decomposition). All still last-updated
2026-07-31.

No in-flight worktrees, branches, or PRs. All 4 treehouse pool trees released
and available at ~/.treehouse/claude-conduit-163fa4/{1,2,3,4}. Tree 1 was leased
and released cleanly twice this session (implementation + 2 fix passes, then the
integration review + cleanup) — the warm-pool-reuse streak continues to hold.

This session stopped between waves ON THE USER'S EXPLICIT INSTRUCTION after one
heavy wave (3 review passes, 2 fix cycles, integration review, cleanup pass),
NOT because the queue emptied.
```

## State

| Item | Status |
| --- | --- |
| Waves 1-14 (NCOW-32 … NCOW-55) | Done, merged prior sessions (PRs #24-#59) |
| Wave 15 (NCOW-56) | Done, merged this session (PR #60 `905b8ad`) |
| Wave 15 cleanup | Merged this session (PR #61 `ab2ec25`, 1 review pass, zero fix cycles) |
| Tracker (doc-5) | Settled for wave 15, committed + pushed (`699dc5f`) |
| Queue | 3 tasks — NCOW-57, NCOW-58 (rescoped this session), NCOW-59 (filed this session) |
| Worktrees/branches/PRs | None in flight; all 4 pool trees released; no open PRs |
| Working tree | Clean, `dev` @ `699dc5f`, in sync with origin |
| Test count on merged dev | **476/476 passing** (verified directly by the orchestrator, not inferred) |

## This session's in-flight wave

None. Wave 15 fully settled: dispatch (real conflict-graph computation — the graph was
pairwise-complete across all 3 queued items, so solo by computation not construction) →
implement (worker, treehouse-leased worktree pinned at wave base `5b9e49e`; 7 new tests,
467 → 474) → task-level review **3 passes / 2 fix cycles** (pass 1 withheld AC#2 over a false
illustration; pass 2 confirmed all 5 ACs but blocked on a duplicated falsehood; pass 3 approved)
→ serial merge (clean rebase, mandatory re-verify, PR #60 `905b8ad`) → wave-level integration
review (6 findings, 15th consecutive wave with real material) → 2 user-approved follow-ups
(NCOW-59 filed, NCOW-58 rescoped) → cleanup dispatch → cleanup review (opus, `approve`, first
pass) → cleanup merge (PR #61 `ab2ec25`, 474 → 476) → settlement (check-ac 1-5, final-summary,
`-s Done`, plus a correction to NCOW-56's own earlier notes) → tracker update → this handover.

## Next steps

1. Run `/backlog-handover restore`. Recompute the ready set and the conflict graph live. Expect
   3 ready (NCOW-57/58/59) with a probable NCOW-57↔NCOW-59 collision in `src/main/tray.js`.
2. **Verify linuxvm's desktop/notification-daemon situation before dispatching NCOW-57** — it is
   the one unverified precondition for that task's AC#4, and the AC has an escape hatch if the
   environment genuinely can't support it.
3. **Brief every worker and reviewer on the two new failure classes above** (claim-sweep
   discipline; guard claims verified by experiment). Both were found in wave 15 and both cost
   real cycles.
4. Once NCOW-57/58/59 are done, re-run inventory (I1) rather than assuming NCOW-7/11/13/14/15 are
   still correctly excluded.

## Critical context / traps

- **Doc-4 must not be reopened — doc-5 is the live tracker.**
- **The integration review has now found real material in every wave, 1 through 15, without
  exception.** Never skip or shortcut it. Wave 15's headline finding was only reachable by
  *experiment* — a comment asserted a test guarantee, and the only way to expose it was to make
  the change the comment claimed the test would catch and watch nothing fail.
- **The staleness sweep came back CLEAN for the first time in this campaign** (wave 15). Nine
  tray mentions across README/DESIGN/CLAUDE were checked and all remained accurate, because none
  of them describes what happens when a tray action *fails*. That absence is NCOW-58's scope, not
  a defect — do not let a future reviewer report it as a finding.
- **NCOW-56 changed a user-visible string.** A tray action failing with an `{ok:false}` carrying
  no `error` key used to render the notification as literally "Start failed: [object Object]";
  it now renders "Start failed: unknown error". The fallback chain
  (`err?.message ?? err?.code ?? 'unknown error'`) also affects the *reject* path, so a thrown
  primitive carrying content (`throw 'boom'`) now renders "unknown error" instead of "boom". No
  production path reaches it, `console.error` still prints the raw value, and it is net-positive
  for the null/undefined rejection case (NCOW-42/43). This trade-off was reviewed and accepted
  deliberately — it is on the record, not an oversight.
- **A minimal, call-site-local fix won for the third wave running.** NCOW-56 kept
  `createTrayActions({ mutexes, handlers })`'s first argument unchanged because two pre-existing
  regex identity guards pin that literal text. Any future tray work must respect the same
  constraint or those guards break.
- **The AC#2 decision record lives ONLY as a code comment in `src/main/tray.js`.** The deliberate
  asymmetry — tray Start stays enabled with no manifest and notifies on click, unlike the
  dashboard's disabled `#start-btn` — is a real behavior a user can hit and is documented nowhere
  they can read. NCOW-58's extended scope now covers this.

## Do not repeat

- **`path` is a zsh-special variable tied to `PATH`.** Assigning `path=/some/dir` in a Bash tool
  call destroys `PATH` and every later command in that invocation fails. Use `WT`, `wt_path`.
- **The Agent tool's own `isolation: "worktree"` conflicts with this skill's treehouse-managed
  worktrees — never pass both.** No isolation parameter was passed to any dispatch this session.
- **`treehouse get --lease --json` prints an update banner before the JSON** — extract the object
  first (`grep -o '{.*}'`).
- **Embedding literal apostrophes/backticks inside a single-quoted bash argument silently corrupts
  the text.** Use a heredoc assigned to a shell variable, then pass `"$VAR"`. This session used
  `$(cat <<'EOF' ... EOF)` for every Backlog text field, and a Python script + scratchpad file for
  the tracker-doc rewrite (the doc is ~1500 lines; string-replacing into it from bash is not
  viable).
- **Strip the YAML frontmatter (first 7 lines) before passing a tracker-doc copy to
  `backlog doc update --content`** — `awk 'NR>7'`. The CLI writes its own frontmatter.
- **`backlog task edit --ac` APPENDS acceptance criteria; `--acceptance-criteria` REPLACES all of
  them.** Used `--ac` to extend NCOW-58 without disturbing its existing three.
- **A fix pass that reports a finding as fixed may have fixed only the cited occurrence.** See the
  paste-ready prompt's briefing #1 — this is now a mandatory sweep-and-report in every fix
  dispatch, not a hope.
- **Do not run `backlog` writes from inside a worktree**, and do not let workers run them at all.
  Every dispatch this session was explicitly barred from this; none violated it.
- **User approval was sought via AskUserQuestion before filing NCOW-59 and before rescoping
  NCOW-58** — the correct, load-bearing sequence. The same question also asked the session-budget
  question, and the user chose to stop after wave 15.
- No Agent dispatch failures this session — no 529s, no interruptions. No `name` parameter was
  passed to any Agent call; keep omitting it. No `ScheduleWakeup` fallbacks were used either —
  every dispatch's completion notification arrived on its own, so the polling fallback earlier
  sessions used appears unnecessary.
- When archiving a consumed handover, `ls archive/handovers/` first for the next free suffix. This
  session's archived at `-2` (the base `2026-08-06` name was taken by the prior session).
