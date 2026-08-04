# Handover — wave 12 complete (NCOW-30 Done; NCOW-31 filed, LOW priority)

**Date**: 2026-08-04 | **Grounded against**: `dev` @ `9c50cda`, clean, 0 ahead / 0 behind
`origin/dev` | **Tracker**: doc-4

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. Same
campaign round (doc-4). Restore 6 this session found zero drift against the
wave-11 handover, confirmed winvm reachable, then ran wave 12: NCOW-30
(configGen.generateAll() has one caller, so upgraded installs never
regenerate ecosystem.config.cjs and never pick up NCOW-27/28-class fixes,
HIGH priority) dispatched solo -- all three ready tasks (NCOW-21, NCOW-24,
NCOW-30) conflicted pairwise (NCOW-21/NCOW-30 share configGen.js;
NCOW-21/NCOW-24 both need the single live-winvm slot; NCOW-24/NCOW-30
plausibly share pm2 daemon-lifecycle code per NCOW-30's own AC#3), so the
wave shrank to one, same shape as waves 3/10.

Took 2 review passes (both opus). Pass 1: request_changes -- a live A/B
(dev vs branch, same truncated manifest.json) proved a real blocking
regression: the manifest read this task added ran synchronously outside
any try/catch, so a corrupt manifest.json (which this task's own new write
path can itself leave behind on a crash/power-loss) crashed
createEngineContext() into a windowless zombie process before any window
could open. Fix pass wrapped the read in a try/catch falling back to
null/absent, added failure logging + a doc comment + 4 new tests, and
explicitly deferred a mutex-serialization finding as a real cross-module
architectural change out of scope for a fix pass. Pass 2: approve --
independently rebuilt the A/B with two different corruption shapes,
confirmed the fix general (not overfit) and side-effect-free, re-confirmed
AC#1/#2/#4/#5 live, accepted the deferral. npm test 282/282 post-rebase.
Squash-merged PR #20 -> dev @ 6485ff2.

User approved filing the deferred mutex-serialization finding plus a
second, related finding (a failed restart is never retried since the
version stamp is written before the restart attempt) together as ONE
combined task -- created as NCOW-31 (LOW priority, narrow/recoverable,
not user-facing today).

This session stopped after wave 12 settlement as a clean context-pressure
checkpoint (R4j), not an escalation -- everything this wave is fully
resolved and recorded.

Three tasks remain queued, none blocked by a dependency: NCOW-21, NCOW-24,
NCOW-31. CHECK winvm REACHABILITY FIRST (~/.scripts/winvm.sh "hostname")
before picking up NCOW-21 or NCOW-24 -- confirmed reachable at this
session's restore 6, not re-checked since. Shared Machine State still
limits any wave to one live-Windows task. NCOW-31 needs no VM to start but
touches the same engine-context.js/pm2Control.js call site NCOW-30 just
modified -- do a fresh file-citation check against whatever else is ready,
don't assume clean just because NCOW-24 isn't in flight this time either.

The ready set is recomputed live at restore -- do NOT hardcode a next-wave
list. Queue order confirmed by the user across prior sessions; do not
re-ask about repo visibility, release versioning, the two
permanently-published releases, the package-lock.json drift (fixed), or
any of the "do not re-ask" items already recorded in doc-4.
```

## State

| Item | Status |
| --- | --- |
| Campaign tracker | doc-4. Resolved now also holds NCOW-30 (#14). Queue holds NCOW-21, NCOW-24, NCOW-31. |
| `dev` / `origin/dev` | In sync at `9c50cda`. `npm test` **282/282** verified on merged dev. |
| Merged this session | PR #20 (NCOW-30) → `6485ff2`. |
| New task filed | NCOW-31 (LOW) — serialize config-regeneration's background restart behind ipc.js's proxy mutex + retry a failed regeneration; user-approved, filed between waves. |
| Worktrees / treehouse | All 3 slots in pool `claude-conduit-163fa4` released and available. |
| Branches / PRs | No campaign branches (local or remote), no open campaign PRs. |
| Real GitHub Releases | `v0.1.0` and `v0.1.1` still published permanently, untouched. **No new release was published.** Both now known to predate NCOW-27/28/30's fixes too — though NCOW-30 is exactly the fix that means any FUTURE release's config-generation fixes will actually reach existing installs, once a user upgrades in place. |
| `winvm` | Confirmed reachable at this session's restore 6 (`~/.scripts/winvm.sh "hostname"` → `winvm`), but NOT used this wave (NCOW-30 didn't need it) — **re-verify reachability at the start of the next restore** before assuming, same as every prior handover has said. |
| `linuxvm` | Not used this wave. Last confirmed reachable/qualified during NCOW-29 (wave 11). |
| This dev Mac | Real shared pm2 daemon (`~/.pm2`) has the user's own 6 unrelated apps, all online and untouched throughout. A stray, harmless `litellm-nim` entry that wave-1-review's live testing had left behind (pointing at a since-deleted scratchpad path) was found and deleted by the orchestrator between review passes 1 and 2 — confirmed via `pm2 list`/`pm2 save` before and after that the six unrelated apps were unaffected. |

## This session's in-flight wave

(clean — nothing in flight. Wave 12 fully settled: worktree released, branch deleted, PR merged, tracker and task settled Done.)

## Next steps

1. `/backlog-handover restore`. R2/R3 should find no drift.
2. Re-check winvm reachability first if picking up NCOW-21 or NCOW-24.
3. Build a wave from {NCOW-21, NCOW-24, NCOW-31}. NCOW-21 and NCOW-24 both need the single
   live-winvm slot (Shared Machine State), so at most one of them can be in the same wave.
   NCOW-31 doesn't need a VM to start, but it touches `engine-context.js`/`pm2Control.js` — the
   exact call site NCOW-30 just modified — so do a fresh file-citation check against whatever
   else is ready rather than assuming it's automatically clean.
4. NCOW-31's AC#1 wants a shared mutex primitive `engine-context.js` and `ipc.js` can both
   construct/reuse without `engine-context.js` requiring `ipc.js` directly (which it currently
   cannot, since `ipc.js` pulls Electron modules at module scope and `engine-context.js` is
   required by plain `node --test` suites with no Electron runtime) — whoever picks this up
   should read NCOW-30's own notes for the full reasoning trail before assuming a one-line fix.

## Critical context / traps

- **NCOW-30's own regeneration mechanism can itself produce the exact corrupt-manifest scenario
  its fix pass had to defend against** — it's a new non-atomic write on every version upgrade,
  which is exactly the kind of operation a crash/power-loss can leave truncated. The fix (fall
  back to null/absent on a bad read) is now the safety net for that; don't "simplify" it away in
  a future task without re-deriving why it's there.
- **NCOW-31 is deliberately a combined task for two related findings, not two separate ones** —
  the user chose one task covering both the mutex-serialization gap and the non-retry gap, since
  both live in the same `regenerateStaleConfig()`/`startOrRestart()` call path and a shared
  "did the restart actually succeed" signal is useful for fixing both together.
- Do not `pm2 kill` any daemon on any machine, ever.
- Diskutil guidance from an earlier wave still stands: never `unmountDisk`/`eject` a whole disk
  identifier locally.
- Reviewers this campaign have repeatedly modeled a good standard worth continuing: build your
  OWN independent A/B (not the implementer's/prior reviewer's) when re-verifying a fix, and vary
  the exact reproduction inputs (NCOW-30 pass 2 deliberately used different manifest-corruption
  shapes than the fix-pass worker had used) to catch an overfit fix.
- CLAUDE.md still says "178 tests" in its Commands section — stale, drifted over many waves
  (real count is 282 as of this handover). Non-blocking, flagged repeatedly, not fixed here —
  mention if picked up, don't treat as new information.

## Do not repeat

- Do not re-verify NCOW-27/28/29/30's ACs — all closed with independently-reproduced live
  evidence (see doc-4's Resolved table and each task's own notes).
- Do not re-ask about repo visibility, release versioning, the two permanent releases, the queue
  order, or the package-lock.json drift (fixed) — all settled and still valid.
- Do not publish a GitHub Release or push a tag without explicit user authorization.
- Do not propose filing a follow-up task for `secretStore.js`'s `importFromExistingEnvFile()` —
  already evaluated and correctly declined (dead code, zero callers) back in wave 11.
- Do not trust a subagent's idle notification as a completed handoff — this session's reviewer
  agents twice went idle without sending their structured verdict; both times the correct move
  was to message them directly and ask for the result, not to assume failure or re-dispatch a
  fresh agent. Neither had actually failed.
