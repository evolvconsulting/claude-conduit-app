---
id: doc-3
title: Backlog campaign tracker
type: other
created_date: '2026-08-01 00:06'
updated_date: '2026-08-01 22:37'
---
# Backlog campaign tracker — COMPLETE (2026-08-01, after wave 4)

**This campaign is complete.** Every task an agent could resolve has been drained; every
remaining open Backlog task is blocked on something an agent alone cannot supply (a human
decomposition/planning session for NCOW-14/NCOW-15, or real code-signing certificates for
NCOW-10). Run `/backlog-handover init` to start a fresh campaign once new agent-resolvable work
exists (e.g. after NCOW-14/NCOW-15 are split into subtasks, or certificates are provisioned).

Protocol (for reference / the next campaign): restore → compute the ready/conflict graph → mark
the wave Dispatched → dispatch (parallel workers + review) → serialize the merge → update this
tracker once more at settlement → loop until the queue is empty or blocked → write handover.

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
  in scope for the wave; the actual repo rename is not. **Superseded at restore #4 below — the
  user explicitly asked for the manual rename to be run, and it has been.**

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
outweigh the small efficiency gain from pairing. Do not re-ask this ordering.

## Resolved at restore #4 (2026-08-01) — GitHub repo renamed; NCOW-9 unblocked in practice

