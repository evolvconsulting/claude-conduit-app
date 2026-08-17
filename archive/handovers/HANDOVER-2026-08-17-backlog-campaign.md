# Handover — waves 17-18 complete (CCA-60/64/14.3/14.4/61 Done; 1 crash recovered, 2 waves drained, 1 task filed)

**Date**: 2026-08-17 | **Grounded against**: `dev` @ `48e492b`, clean, in sync with `origin/dev` |
**Tracker**: doc-5

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit-app (also reachable at
/Users/jdnewhouse/repos/claude-conduit-app, a symlink -- same repo; note this differs from
older handovers' path, /Volumes/_data/repos/claude-conduit, which no longer exists -- the repo
was renamed on disk and on GitHub between sessions). 33 tasks resolved across waves 1-18.
Queue order for the 2026-08-17 candidates was confirmed by the user on 2026-08-17; do not
re-ask that specific confirmation, but DO recompute the ready/conflict graph fresh as always.

Queue is 3 items: CCA-63, CCA-14.5, CCA-65. RECOMPUTE THE CONFLICT GRAPH LIVE -- do not
inherit the note below.
- CCA-63 and CCA-14.5 were BOTH deferred from wave 18 purely because they conflicted with
  CCA-64 (package.json) and CCA-14.3 (secretStore.js) respectively -- both of which are now
  Done and merged. Whatever they conflicted with is gone from the ready set; there is no
  known reason left for them to conflict with EACH OTHER (CCA-63 touches package.json/
  README/CLAUDE/DESIGN/about-dialog.js/menu.js; CCA-14.5 touches manifest.js/secretStore.js/
  configGen.js -- disjoint on paper) but verify this by file-citation read, don't assume it.
- CCA-65 (licenses.test.js drift guard blind to version mismatches) was filed this session
  with user approval but its queue-order position was never confirmed -- ask, or propose one
  and confirm, before dispatching it.
- CCA-63's own AC#2/#3 require actually publishing a real GitHub Release and verifying live
  auto-update against it. THE USER EXPLICITLY DIRECTED (2026-08-17): a worker may prepare
  everything (version bump, changelog, build) but the actual publish step is held for the
  orchestrator to run only after explicit chat confirmation -- never autonomous inside a
  wave dispatch. Do not let this rule lapse just because it's a new session.
- CCA-14.5 now carries TWO forward-flagged configGen.js findings from wave-18's reviews (see
  its own notes): an `apiBaseLine`-only-on-first-model-entry gap plus unconditional `api_key`
  emission that would silently misroute Custom/Local traffic to api.openai.com once wired up
  end to end, and a stale "today's only provider" comment. Neither was added to CCA-14.5's
  own ACs unilaterally -- decide whether to fold them in or file separately when this task is
  actually planned.

Not queued this round (re-check fresh -- last freshly checked 2026-08-17): CCA-7 (parked
pending CCA-15), CCA-11 (open design question + depends on CCA-15), CCA-13 (depends on
CCA-14 parent, not the "undecomposed" reason it used to be -- see below), CCA-14 (the
PARENT task itself -- reclassified 2026-08-17 from "needs decomposition" to "in progress via
its own children," stays out of the queue until CCA-14.5 lands and its own aggregate ACs can
be verified), CCA-15 (depends on CCA-14 parent + still-undecided human design questions),
CCA-62 (depends on CCA-14 parent + CCA-15, neither Done).

CRITICAL BRIEFING FOR EVERY WORKER AND REVIEWER -- one recurring failure class hit HARD this
session, plus the established ones:

