---
id: doc-3
title: Backlog campaign tracker
type: other
created_date: '2026-08-01 00:06'
updated_date: '2026-08-01 10:13'
---
# Backlog campaign tracker

Protocol: restore → compute the ready/conflict graph → mark the wave Dispatched
→ dispatch (parallel workers + review) → serialize the merge →
update this tracker once more at settlement → loop until the queue is empty or
blocked → write handover.

Driven by the `backlog-handover` skill (`.claude/skills/backlog-handover/SKILL.md`).

## Confirmed at init (2026-07-31) — do not re-ask

- Queue order: NCOW-16 before NCOW-12.
- NCOW-14 and NCOW-15 are deliberately EXCLUDED from this campaign. Both explicitly need
  splitting into subtasks before they're wave-sized (their own task descriptions say so), and
  NCOW-14 needs a live OpenRouter credential of unknown availability for AC#3/#10. Scoping them
  is a separate planning session, not a campaign wave. Consequently NCOW-11 (deps: NCOW-15) and
  NCOW-13 (deps: NCOW-14) cannot become ready inside this campaign either — see Not queued.
- NCOW-12's GitHub repo rename (evolvconsulting/nvidia-cowork → claude-conduit) stays a MANUAL
  step outside the wave loop — no worker or the orchestrator itself runs `gh repo rename`
  autonomously. Every code-level rename (package.json, appId, REPO_URL, docs, icons, etc.) is
  in scope for the wave; the actual repo rename is not.

## Resolved at restore #1 (2026-08-01) — base-branch fix

`origin/dev` and `origin/main` were both stuck at the bare initial commit (DESIGN.md only) —
the entire codebase, tests, and Backlog task store (including this tracker) existed only on
the local, never-pushed `feat/nim-proxy-manager` branch. User chose (AskUserQuestion) to
`git push origin feat/nim-proxy-manager:dev` (clean fast-forward, no force needed), then the
orchestrator fast-forwarded its own local `dev` checkout to match and switched onto it. `dev`
is confirmed as GitHub's registered default branch. All future wave worktrees fork from `dev`
per the skill's normal convention — no more deviation needed.

## Confirmed at restore #2 (2026-08-01) — wave 2 scope vs NCOW-12

NCOW-17 and NCOW-18 (both created at wave 1 settlement) were unordered relative to NCOW-12 in
the confirmed queue. File-citation conflict check found NCOW-12 conflicts with BOTH: it
explicitly touches `DESIGN.md` (README/DESIGN.md/CLAUDE.md rebrand updates) and the generated
`licenses.json`, which collide with NCOW-17 AC#4 (DESIGN.md §11 update) and NCOW-18 (regenerates
licenses.json) respectively. NCOW-17 and NCOW-18 do not conflict with each other. So NCOW-12
cannot share a wave with either regardless of ordering — it was always going to be a solo wave.
User chose (AskUserQuestion): run NCOW-17 + NCOW-18 as wave 2 first (lower risk, ready now, no
live-verification requirement), defer NCOW-12 to its own wave next. Do not re-ask this ordering.

## Frontier

The "ready now" set is ALWAYS recomputed live from the Backlog task list + this table
at the start of every restore/wave — never trust a persisted "next wave" plan.
As of wave 2 dispatch (2026-08-01): NCOW-17 and NCOW-18 dispatched as wave 2. NCOW-12 remains
ready (no deps) and is next after wave 2 settles — solo wave (see "Confirmed at restore #2").
NCOW-9 remains blocked on NCOW-12.

## Queue (confirmed order)

| # | Task ID | Cluster | Deps (mirrors each task's real `dependencies` field) | Status | Wave | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | NCOW-17 | diagnostics | NCOW-16 (done) | Dispatched | 2 | ready; no live-verification requirement |
| 2 | NCOW-18 | hygiene | (none) | Dispatched | 2 | ready; no live-verification requirement |
| 3 | NCOW-12 | rebrand | (none) | To Do | | next after wave 2; solo wave — conflicts with both NCOW-17 (DESIGN.md) and NCOW-18 (licenses.json); repo rename stays manual |
| 4 | NCOW-9 | release | NCOW-12 | Blocked | | unblocks once NCOW-12 resolves |

## Resolved

