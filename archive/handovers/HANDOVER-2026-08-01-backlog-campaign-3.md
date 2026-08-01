# Handover — backlog campaign wave 2 done (waves: 2, tasks: NCOW-17, NCOW-18)

**Date**: 2026-08-01 | **Grounded against**: `dev` @ `61b79d40a134665068c096c0a673b37932d6b37c`,
clean, 0 ahead/0 behind `origin/dev` | **Tracker**: doc-3

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. 2 waves
completed so far (wave 1: NCOW-16 via PR #2; wave 2: NCOW-17 + NCOW-18 via
PR #4 and PR #3). Queue order confirmed by the user on 2026-08-01: NCOW-17 +
NCOW-18 ran before NCOW-12 in wave 2. NCOW-12 is next and is NOT yet
confirmed ordered against NCOW-19 (created at wave 2's integration review,
user-approved) -- ask the user for a quick queue-order confirmation covering
those two before building wave 3, same pattern as was done for NCOW-17/18 vs
NCOW-12 at the previous restore. The ready set is recomputed live at restore
-- do NOT hardcode a "next wave" list here; the tracker (doc-3) is the
source of truth.

Locked decisions (see doc-3's "Confirmed at init" / "Confirmed at restore #2"
sections for the full record, still valid, do not re-ask):
- NCOW-14 and NCOW-15 stay excluded from this campaign -- both need subtask
  splitting first, out of scope for a wave dispatch.
- NCOW-12's GitHub repo rename (evolvconsulting/nvidia-cowork ->
  claude-conduit) stays a MANUAL step -- no worker or the orchestrator runs
  `gh repo rename` autonomously. Every code-level rename is in scope; the
  actual repo rename is not.
- `origin/dev` is the real, full mainline. All wave worktrees fork from
  `dev`.
- NCOW-12 conflicts with essentially any task touching DESIGN.md or
  licenses.json (both already collided once, with NCOW-17 and NCOW-18
  respectively) -- it will need its own solo wave regardless of what else
  is ready. Don't spend time trying to pair it with something.
