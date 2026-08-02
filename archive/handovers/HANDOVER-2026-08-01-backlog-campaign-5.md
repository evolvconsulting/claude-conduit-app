# Handover — new campaign round init (waves: 0, tasks: none yet)

**Date**: 2026-08-01 | **Grounded against**: `dev` @ `d03eaef8672ea94ec63b2ae77d767b2e81926df3`,
clean, 0 ahead/0 behind `origin/dev` | **Tracker**: doc-4

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. This is
a fresh campaign round (doc-4) initialized right after the prior round (see
doc-3, now superseded) completed 4 waves (NCOW-16/17/18/12/19/9 all Done).
This round exists because NCOW-9 and NCOW-12 landing unblocked NCOW-10
(auto-update), which the prior round's inventory had excluded.

Queue: NCOW-10 only. User explicitly confirmed at init (AskUserQuestion,
2026-08-01): queue it now, UNSIGNED — build electron-updater integration,
in-app update checker, and a CI release workflow; verify end-to-end on
Windows and/or Linux (neither strictly needs signing for electron-updater
to function); document macOS's Squirrel.Mac fallback to notify-only until
real signing certificates exist (user is separately pursuing those, not
part of this campaign). This means the campaign WILL publish real, unsigned
GitHub Releases of this app during implementation/verification -- that is
the user's explicit informed choice, do not re-ask or second-guess it.

NCOW-10 is large (8 ACs: mechanism decision+docs, in-app checker, real
end-to-end silent update on supported platforms, graceful fallback on
unsupported ones, defined proxy-restart behavior across an update, a CI
release workflow, graceful degradation on check failures, and a real
install-then-update verification). Its own task notes don't explicitly say
"expect to split this," unlike NCOW-14/15, but a worker's first plan may
reveal it needs splitting anyway -- if so, that's a live judgment call for
the first restore, not a decision to make from this handover.

The ready set is recomputed live at restore -- do NOT hardcode a "next
wave" plan here. No wave has been dispatched yet this round; this handover
exists purely because init's own protocol (I4) always writes one immediately
after creating the tracker.
```

## State

| Item | Status |
| --- | --- |
| Campaign tracker | doc-4, freshly created and populated at init, NCOW-10 in Queue as "To Do" (not yet Dispatched) |
| Prior round's tracker | doc-3, title updated to mark it superseded (matches this project's existing doc-1 convention), left in place as the historical record for waves 1-4 |
| `dev` / `origin/dev` | In sync, `d03eaef`, `npm test` last confirmed 178/178 at prior round's settlement (unchanged since -- no code touched this init) |
| Worktrees / treehouse pool | Two warm slots in pool `claude-conduit-163fa4` (`/1`, `/2`), both released/available. An older orphaned pool (`claude-conduit-2dea77`) was found and cleaned up (git worktree remove) during the prior round's settlement -- do not expect it to reappear |
| `.claude/handovers/` | This file (gitignored) |
| `archive/handovers/` | Contains 4 prior handovers from the last round's waves (`HANDOVER-2026-08-01-backlog-campaign.md` through `-4.md`) |

## This session's in-flight wave (omit if clean)

(clean — no wave dispatched yet this round, nothing in flight)

## Next steps

1. `/backlog-handover restore` — R1/R2/R3 should find a clean, matching state (no drift, this
   handover was written immediately after init with nothing else touched). R4 builds wave 1 of
   this round: NCOW-10 is the only ready task. Read its full detail fresh with
   `backlog task view NCOW-10 --plain` (already read once at this init, but re-read per the
   skill's own R4a discipline) before dispatching.
2. Decide whether NCOW-10 is dispatchable as a single wave member or needs to be scoped down /
   split before a worker can make real progress on it in one pass -- it is unusually large for
   this campaign's normal wave-member size (compare to NCOW-12, which was also large and solo
   but still a single coherent unit; NCOW-10 additionally requires setting up real CI
   infrastructure and cutting real GitHub Releases, which is more process/infra-heavy than any
   prior task in this campaign). If in doubt, this is worth one more AskUserQuestion round before
   dispatch (e.g., "dispatch as one large task" vs "split into subtasks first: mechanism decision
   + in-app checker as one task, CI release workflow as another, real verification as a third").
3. Since NCOW-10 needs to actually publish GitHub Releases, remember this is real, visible,
   externally-observable action (same category as the GitHub repo rename in the prior round) --
   treat each real `gh release create`-equivalent step with the same care as that rename: narrate
   it, and if anything about scope or timing feels like it exceeds what "queue it now, unsigned"
   already authorized (e.g., publishing a release tagged as a real version number rather than a
   test/draft tag), check with the user rather than assuming the standing authorization covers it.

## Critical context / traps

- **This round's premise depends on NCOW-9's and NCOW-12's work being intact on `dev`.** Both
  are Done and merged (see doc-3's Resolved table for full evidence) -- `latest*.yml` emission
  and the `homepage`/`repository` package.json hardening from NCOW-9 are directly relevant
  inputs to NCOW-10's CI release workflow AC#6; don't rebuild that from scratch, read
  `docs/distribution.md` (from NCOW-9) first, it already has a release checklist including an
  asset-naming footgun (GitHub's web UI rewrites spaces to periods, which would silently break
  auto-update if artifacts are ever uploaded by hand instead of via the recommended CI workflow).
- **The GitHub repo really is `evolvconsulting/claude-conduit` now** (renamed mid-prior-round,
  confirmed via `gh repo view` multiple times since) -- do not second-guess this or treat it as
  still-pending; `CLAUDE.md` itself was corrected to reflect this in the prior round's wave 4.
- **Publishing real GitHub Releases is a genuinely consequential, externally-visible action** --
  the user's "queue it now, unsigned" answer at this init is real authorization for the
  campaign to do this, but stay narrated and use AskUserQuestion for anything that goes beyond
  what was actually asked (see Next steps #3).

## Do not repeat

(none yet -- no implementation work has started this round)