| # | Task ID | Status/date/wave | Evidence summary |
| --- | --- | --- | --- |
| 1 | NCOW-16 | Done, 2026-08-01, wave 1 | postMessages' single hardcoded 30s timeout replaced with DEFAULT_TIMEOUT_MS (30s) + configurable MODEL_COMPLETION_TIMEOUT_MS (60s, checks 4/5/6/8); timeouts now report an accurate "too slow for interactive use" message instead of an opaque abort. checkStreaming's fixed-50-chunk cap replaced with the same elapsed-time budget (AC#3). AC#2 re-scoped mid-implementation by explicit user decision after live evidence showed 90s/180s/300s ceilings all still timed out against genuine NVIDIA-side queue congestion on the shared/free trial endpoint (raw curl bypassing this app entirely still took 186.6s, NVIDIA's own response reporting real queue depth of 16 running + 11 waiting requests) — a model taking minutes to respond isn't "slow but fine" for an interactive proxy. npm test 150/150 pass on merged dev (1 pre-existing, unrelated licenses-manifest failure only reproduces under a fresh install). Live-verified twice independently (worker + reviewer) against the real NVIDIA account, both fast and slow models. Reviewed by opus/xhigh — APPROVE, all 4 ACs independently confirmed live. Merged via PR #2, squash commit a56b156. |

## Not queued — needs a human / blocked

- NCOW-7: blocked on NCOW-15, which is deliberately excluded from this campaign (see Confirmed
  at init). Also explicitly PARKED by a prior-session decision recorded on the task itself —
  revisit after NCOW-15 is scoped/done separately.
- NCOW-10: needs real code-signing certificates (external/human-provisioned) before its ACs
  (a real install→update end to end) can be genuinely verified by an agent. Also depends on
  NCOW-9 and NCOW-12 (dependency graph), so not reachable this campaign regardless.
- NCOW-11: depends on NCOW-15, deliberately excluded from this campaign (see Confirmed at
  init). Revisit once NCOW-15 is scoped/done separately.
- NCOW-13: depends on NCOW-14, deliberately excluded from this campaign (see Confirmed at
  init). Revisit once NCOW-14 is scoped/done separately.
- NCOW-14: too large for a single wave dispatch — the task's own description says "expect this
  to want splitting into subtasks when it is picked up" (10 ACs spanning nearly every engine
  module). AC#3/#10 need a live OpenRouter credential of unknown availability. Excluded from
  this campaign per the 2026-07-31 decision — needs a separate planning/decomposition session.
- NCOW-15: same reasoning as NCOW-14 (its own description: "expect to split this into subtasks
  when it is picked up"), and depends on NCOW-14 besides. Excluded per the same decision.

## Follow-up tasks created at wave 1 settlement

User approved (AskUserQuestion, between waves) bundling these into two new tasks rather than
leaving them untracked or splitting further:

- NCOW-17 "Diagnostics: address NCOW-16 review findings" -- bundles the streaming elapsed-time
  enforcement gap, the model-name mismatch in the timeout message, the worst-case wall
  time/UI-cancel gap, the DESIGN.md section 11 update, and the minor nitpicks below.
- NCOW-18 "licenses.json is stale relative to a fresh npm install" -- the orchestrator's own
  independent finding, unrelated to NCOW-16 itself.

Original findings, for reference:

- `licenses.json` is stale relative to a genuinely fresh `npm install` from the current
  lockfile (`test/main/licenses.test.js` fails with "78 !== 79" only under a clean install —
  masked on the orchestrator's own long-lived `node_modules`). Found independently by the
  orchestrator, confirmed reproducible, unrelated to any campaign task.
- `checkStreaming`'s elapsed-time budget (diagnostics.js) is only checked *between*
  `reader.read()` calls, not enforced while parked inside one — latent, not a regression, not
  currently reachable (litellm doesn't flush SSE headers before the first upstream chunk, so
  `postMessages`' own AbortController still covers it today), but the code comment overclaims
  the bound as authoritative post-headers.
- The new timeout message hardcodes a fixed model alias (e.g. "claude-sonnet-4-5") rather than
  the user's actually-selected model — reads confusingly next to "try a different model."
- Diagnostics' worst-case total wall time roughly doubled with NCOW-16's change (~7 min), with
  no UI-level timeout/cancel in `ipc.js` or `diagnostics-view.js`.
- `DESIGN.md` section 11 was not updated to reflect NCOW-16's behavior change — per `CLAUDE.md`,
  the task wins and DESIGN.md should be corrected, which this task didn't do.
- Minor nitpicks (unbounded buffer/O(n^2) rescan in the streaming loop; inconsistent
  explicit-model-vs-raw-opts passing between checks; non-timeout-error branch for checks 5/6
  not covered by a mocked unit test) — bundled with the above rather than tracked separately.

## Wave log

- 2026-08-01 — wave 1 (task: NCOW-16): dispatched alone (Shared Machine State cap — NCOW-12
  also needs live verification, so only one live-verification task per wave). Worker (sonnet)
  implemented the timeout rework; live verification revealed the account's real-world latency
  has no reliable finite "just wait longer" ceiling (90s/180s/300s all still timed out against
  genuine NVIDIA-side queue congestion, confirmed via a raw curl bypassing litellm entirely).
  User redirected the approach mid-flight: capped at an interactive-reasonable 60s with
  accurate "too slow" messaging instead of chasing a bigger number. Reviewer (opus, xhigh)
  independently re-verified all 4 ACs live — APPROVE, no blocking findings, several
  non-blocking findings recorded (see "Candidate follow-up work" above). Rebased cleanly onto
  dev (no conflicts — bookkeeping commits touched only the task file), re-tested, merged via
  PR #2 (squash commit a56b156), worktree released, branch deleted. No wave-level integration
  review performed (wave size was 1 — no sibling branch to cross-check against). Settled: task
  marked Done with all 4 ACs checked.