```

## State

| Item | Status |
| --- | --- |
| Campaign tracker | doc-3, updated through wave 2 settlement |
| Wave 1 (NCOW-16) | Done. Merged via PR #2 (squash `a56b156`) |
| Wave 2 (NCOW-17, NCOW-18) | Done. Merged via PR #3 (squash `e80b263`, licenses.json) then PR #4 (squash `3cdd1f9`, diagnostics) — deliberately in that order, see Critical context below |
| NCOW-19 | Created at wave 2 settlement as a user-approved integration-review follow-up; To Do, not yet queue-ordered against NCOW-12 |
| `dev` / `origin/dev` | In sync, `61b79d4`, `npm test` 161/161 pass |
| Treehouse pool | 2 worktree slots (`claude-conduit-2dea77/1` and `/2`), both released back to `available`, both warm (have `node_modules` — slot 1's now includes `fsevents` after this session's own `npm install` refresh) |
| Orchestrator's own main checkout | `node_modules` refreshed this session (`npm install` picked up `fsevents`, previously missing) — no longer the "long-lived stale checkout" NCOW-18 described |
| `.claude/handovers/` | This file (gitignored) |
| `archive/handovers/` | Previous handover archived here this session as `HANDOVER-2026-08-01-backlog-campaign-2.md` (collision suffix — one already existed from wave 1) |

## This session's in-flight wave (omit if clean)

(clean — wave 2 fully settled, nothing in flight, no open campaign PRs, no leftover branches/worktrees)

## Next steps

1. `/backlog-handover restore` — R1/R2/R3 should find a clean, matching state (no drift). R4
   builds wave 3 live: NCOW-12 is ready (no deps), NCOW-19 is ready (no deps) — check whether the
   user wants NCOW-19 done first (small, low-risk) or doesn't care given NCOW-12 must be solo
   regardless (NCOW-19 could theoretically run *alongside* NCOW-12 only if NCOW-12's actual file
   set doesn't overlap `test/main/licenses.test.js` — re-run the file-citation conflict check
   fresh rather than assuming; NCOW-12 does touch `licenses.json` per its own description, which
   is exactly what NCOW-19's fix touches too, so they likely conflict same as NCOW-17/18 did).
2. **NCOW-12 (rebrand) needs careful handling**, more than a typical wave member — this has not
   changed since the last handover:
   - It's the largest task in the queue: touches `package.json`, `electron-builder.yml`,
     `REPO_URL`, the macOS dev-bundle rename script, tray/menu labels, README/DESIGN.md/
     CLAUDE.md, generated `licenses.json`, **and** persisted user state (config directory, pm2
     app name `litellm-nim`, Electron `userData` holding the encrypted API key, the Claude
     Desktop `configLibrary` entry).
   - AC#4/#5 require a documented migrate/leave/reinstall decision, verified against a **real
     pre-rename install**. This machine has one (from prior NCOW-8 work) with a real Claude
     Desktop entry (`desktop_config_entry_id` in the manifest) from earlier live testing. Do not
     let a worker touch that entry without the same care `CLAUDE.md` documents for Claude
     Desktop writes (backup first, dedicated entry only, real consent) — lean toward
     `human_needed` over a worker guessing past it, per the Escalation Policy decide-vs-defer
     test.
   - It needs live app/proxy verification (AC#8, packaged build launches under new identity) —
     Shared Machine State rule applies: it must be the only live-verification task in its wave.
   - The GitHub repo rename itself stays manual per the locked decision above.
   - It will collide with `DESIGN.md` and `licenses.json` — do not try to pair it with anything
     that also touches those files (this cost nothing to check in wave 2 but is worth restating).
3. NCOW-9 (blocked on NCOW-12) becomes reachable once NCOW-12 resolves.
4. NCOW-19 is small and low-risk (a single test-assertion fix in `test/main/licenses.test.js`,
   no live verification) — a good candidate to run either just before or just after NCOW-12,
   whichever the user prefers, but confirm the file-conflict question in step 1 first.

## Critical context / traps

- **Merge order within a wave is not always safe to leave at the tracker's listed order.**
  Wave 2's reviewer caught that `licenses.json`'s test assertion is a live-environment-dependent
  count (`installed.length + 1`), so merging NCOW-17 (diagnostics, untouched licenses.json)
  before NCOW-18 (which raises the count to 79 to match a fresh macOS install) would have made
  the merge queue's *mandatory* post-rebase `npm test` show a real failure in NCOW-17's own
  worktree — not a regression, but a confusing false alarm. The orchestrator reordered the merge
  (NCOW-18 first, then NCOW-17) purely as an operational judgment call, not a product decision,
  and it worked exactly as predicted (150/150 after the first merge, 161/161 after the second).
  **Lesson for future waves**: when one branch changes a value something else's test asserts
  against (even indirectly, even without a file conflict), check whether merge *order* — not
  just merge eligibility — matters, and don't treat the tracker's listed queue order as binding
  for intra-wave merge sequencing.
- **This machine's own long-lived `node_modules` was genuinely stale**, independently confirmed
  during wave 2: it was missing `fsevents` (a darwin-only optional dependency of
  `chokidar`/`pm2`) that a fresh `npm install` on this exact OS/arch correctly resolves. The
  orchestrator ran `npm install` in its own main checkout this session to fix this — do not be
  surprised if `npm test` behaves differently in this checkout going forward (it now matches a
  fresh install, which is the correct state). If package-lock.json ever shows a spurious 1-line
  diff after `npm install` (a `"license": "AGPL-3.0-or-later"` field on the root entry), that's
  npm 10.9.8 normalizing something an older npm version didn't write — revert it, don't commit
  it; this has now been hit independently by three different agents in two sessions and is worth
  a permanent note rather than re-discovering each time.
- **NCOW-19 exists because of this**: `test/main/licenses.test.js`'s tree-coverage assertion is
  now platform-sensitive (green on macOS, would fail on Linux/Windows) as the mirror image of
  the bug NCOW-18 fixed. No CI exists in this repo so nothing is broken today, but the user
  approved tracking it as a proper follow-up rather than leaving it to bite someone later.
- Every Backlog CLI write must run from the orchestrator's own main checkout (`dev`, never a
  worktree) — followed without incident through two full waves now.
- Both treehouse worktree slots are warm (`node_modules` present, slot 1 additionally has
  `fsevents` now) — reuse them for wave 3 rather than re-installing "to be safe."

## Do not repeat

- Don't assume the tracker's listed queue order for two wave-mates is also the correct *merge*
  order — check whether one branch's change could make the other's post-rebase test fail for
  reasons unrelated to either branch's own correctness (see "Critical context" above). This was
  caught correctly in wave 2 by reasoning through it before merging, not by hitting the failure
  live — keep doing the reasoning step proactively for any future wave where two branches touch
  values a shared test asserts against, even without a file conflict.
- Don't treat a reviewer's cross-branch caveat as merely informational if it changes what the
  orchestrator should actually do next (here: refresh its own `node_modules`, reorder the merge)
  — wave 2's reviewer flagged the caveat clearly and the orchestrator acted on it before merging,
  which is the right pattern to keep.
- Don't create a follow-up task from an integration-review finding without asking the user first
  (AskUserQuestion) — done correctly for NCOW-19 this session, keep doing it every time, even
  when the finding seems obviously low-priority/non-blocking.