RECURRING HARD THIS SESSION: "A CORRECTED CLAIM CAN STILL BE WRONG IN A PLACE NOT YET
CHECKED." CCA-61 needed 3 review passes / 2 fix cycles, and every single one was the SAME
underlying defect (a "no remedy exists" overclaim that was actually "a remedy exists but is
disproportionate") recurring in a DIFFERENT comment site each time -- tray.js, then
electron-builder.yml (fixed together in fix pass 1), then a THIRD site in a test file's
comment block that fix pass 1 simply never looked at (caught by review pass 2), finally
swept clean by review pass 3 checking the WHOLE branch rather than just the previously-named
files. MITIGATION: when a fix pass corrects an overclaim, brief it explicitly to grep the
WHOLE branch/repo for the same phrase pattern, not just re-read the files it already knows
about -- and brief the NEXT review pass to do the same sweep independently rather than
trusting the fix pass's file list.

ESTABLISHED, still worth repeating: (1) "fix the claim, not the instance" -- CCA-64's
reviewer regenerated `licenses.json` independently to confirm it was the canonical
generator's output, not hand-edited, exactly because a plausible-looking file is not the
same as a verified one. (2) No false counterfactuals, absolute SHAs only, never HEAD/HEAD~N.
(3) Guard claims verified BY EXPERIMENT, never by reading -- every AC#6/7/8-style guard claim
this session was proven via a real mutation-and-observe cycle in a scratch copy, never the
real tracked file.

NEW this session, worth carrying forward: treehouse's pool was found completely unregistered
at restore (`treehouse status` -> "No worktrees in pool", no `treehouse.toml` anywhere) --
likely a casualty of the repo's own path rename between sessions. Wave 18 was dispatched via
plain `git worktree add` (the skill's documented fallback), rooted at
`/Volumes/_data/repos/claude-conduit-app.worktrees/<task-id>`. If treehouse is still
unregistered at the next restore, either keep using the plain-fallback path or spend a few
minutes on `treehouse init` + a fresh lease cycle before the first wave -- your call, both are
explicitly supported by this skill. Also: when an early wave member's merge touches
`package.json`/`package-lock.json` (CCA-64 did), every OTHER wave member's worktree needs an
`npm install` after its own rebase, or its mandatory re-verify `npm test` fails with an opaque
`ELSPROBLEMS` error that looks like a real regression but isn't -- budget for this in dispatch
prompts if a dependency-bump task shares a wave with anything else.

No in-flight worktrees, branches, or PRs. 3 stale treehouse pool directories exist on disk
(`~/.treehouse/claude-conduit-163fa4/{1,2,4}/claude-conduit`, all detached HEAD, harmless) but
treehouse itself has no record of them -- see the treehouse note above.

This session stopped between waves by the ORCHESTRATOR'S OWN judgment (a clean two-wave
drain plus a crash recovery is a natural, low-risk stopping point), not because the queue
emptied -- it isn't empty, it's just fully re-inventoried and ready for the next session to
resume dispatching immediately.
```

## State

| Item | Status |
| --- | --- |
| Waves 1-16 (CCA-32 … CCA-57) | Done, merged prior sessions |
| Wave 17 (CCA-58, CCA-59, CCA-60) | Done, merged this session (CCA-58/59 had merged previously but the tracker was never updated; CCA-60 recovered from an uncommitted crash and merged as PR #66) + cleanup PR #67 |
| Wave 18 (CCA-64, CCA-14.4, CCA-14.3, CCA-61) | Done, merged this session (PRs #68-#71) + cleanup PR #72 |
| CCA-65 | Filed this session (user-approved), To Do, not yet queue-order-confirmed |
| Tracker (doc-5) | Settled for waves 17 and 18, committed + pushed |
| Queue | 3 tasks — CCA-63, CCA-14.5 (both deferred from wave 18 on conflicts with tasks now Done), CCA-65 (newly filed) |
| Worktrees/branches/PRs | None in flight; 3 stale-but-harmless treehouse pool dirs remain (see prompt above) |
| Working tree | Clean, `dev` @ `48e492b`, in sync with origin |
| Test count on merged dev | **562/562 passing** (verified directly by the orchestrator multiple times, and by every task/wave reviewer independently) |

## This session's in-flight wave

None. Both waves fully settled:
- Wave 17: crash recovery (CCA-60's fix pass 2 found uncommitted in its worktree) → resumed →
  review pass 3 approved → merged PR #66 → wave-17 integration review (PR #67, 1 review pass) →
  settled.
- Wave 18: fresh re-inventory (I1/I2) → user confirmed order + CCA-63's live-publish gating rule →
  conflict graph computed live → dispatch 4 parallel workers → CCA-64/14.3 approved first pass;
  CCA-14.4 1 fix cycle; CCA-61 2 fix cycles (see "recurring hard" note above) → merged serially
  (PRs #68-#71) → wave-18 integration review (PR #72, 1 review pass) → settled → 1 new task filed
  (CCA-65, user-approved) → handover.

## Environment facts — probed live this session, worth not re-deriving

**The repo itself moved between sessions.** GitHub: `evolvconsulting/claude-conduit` ->
`evolvconsulting/claude-conduit-app` (2026-08-07, tracked by the now-Done CCA-63... wait, CCA-63
is the task that SWEEPS references to this rename, it is not yet Done — the rename itself already
happened, CCA-63 is the cleanup). On disk: the working copy moved to
`/Volumes/_data/repos/claude-conduit-app` (also linked at `/Users/jdnewhouse/repos/claude-conduit-app`).
This broke all 4 of the prior session's treehouse pool worktrees' back-links (`git worktree repair`
fixed them) and appears to have dropped treehouse's own pool registration entirely (see the
prompt's treehouse note).

**Backlog prefix migration (NCOW-N -> CCA-N, numbering preserved) already happened** between
sessions (commit `92a6be0`), confirmed and not re-litigated. Source comments/string literals in
files that predate the migration were deliberately left with historical `NCOW-` citations per
CLAUDE.md's own rule ("do not fix in bulk, cite CCA-N in anything new") — this session's own new
files followed that rule correctly (verified independently by two different reviewers).

**A large feature (CCA-14.1, CCA-14.2 — the provider abstraction, NVIDIA + OpenRouter) landed
directly on `dev` between sessions, entirely outside this campaign** (commit `a1e282e`, no
PR/worktree/review trail here) — presumably done by the user directly. This added 33 tests nobody
in wave 17 accounted for (the wave-17 integration review caught and corrected the resulting
test-count staleness). `src/engine/providers/registry.js` is the seam this created; three providers
are now registered there (`nvidia-nim`, `openrouter`, `custom-local` as of this session's CCA-14.3),
but `src/main/engine-context.js:31` still hard-pins `getProvider('nvidia-nim')` — nothing but NVIDIA
is reachable end to end until CCA-15.

## Next steps

1. Run `/backlog-handover restore`. Recompute the ready set and conflict graph live for
   {CCA-63, CCA-14.5, CCA-65} — the paste-ready prompt above has the current best-guess file
   footprints, but verify rather than inherit.
2. Get CCA-65's queue-order position confirmed (it was filed but never ordered).
3. Before dispatching CCA-63, re-confirm with the user that the live-release-publish gating rule
   (worker prepares, orchestrator publishes only after explicit chat sign-off) still stands — it was
   a one-time direction, not (yet) written into CLAUDE.md or this skill itself.
4. Once CCA-63/14.5/65 are done, re-run inventory (I1) again — CCA-14 parent's own aggregate ACs
   (#7, #10) become checkable once CCA-14.5 lands, and CCA-15/CCA-13/CCA-62's blocking status should
   be re-verified rather than assumed to still hold.

## Critical context / traps

- **Doc-4 must not be reopened — doc-5 is the live tracker.**
- **The wave-level integration review has now found real material in every wave, 1 through 18,
  without exception.** Never skip or shortcut it, even for a wave that "looks clean" on individual
  task review. Wave 18's found a security-relevant staleness (a stale dependency version in the
  user-facing license dialog) that had survived a full task review AND a merge undetected, because
  the existing drift guard checks the wrong thing (count/membership, not version) — this is now
  CCA-65.
- **`test/main/licenses.test.js`'s drift guard is known-incomplete until CCA-65 lands** — it will not
  catch a future dependency-version bump that forgets `npm run licenses`. Don't rely on it as a
  safety net for that class of change until CCA-65 is Done.
- **`src/engine/configGen.js` has at least 3 known-but-unfixed staleness/integration issues**, all
  recorded on CCA-14.5 rather than fixed ad hoc: the `apiBaseLine`-only-on-first-entry gap +
  unconditional `api_key` emission (from CCA-14.3's review), and a stale "today's only provider"
  comment (from wave-18's integration review). Whoever plans CCA-14.5 should read its notes in full
  before scoping.
- **CCA-61's three-site "no remedy exists" overclaim is a good teaching example for briefing future
  reviewers** — see the "recurring hard this session" note in the paste-ready prompt. Worth pointing
  a future reviewer at this task's own notes if a similar multi-site correction pattern shows up
  again.
- **The Agent tool's own `isolation: "worktree"` conflicts with this skill's own worktree
  management — never pass both.** No isolation parameter was passed to any dispatch this session.

## Do not repeat

- **`declare -A` associative arrays inside a Bash tool call broke `git` resolution entirely**
  (`command not found: git` on every line inside the loop) in this session's shell — cause not fully
  diagnosed (likely a zsh-vs-bash construct mismatch under the harness's non-interactive invocation).
  Worked around by issuing one flat, explicit command per worktree instead of looping over an
  associative array. Avoid `declare -A` in Bash-tool calls in this environment; use plain sequential
  commands or a `for id in a b c` list with positional lookups instead.
- **A background agent asked to "work from a plain checkout" used the orchestrator's own main
  checkout directory** (since no separate worktree was given) and left genuinely good, verified
  cleanup changes sitting uncommitted directly on `dev`. This is fine ONLY if the orchestrator
  immediately moves them to a dedicated branch (`git checkout -b docs/waveN-cleanup`) before doing
  anything else with that checkout — done correctly both times this session (wave 17 and wave 18
  cleanups), but be deliberate about it: don't let an integration-review agent's uncommitted output
  sit on `dev` while doing anything else in that same directory.
- **`git branch -d` refuses after a squash merge** — use `-D`, only after the worktree holding the
  branch has been released. (Every merge this session followed this correctly.)
- **Do not run `backlog` writes from inside a worktree**, and do not let workers run them at all —
  every dispatch this session was explicitly barred from this; none violated it.
- **User approval was sought via AskUserQuestion before filing CCA-65, before locking in wave-18's
  queue order, and before deciding CCA-63's live-publish handling.** Follow-up findings on CCA-14.5
  were recorded as NOTES, not promoted to acceptance criteria without asking — that call is still
  open for whoever plans CCA-14.5.
- No Agent dispatch failures this session — no 529s, no interruptions. No `name` parameter was
  passed to any Agent call; keep omitting it.
- When archiving a consumed handover, check `archive/handovers/` first for the next free suffix if
  a same-day archive already exists (none did this session — this is the first `2026-08-17` entry).