NCOW-9 (deps: NCOW-12, done in wave 3) was newly unblocked at the Backlog-dependency level, but
its own implementation notes say publishing should wait until the GitHub repo is actually
renamed first (`evolvconsulting/nvidia-cowork` → `claude-conduit`) — otherwise download links,
appId, and any update feed would need to be built against a name about to change. That rename
was still an outstanding MANUAL step (see "Confirmed at init") as of restore #4. Presented this
to the user via AskUserQuestion with three options (defer NCOW-9 / dispatch it scoped-down with
AC#5 deferred / run the manual rename now). User chose: **run the manual rename now, then
dispatch NCOW-9 in full.** Orchestrator ran `gh repo rename claude-conduit --repo
evolvconsulting/nvidia-cowork --yes`, verified the new identity
(`https://github.com/evolvconsulting/claude-conduit`), confirmed the old URL now redirects to
it, updated this checkout's own `origin` remote (`git remote set-url origin
git@github.com:evolvconsulting/claude-conduit.git`), and verified connectivity with `git fetch
origin`. **The GitHub repo rename is DONE.** NCOW-9 entered wave 4 in full (not scoped down).

## Frontier — campaign complete, no ready tasks remain

As of wave 4 settlement (2026-08-01): NCOW-19 and NCOW-9 are Done (see Resolved). Every
remaining open Backlog task (`backlog task list --exclude-status Done`: NCOW-7, NCOW-10,
NCOW-11, NCOW-13, NCOW-14, NCOW-15) is already accounted for in "Not queued — needs a human /
blocked" below, and none became newly ready this wave. The confirmed-order Queue table is empty.
This campaign is complete — see the banner at the top of this doc.

## Queue (confirmed order)

*(empty — campaign complete, all queued tasks resolved)*

| # | Task ID | Cluster | Deps (mirrors each task's real `dependencies` field) | Status | Wave | Note |
| --- | --- | --- | --- | --- | --- | --- |

## Resolved

| # | Task ID | Status/date/wave | Evidence summary |
| --- | --- | --- | --- |
| 1 | NCOW-16 | Done, 2026-08-01, wave 1 | postMessages' single hardcoded 30s timeout replaced with DEFAULT_TIMEOUT_MS (30s) + configurable MODEL_COMPLETION_TIMEOUT_MS (60s, checks 4/5/6/8); timeouts now report an accurate "too slow for interactive use" message instead of an opaque abort. checkStreaming's fixed-50-chunk cap replaced with the same elapsed-time budget (AC#3). AC#2 re-scoped mid-implementation by explicit user decision after live evidence showed 90s/180s/300s ceilings all still timed out against genuine NVIDIA-side queue congestion on the shared/free trial endpoint. npm test 150/150 pass on merged dev. Live-verified twice independently against the real NVIDIA account. Reviewed by opus/xhigh — APPROVE, all 4 ACs independently confirmed live. Merged via PR #2, squash commit a56b156. |
| 2 | NCOW-18 | Done, 2026-08-01, wave 2 | Regenerated src/assets/licenses.json to add fsevents (MIT, darwin-only optional dep of chokidar/pm2), fixing staleness against a genuinely fresh npm install. Root cause: long-lived local checkouts (including the orchestrator's own main checkout, confirmed independently) had node_modules predating fsevents' resolution. Verified via a fully clean reinstall cycle and full npm test (150/150). Independently re-verified by an opus reviewer with fresh evidence (byte-identical regen, reproduced the original 78-vs-79 failure, confirmed fsevents is a real production transitive dependency with correct license text). All 3 ACs confirmed. Merged via PR #3, squash commit e80b263. |
| 3 | NCOW-17 | Done, 2026-08-01, wave 2 | Closed all 5 non-blocking findings from NCOW-16's review: per-read elapsed-time budget enforcement in checkStreaming (Promise.race), real selected-model name in timeout/failure messages, a UI Cancel button + AbortController plumbing (diagnostics domain has no per-domain mutex to release, confirmed by reading ipc.js directly), DESIGN.md section 11 rewritten with an accurate timeout table, and a bounded streaming buffer (1024-char tail-trim). 11 new tests (29/29 in diagnostics.test.js). All 6 ACs independently confirmed by an opus reviewer. Deliberately merged after NCOW-18 to avoid the known cross-branch licenses.json count mismatch. Full npm test: 161/161 pass on merged dev. Merged via PR #4, squash commit 3cdd1f9. |
| 4 | NCOW-12 | Done, 2026-08-01, wave 3 | Renamed product to Claude Conduit everywhere user-visible plus every code-level repo-slug reference. Implemented all 4 persisted-state migration decisions (config dir, pm2 app name deliberately unchanged, Electron userData/encrypted key, Claude Desktop entry with a legacy-name fallback added in a review fix pass). Two opus review passes (request_changes → fix → approve with mutation testing). npm test 176/176. All 8 ACs verified with objective evidence including a full real-machine pass run by the orchestrator under the user's live supervision. Merged via PR #5, squash commit 5b507e9. |
| 5 | NCOW-19 | Done, 2026-08-01, wave 4 | Made test/main/licenses.test.js's tree-coverage assertion platform-aware: reads package-lock.json's os/cpu restriction metadata and excludes bundled packages that couldn't install on the current platform (currently fsevents, darwin-only) from the expected count, instead of requiring licenses.json to be regenerated per platform. Added a membership check alongside the count. 2 new tests; independent reviewer re-derivation of the darwin/linux/win32 arithmetic against the real lockfile and licenses.json; 4-mutant mutation testing (3 confirmed real regression guards, 1 gap documented non-blocking). npm test 178/178. All 4 ACs independently confirmed by an opus reviewer. Merged via PR #6, squash commit b11e5be. |
| 6 | NCOW-9 | Done, 2026-08-01, wave 4 | Decided and documented the GitHub install story: GitHub Releases direct download as primary path, no curl-pipe install script (rejected — nothing legitimate for it to do beyond silently clearing macOS's quarantine flag, the malicious-installer pattern). Rewrote README's Install section + added docs/distribution.md with rationale, a verified signing-state table, and a release checklist. Found and fixed two real build-environment issues along the way (added homepage+repository to package.json as hardening against .git-layout dependence in worktrees/CI/tarballs — not a canonical-repo bugfix; an initial doc draft misattributed the root cause, corrected in a request_changes → fix → approve cycle, independently re-verified against the actual electron-builder source). 4 follow-up tasks recommended (release workflow, code-signing, Homebrew cask, Windows/Linux install verification) but NOT created, pending user approval. AC#5 left QUALIFIED/unchecked: its literal text needs a published Release + a clean target that don't exist yet; everything achievable today (signature/unsigned-state verification, a clean packaged-app launch under an isolated test home) was independently verified twice. npm test 178/178 stable across 10 runs. Merged via PR #7, squash commit ef793b4. |
| 7 | (untracked, direct follow-up) | Done, 2026-08-01, wave 4 integration | Wave-level integration review found CLAUDE.md still claimed the GitHub repo rename was "pending" (false as of restore #4) and the documented test count was stale (176 vs the real 178 after NCOW-19). Narrow, non-blocking finding — routed through a direct worker + re-review rather than a new Backlog task, per this campaign's own rule for narrow integration findings. Fixed and independently re-verified. Merged via PR #8, squash commit e731b45. |

## Not queued — needs a human / blocked

- NCOW-7: blocked on NCOW-15, which is deliberately excluded from this campaign (see Confirmed
  at init). Also explicitly PARKED by a prior-session decision recorded on the task itself —
  revisit after NCOW-15 is scoped/done separately.
- NCOW-10: needs real code-signing certificates (external/human-provisioned) before its ACs
  (a real install→update end to end) can be genuinely verified by an agent. Its Backlog
  dependency NCOW-9 is now Done, and NCOW-9's work directly benefits NCOW-10 (confirmed
  `latest*.yml` update-metadata emission, a documented release-artifact naming footgun to avoid)
  — but the certificate blocker is unrelated to NCOW-9 and remains fully outstanding.
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

- 2026-08-01 — wave 1 (task: NCOW-16): dispatched alone (Shared Machine State cap). Worker
  (sonnet) implemented the timeout rework; live verification revealed the account's real-world
  latency has no reliable finite "just wait longer" ceiling; user redirected mid-flight to a
  capped 60s with accurate "too slow" messaging. Reviewer (opus, xhigh) independently
  re-verified all 4 ACs live — APPROVE. Merged via PR #2 (squash a56b156).

- 2026-08-01 — wave 2 (tasks: NCOW-17, NCOW-18): dispatched in parallel. Both APPROVE from
  independent opus reviewers. Merge queue deliberately reordered (NCOW-18 first) to dodge a
  known cross-branch count mismatch — worked exactly as predicted. Merged via PR #3 (squash
  e80b263) then PR #4 (squash 3cdd1f9). Wave-integration review found zero cross-task issues;
  one non-blocking observation became NCOW-19 (user-approved follow-up task).

- 2026-08-01 — wave 3 (task: NCOW-12): solo. Review pass 1 request_changes (real reproducible
  duplicate-Claude-Desktop-entry edge case, 2 LOW + 2 TRIVIAL); fix pass; review pass 2 approve
  with mutation testing. Merged via PR #5 (squash 5b507e9). AC#5's real-machine leg completed
  live afterward: the orchestrator, under the user's explicit two-checkpoint supervision, backed
  up and genuinely upgraded this machine's real pre-rename install — every migration decision
  verified for real, zero duplication, clean pm2 shutdown. User chose to leave the machine
  migrated. NCOW-9 (deps: NCOW-12) unblocked.

- 2026-08-01 — restore #4 (pre-wave-4 reconciliation, no code change): the actual GitHub repo
  rename was run at the user's explicit request. Repo is now evolvconsulting/claude-conduit;
  local origin updated; connectivity verified. Unblocked NCOW-9 in practice.

- 2026-08-01 — wave 4 (tasks: NCOW-19, NCOW-9): dispatched in parallel (sonnet workers, two
  fresh treehouse worktrees on a newly-cycled pool — cold, required npm install for both).
  NCOW-19: opus review APPROVE first pass, all 4 ACs confirmed, 4-mutant mutation testing (3
  real guards, 1 documented gap). NCOW-9: opus review pass 1 request_changes — one real MEDIUM
  finding (an initial doc draft misattributed two build-environment quirks, caused by
  building inside a git worktree where `.git` is a file, as canonical-repo defects, which
  would have wrongly discredited an accurate prior task note and misled NCOW-10) plus 3 LOW
  polish items; fix pass corrected the root cause and restored the prior note's standing,
  addressed all LOW items; review pass 2 (final under the 2-retry cap) approve, independently
  re-verified against the actual electron-builder source. AC#5 recorded as qualified/unchecked
  per the reviewer's explicit recommendation (the literal criterion needs a published Release +
  clean target that don't exist yet; everything else achievable was independently verified
  twice, including a fresh launch of the truly-final packaged artifact under an isolated
  NIM_PROXY_TEST_HOME with real machine state confirmed untouched before and after). Both
  merged: NCOW-19 via PR #6 (squash b11e5be), NCOW-9 via PR #7 (squash ef793b4), rebased and
  re-tested cleanly in queue order, worktrees released, branches deleted. Wave-level
  integration review (opus) independently re-derived NCOW-19's arithmetic with NCOW-9's new
  package.json fields present (confirmed inert — npm does not mirror homepage/repository into
  the lockfile), byte-diffed a fresh `npm run licenses` regen against the committed
  licenses.json (identical), and scanned for stale repo-slug references — found no cross-task
  issues, but flagged one informational: CLAUDE.md still claimed the repo rename was "pending"
  (false since restore #4) and its documented test count was stale (176 vs 178). Narrow finding
  → routed through a direct worker + re-review (not a new Backlog task, per this campaign's own
  rule) rather than deferred; fixed and independently re-verified; merged via PR #8 (squash
  e731b45). npm test 178/178 stable throughout, confirmed on final merged dev.
  Housekeeping note: two /tmp directories from NCOW-9's live verification
  (`/tmp/ncow9-install` ~502MB, `/tmp/ncow9-fakehome`) could not be cleaned up by any agent —
  sandbox denies `rm -rf` even for disposable /tmp paths outside the repo — left for the user
  to delete manually if desired; harmless if left in place.
  **Frontier recomputed after settlement: empty. No remaining open task is agent-resolvable
  without either a human decomposition session (NCOW-14/15 and their dependents) or externally
  provisioned code-signing certificates (NCOW-10). Campaign complete.**
