# Handover — NCOW-31 follow-ups campaign, wave 1 complete (waves: 1, tasks resolved: NCOW-34, NCOW-33, NCOW-36, NCOW-35)

**Date**: 2026-08-04 | **Grounded against**: `dev` @ `55f550a`, clean, in sync with `origin/dev`
(no ahead/behind) | **Tracker**: doc-5

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. Wave 1 of
this campaign round (NCOW-34, NCOW-33, NCOW-36, NCOW-35) is fully merged and
Done. Queue order confirmed by user on 2026-08-04; do not re-ask. The ready
set is recomputed live at restore — do NOT hardcode a "next wave" list here.

Only NCOW-32 remains queued (proxy-mutex cluster: serialize Uninstall +
auto-update proxy-stop against the shared proxy mutex). It was deferred out
of wave 1 solely because it conflicted with NCOW-33 (engine-context.js) and
NCOW-35 (index.js) -- both now merged, so NCOW-32 is ready and will form a
solo wave 2 (no conflict-avoidance decision needed, it's the only queued
item). Re-run the file-citation conflict check fresh anyway rather than
trusting this note -- NCOW-32 will very likely touch src/main/engine-context.js
(the uninstall handler, ~lines 521-527 pre-wave-1, may have shifted slightly
after NCOW-33's merge) and src/main/index.js (autoUpdate's stopProxyForShutdown
wiring, ~lines 102-130 pre-wave-1, may have shifted after NCOW-35's merge) and
possibly src/main/autoUpdate.js.

No in-flight worktrees, branches, or PRs -- all 4 treehouse-pool trees are
released and available at ~/.treehouse/claude-conduit-163fa4/{1,2,3,4}.

Not queued this round (unchanged since this round's init, re-checked at wave
1 start): NCOW-7 (parked pending NCOW-15), NCOW-11 (open metrics-source
design question), NCOW-13 (depends on undecomposed NCOW-14), NCOW-14 and
NCOW-15 (both self-described as needing subtask decomposition). These need a
human planning/decomposition session, not another restore.

Before dispatching NCOW-32, propose to the user (via AskUserQuestion, do not
create unilaterally) three small non-blocking follow-up items surfaced during
wave 1's reviews -- see "Follow-ups to propose" below. If approved, file them
as new Backlog tasks between waves per this skill's Task-write concurrency
rule; if declined, drop them and proceed straight to NCOW-32.
```

## State

| Item | Status |
| --- | --- |
| Wave 1 (NCOW-34, NCOW-33, NCOW-36, NCOW-35) | All Done, merged, PRs #24-#27 + integration cleanup PR #28 |
| Tracker (doc-5) | Updated to reflect wave 1 settlement, committed + pushed (`55f550a`) |
| Queue | 1 task (NCOW-32), To Do, ready, forms wave 2 alone |
| Worktrees/branches/PRs | None in flight — all 4 treehouse-pool trees released and available |
| Working tree | Clean, `dev` in sync with `origin/dev` at `55f550a` |
| Final test count on merged dev | 343/343 passing |

## This session's in-flight wave (omit if clean)

None — wave 1 fully settled (implement → review → [fix → re-review]× → merge → integration
review → integration cleanup → settlement), all worktrees released, all branches deleted
locally and remotely. Nothing mid-flight.

## Next steps

1. Run `/backlog-handover restore` to recompute the ready set (should resolve to NCOW-32
   alone) and either propose the 3 follow-up items below to the user first, or proceed
   straight to dispatching NCOW-32 as a solo wave 2 if the user prefers to skip that.
2. NCOW-32's own acceptance criteria require: (a) serializing `uninstall.run()` →
   `pm2Control.remove()` against the same proxy mutex the background restart uses, (b)
   serializing the auto-update install path's `stopProxyForShutdown()` call against the same
   mutex (distinct from the deliberately-unserialized before-quit shutdown path, which stays
   as-is), (c) a regression test proving a background restart and an Uninstall/auto-update
   attempt can no longer interleave, (d) npm test passing. Re-read `backlog task view NCOW-32
   --plain` fresh at wave-2 dispatch time rather than trusting this summary.
3. After NCOW-32 resolves, this campaign round's queue is empty — re-run inventory (I1) for a
   fresh round rather than assuming NCOW-7/11/13/14/15 are still correctly excluded; they
   should be re-checked, not just carried forward, since a human may have acted on them
   between sessions.

## Follow-ups to propose to the user before wave 2 (not yet created as tasks)

Surfaced during wave 1's reviews and the wave-level integration review. None are blocking;
all are small. Per this skill's Task-write concurrency rule, propose via AskUserQuestion and
only create if approved:

1. **Harden two remaining unguarded-interpolation sites** with the same `safeStringify()`
   pattern NCOW-36 introduced in `src/engine/configGen.js`: the adjacent `restart-failed`
   branch in the same file (an `error.code`/`error.message` interpolation that can still
   reject on a hostile pm2Control-returned error object — confirmed live by NCOW-36's
   reviewer), and `src/main/autoUpdate.js:100`'s `err?.message ?? String(err)` in an error
   handler that promises "never throw."
2. **Guard the tray call site in `src/main/index.js`** against a post-spread
   `onStart`/`onStop`/`onRestart` key override after the `...createTrayActions(...)` spread —
   NCOW-35's reviewer found this is the most realistic accidental-regression shape (silently
   re-opens NCOW-31's own finding B1 with a fully green test suite) among several adversarial
   variants probed, though not the only one found.
3. **Soften one test comment** in `test/main/engine-context-config-regen.test.js` that
   currently claims the tray's mutex-identity checks "close the chain honestly" — NCOW-35's
   reviewer judged this still overstated given the residual gaps in finding #2 above.

## Critical context / traps

- Doc-4 (the prior, complete campaign round's tracker) should not be reopened or edited —
  doc-5 is the live tracker.
- **A new file-conflict finding this round, worth remembering for future waves in this same
  cluster**: `src/main/index.js` already destructures `mutexes` from `createEngineContext()`
  and uses it in more than one place (the autoUpdate `stopProxyForShutdown` wiring AND the
  tray creation block after NCOW-35's merge) — any future task touching either of those two
  regions conflicts with the other via this one file, even when they're in different
  "clusters." Don't rely on cluster labels alone for this file; always do the file-citation
  read.
- **Review-fix cycles worked exactly as the skill intends, twice this wave**: NCOW-36 and
  NCOW-35 each needed one `request_changes` → fix → re-review cycle (1 of 2 allowed retries),
  and both closed cleanly on the second pass — well within budget, no escalation needed. The
  pattern that made both re-fixes succeed: the reviewer's first-pass finding named a *specific,
  reproducible* adversarial case (not just "make it more robust"), and the fix pass was handed
  that finding verbatim rather than told to "look at it again."
- **Two reviewers explicitly declined to demand a fix for every conceivable adversarial
  variant** (NCOW-35's pass 2, NCOW-36's discussion of the sibling `restart-failed` branch) —
  both reasoned that continuing to escalate to newly-invented variants each round would be an
  unbounded arms race rather than convergent review, given the fix pass faithfully implemented
  the specific property asked for. This is a legitimate reviewer judgment call per the
  Escalation Policy's decide-vs-defer test (narrow, reversible, low-blast-radius), not a
  shortcut — the residual gaps were explicitly recorded as follow-up candidates, not silently
  dropped.
- Treehouse pool grew from 3 to 4 trees on demand this wave (wave size was 4); all 4 are
  released and available now. The pool remains cold in the sense that no `treehouse.toml`
  exists, but the 4 trees themselves are warm (`node_modules` present) for the next wave.

## Do not repeat

- Two Agent-tool dispatch attempts failed with `herdr pane split ... pane_not_found` when the
  `name` parameter was passed to the Agent tool call. Retrying the identical dispatch without
  `name` succeeded immediately. If launching worker/reviewer agents ever fails with a
  pane-related error again, drop the `name` parameter before troubleshooting further.
