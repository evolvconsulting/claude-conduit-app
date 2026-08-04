# Handover — wave 11 complete (NCOW-28, 29 Done; NCOW-30 filed, HIGH priority)

**Date**: 2026-08-03 | **Grounded against**: `dev` @ `a9372a3`, clean, 0 ahead / 0 behind
`origin/dev` | **Tracker**: doc-4

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. Same
campaign round (doc-4). Restore 5 this session first reconciled a crashed
prior session's drift (NCOW-27's settlement write had hit disk but never got
committed, and the tracker was stuck at wave 10 dispatch) -- npm test
258/258 re-verified before committing the recovery, then ran a full wave 11:
NCOW-28 (Windows litellm banner UnicodeEncodeError, HIGH) + NCOW-29
(apiKey.validateAndSave swallowing a secretStore.save() failure, MEDIUM)
dispatched in parallel (2 treehouse worktrees, no file conflicts -- winvm vs
linuxvm as independent live-verification resources). Both implemented,
reviewed (opus, both approve with independent A/B live verification going
further than the implementers' own claims), merged (PRs #18, #19). Wave
integration review came back clean. Tests are at 261/261 on dev.

One real follow-up surfaced by BOTH reviews independently and confirmed by
the integration pass: configGen.generateAll() has exactly one caller (the
setup wizard), so an upgraded install never regenerates ecosystem.config.cjs
and never picks up NCOW-27/28-class fixes -- both real published releases
(v0.1.0, v0.1.1) predate NCOW-27 entirely, so every real user who has ever
completed setup is currently exposed. User approved filing it -- created as
**NCOW-30** (HIGH priority, may overlap NCOW-24's daemon-lifecycle scope per
its own AC#3, needs no VM to start).

This session stopped after wave 11 settlement as a clean context-pressure
checkpoint (R4j), not an escalation -- everything this wave is fully
resolved and recorded.

Three tasks remain queued, none blocked by a dependency: NCOW-21, NCOW-24,
NCOW-30 (both need live winvm... just NCOW-21/24 do; NCOW-30 doesn't but may
conflict with NCOW-24 on daemon-lifecycle scope). CHECK winvm REACHABILITY
FIRST (~/.scripts/winvm.sh "hostname") before picking up NCOW-21 or NCOW-24
-- confirmed reachable at this session's restore 5, not re-checked since.
Shared Machine State still limits any wave to one live-Windows task.

The ready set is recomputed live at restore -- do NOT hardcode a next-wave
list. Queue order confirmed by the user across prior sessions; do not re-ask
about repo visibility, release versioning, the two permanently-published
releases, the package-lock.json drift (fixed), or any of the "do not re-ask"
items already recorded in doc-4.
```

## State

| Item | Status |
| --- | --- |
| Campaign tracker | doc-4. Resolved now also holds NCOW-27, NCOW-28, NCOW-29. Queue holds NCOW-21, NCOW-24, NCOW-30. |
| `dev` / `origin/dev` | In sync at `a9372a3`. `npm test` **261/261** verified on merged dev. |
| Merged this session | PR #18 (NCOW-28) → `a6d80ea`, PR #19 (NCOW-29) → `230ca0d`. |
| Drift reconciled this session | NCOW-27's settlement write (Done + all 5 ACs + final summary) had been written to disk by a prior session but never committed before it crashed, and the tracker doc was never updated past wave 10 dispatch. Re-verified `npm test` 258/258 against dev @ `08d8ecf`, committed the recovered write (`0dd283c`), then caught the tracker up (`0551883`). No other drift — `dev`/`origin/dev` were already in sync, no leftover worktrees/branches/PRs from wave 10. |
| New task filed | NCOW-30 (HIGH) — upgraded installs never regenerate ecosystem.config.cjs; user-approved, created between waves per this campaign's rules. |
| Worktrees / treehouse | All 3 slots in pool `claude-conduit-163fa4` released and available. |
| Branches / PRs | No campaign branches (local or remote), no open campaign PRs. |
| Real GitHub Releases | `v0.1.0` and `v0.1.1` still published permanently, untouched. **No new release was published.** Both now known to predate NCOW-27/28's fixes too, same as they predate NCOW-22's — and per NCOW-30, an in-place upgrade from either wouldn't pick those fixes up anyway without a fresh setup run. |
| `winvm` | Confirmed reachable at this session's restore 5 (`~/.scripts/winvm.sh "hostname"` → `winvm`) and used successfully by NCOW-28's worker and reviewer. Not re-checked since — **re-verify reachability at the start of the next restore** before assuming. |
| `linuxvm` | Reachable, used successfully by NCOW-29's worker and reviewer this session. Both left it clean (worker's checkout/fake-homes/logs removed; reviewer's own review artifacts, Xvfb, and an orphaned pm2 daemon it caused while probing the pre-existing flaky test also cleaned up). |
| This dev Mac | Only the user's own long-running pm2 daemon (`~/.pm2`) present throughout; no stray processes from this session's work. |

## This session's in-flight wave

(clean — nothing in flight. Wave 11 fully settled: both worktrees released, both branches deleted, both PRs merged, integration review clean, tracker and both tasks settled Done.)

## Next steps

1. `/backlog-handover restore`. R2/R3 should find no drift.
2. Re-check winvm reachability first if picking up NCOW-21 or NCOW-24.
3. Build a wave from {NCOW-21, NCOW-24, NCOW-30}. NCOW-21 and NCOW-24 both need the single
   live-winvm slot (Shared Machine State), so at most one of them can be in the same wave.
   NCOW-30 doesn't need a VM to start but treat it as a probable conflict with NCOW-24
   specifically (its own AC#3 calls for coordinating with NCOW-24 if scope overlaps on
   daemon-lifecycle code) until a fresh file-citation check at the next wave confirms or
   clears it — don't just assume clean because it's a different cluster tag.
4. NCOW-30's AC#1 wants live before/after verification of an in-place upgrade (old-version
   generated files → new-version generated files after an upgrade, without re-running setup)
   — this may need either a real installed-then-upgraded artifact or a convincing simulated
   equivalent; whoever picks it up should read the task's full AC list before assuming scope.

## Critical context / traps

- **No published release has ever regenerated its own ecosystem.config.cjs after the fact** —
  NCOW-30 is the task that will fix this, but until it lands, don't assume NCOW-27/28's fixes
  are live on any real user's machine just because they're on `dev`. This is the same
  "verified on dev ≠ verified on what users actually run" caveat this campaign has hit
  repeatedly (NCOW-10/22's original packaging gap, NCOW-25's arm64 gap, NCOW-27's own
  proxy.start() gap) — NCOW-30 is arguably the most structural version of it yet, since it
  means EVERY future generated-config fix has this same distribution problem until NCOW-30
  closes it.
- **This wave's reviewers set a new bar worth continuing**: both built their own independent
  A/B artifact pairs (a matched no-fix build vs. the fix) live on real hardware, rather than
  trusting the implementer's before/after narrative — NCOW-28's reviewer reproduced the exact
  `UnicodeEncodeError`/crash-loop from a packaged Windows build with the fix reverted; NCOW-29's
  reviewer first confirmed `ENCRYPTION_UNAVAILABLE` was a genuine unforced condition on a real
  headless Linux desktop session before reproducing the bug and fix. Worth expecting/asking for
  this standard again on future waves where an A/B is practical.
- `secretStore.js`'s `importFromExistingEnvFile()` has the identical swallowed-`save()`-failure
  pattern NCOW-29 just fixed elsewhere — confirmed by this wave's integration review to be dead
  code with zero production callers, so it was deliberately NOT filed as a follow-up. Don't
  re-flag it as new information; it's a known, inert non-issue.
- Do not `pm2 kill` any daemon on any machine, ever.
- Diskutil guidance from an earlier wave still stands: never `unmountDisk`/`eject` a whole disk
  identifier locally.
- CLAUDE.md still says "178 tests" in its Commands section — stale, drifted over many waves
  (real count is 261 as of this handover). Non-blocking, flagged by this wave's integration
  review, not fixed here — mention if picked up, don't treat as new information.

## Do not repeat

- Do not re-verify NCOW-27/28/29's ACs — all closed with independently-reproduced live evidence,
  including reviewer-built A/B controls (see doc-4's Resolved table and each task's own notes).
- Do not re-ask about repo visibility, release versioning, the two permanent releases, the queue
  order, or the package-lock.json drift (fixed) — all settled and still valid.
- Do not publish a GitHub Release or push a tag without explicit user authorization.
- Do not propose filing a follow-up task for `secretStore.js`'s `importFromExistingEnvFile()` —
  already evaluated and correctly declined this session (dead code, zero callers).
- Do not trust an agent's self-report that it cleaned up a shared resource without independent
  verification — this session's reviewers modeled the right level of skepticism (e.g. NCOW-29's
  reviewer independently confirmed a flaky pm2Control test on linuxvm was genuinely pre-existing
  by reproducing it against an untouched pre-branch tree, rather than accepting the worker's
  characterization at face value).
