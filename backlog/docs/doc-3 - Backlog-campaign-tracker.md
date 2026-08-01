---
id: doc-3
title: Backlog campaign tracker
type: other
created_date: '2026-08-01 00:06'
updated_date: '2026-08-01 17:27'
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

## Confirmed at restore #3 (2026-08-01) — wave 3 scope vs NCOW-19

Re-ran the file-citation conflict check fresh rather than trusting the previous handover's
assumption: NCOW-19 only touches `test/main/licenses.test.js` (making the tree-coverage
assertion platform-aware), while NCOW-12 touches the generated `licenses.json` itself (its
`app.name` field derives from `package.json`'s `productName`, which NCOW-12 changes) but not
the test file. **They do not share a file** — unlike NCOW-17/18, this pairing was not actually
forced apart by the conflict graph. Presented this finding to the user (AskUserQuestion) with
three options (NCOW-12 solo / NCOW-19-then-NCOW-12 / both in parallel); user chose **NCOW-12
solo this wave**, given its size and sensitivity (persisted-state migration decisions requiring
a decide-vs-defer judgment call, live app verification, edits near a real Claude Desktop entry)
outweigh the small efficiency gain from pairing. NCOW-19 is next up after NCOW-12 settles — a
fast, low-risk wave. Do not re-ask this ordering.

## Frontier

The "ready now" set is ALWAYS recomputed live from the Backlog task list + this table
at the start of every restore/wave — never trust a persisted "next wave" plan.
As of wave 3 dispatch (2026-08-01): NCOW-12 is Dispatched, wave 3, solo (Shared Machine State —
needs live app/proxy verification under `NIM_PROXY_TEST_HOME`). NCOW-19 remains ready (no deps,
no conflict with NCOW-12) and is next after NCOW-12 settles. NCOW-9 remains blocked on NCOW-12.

## Queue (confirmed order)

| # | Task ID | Cluster | Deps (mirrors each task's real `dependencies` field) | Status | Wave | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | NCOW-12 | rebrand | (none) | Dispatched | 3 | solo wave — large, touches persisted user state + needs live verification; repo rename stays manual |
| 2 | NCOW-19 | hygiene | (none) | To Do | | ready now; runs next after NCOW-12 settles per restore #3 confirmation |
| 3 | NCOW-9 | release | NCOW-12 | Blocked | | unblocks once NCOW-12 resolves |

## Resolved

| # | Task ID | Status/date/wave | Evidence summary |
| --- | --- | --- | --- |
| 1 | NCOW-16 | Done, 2026-08-01, wave 1 | postMessages' single hardcoded 30s timeout replaced with DEFAULT_TIMEOUT_MS (30s) + configurable MODEL_COMPLETION_TIMEOUT_MS (60s, checks 4/5/6/8); timeouts now report an accurate "too slow for interactive use" message instead of an opaque abort. checkStreaming's fixed-50-chunk cap replaced with the same elapsed-time budget (AC#3). AC#2 re-scoped mid-implementation by explicit user decision after live evidence showed 90s/180s/300s ceilings all still timed out against genuine NVIDIA-side queue congestion on the shared/free trial endpoint. npm test 150/150 pass on merged dev. Live-verified twice independently against the real NVIDIA account. Reviewed by opus/xhigh — APPROVE, all 4 ACs independently confirmed live. Merged via PR #2, squash commit a56b156. |
| 2 | NCOW-18 | Done, 2026-08-01, wave 2 | Regenerated src/assets/licenses.json to add fsevents (MIT, darwin-only optional dep of chokidar/pm2), fixing staleness against a genuinely fresh npm install. Root cause: long-lived local checkouts (including the orchestrator's own main checkout, confirmed independently) had node_modules predating fsevents' resolution. Verified via a fully clean reinstall cycle and full npm test (150/150). Independently re-verified by an opus reviewer with fresh evidence (byte-identical regen, reproduced the original 78-vs-79 failure, confirmed fsevents is a real production transitive dependency with correct license text). All 3 ACs confirmed. Merged via PR #3, squash commit e80b263. |
| 3 | NCOW-17 | Done, 2026-08-01, wave 2 | Closed all 5 non-blocking findings from NCOW-16's review: per-read elapsed-time budget enforcement in checkStreaming (Promise.race), real selected-model name in timeout/failure messages, a UI Cancel button + AbortController plumbing (diagnostics domain has no per-domain mutex to release, confirmed by reading ipc.js directly), DESIGN.md section 11 rewritten with an accurate timeout table, and a bounded streaming buffer (1024-char tail-trim). 11 new tests (29/29 in diagnostics.test.js). All 6 ACs independently confirmed by an opus reviewer (reproduced the pre-fix infinite hang, verified the mutex-absence premise directly, traced AbortController plumbing end-to-end, spot-checked every DESIGN.md timeout number against code). Deliberately merged after NCOW-18 to avoid the known cross-branch licenses.json count mismatch during the merge queue's mandatory post-rebase test. Full npm test: 161/161 pass on merged dev. Wave-level integration review (opus) found zero cross-task issues between this and NCOW-18. Merged via PR #4, squash commit 3cdd1f9. |

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

## Wave log

- 2026-08-01 — wave 1 (task: NCOW-16): dispatched alone (Shared Machine State cap — NCOW-12
  also needs live verification, so only one live-verification task per wave). Worker (sonnet)
  implemented the timeout rework; live verification revealed the account's real-world latency
  has no reliable finite "just wait longer" ceiling. User redirected the approach mid-flight:
  capped at an interactive-reasonable 60s with accurate "too slow" messaging. Reviewer (opus,
  xhigh) independently re-verified all 4 ACs live — APPROVE. Merged via PR #2 (squash commit
  a56b156), worktree released, branch deleted. Settled: task marked Done with all 4 ACs checked.

- 2026-08-01 — wave 2 (tasks: NCOW-17, NCOW-18): dispatched in parallel (sonnet workers, two
  treehouse worktrees) after user confirmed this pairing over a solo NCOW-12 wave. Both
  implemented cleanly and pushed. Reviewed in parallel by independent opus reviewers, both
  APPROVE — NCOW-18 all 3 ACs confirmed, NCOW-17 all 6 ACs confirmed. NCOW-17's reviewer
  surfaced a cross-branch caveat: the licenses.json count divergence is platform-dependent
  (fsevents, a darwin-only optional dep), and the orchestrator's own long-lived main checkout
  independently reproduced the exact same staleness NCOW-18 was fixing — confirming the root
  cause and prompting the orchestrator to refresh its own node_modules ahead of the merge walk.
  Merge queue deliberately reordered (NCOW-18 first, then NCOW-17, rather than the tracker's
  listed order) so the mandatory post-rebase npm test never hit the known count mismatch —
  confirmed working exactly as predicted (150/150 after NCOW-18's merge, 161/161 after NCOW-17's).
  Merged via PR #3 (squash e80b263) then PR #4 (squash 3cdd1f9), worktrees released, branches
  deleted. Wave-level integration review (opus) found the two changesets genuinely disjoint,
  npm test 161/161 on the combined result, no cross-task defects — one non-blocking observation
  (licenses.test.js's tree-coverage assertion is now platform-sensitive, darwin-green only, the
  mirror image of the bug NCOW-18 fixed; no CI exists so nothing broken today). User approved
  (AskUserQuestion) creating a follow-up task rather than leaving it untracked: NCOW-19. Settled:
  both tasks marked Done with all confirmed ACs checked.

- 2026-08-01 — wave 3 dispatched (task: NCOW-12): solo, per restore #3 confirmation above. In
  flight — see next wave log entry at settlement.
