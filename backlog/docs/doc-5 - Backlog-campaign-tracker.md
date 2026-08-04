---
id: doc-5
title: Backlog campaign tracker
type: other
created_date: '2026-08-04 20:04'
updated_date: '2026-08-04 21:49'
---
# Backlog campaign tracker

Protocol: restore → compute the ready/conflict graph → mark the wave Dispatched
→ dispatch (parallel workers + review) → serialize the merge →
update this tracker once more at settlement → loop until the queue is empty or
blocked → write handover.

Driven by the `backlog-handover` skill (`.claude/skills/backlog-handover/SKILL.md`). This is a
new campaign round following the prior one (see `doc-4`, now complete — waves 1-15, all of
NCOW-9/10/12/16/17/18/19 and NCOW-31 Done there). This round exists specifically because
NCOW-31's own two review passes filed five follow-up tasks (NCOW-32 through NCOW-36) that
doc-4's inventory predates.

## Confirmed at init (2026-08-04) — do not re-ask

Fresh inventory of all 10 open Backlog tasks (`backlog task list --exclude-status Done`) at
this init: NCOW-7, NCOW-11, NCOW-13, NCOW-14, NCOW-15, NCOW-32, NCOW-33, NCOW-34, NCOW-35,
NCOW-36. Classification:

- **NCOW-32 through NCOW-36 are queued.** All five are follow-ups filed directly from
  NCOW-31's review passes, each names a concrete, objectively-verifiable acceptance criteria
  set, and each depends only on NCOW-31, which is Done — none blocked.
- **NCOW-7, NCOW-11, NCOW-13, NCOW-14, NCOW-15 remain excluded, unchanged since doc-4's
  round (all last updated 2026-07-31, before this init).** Re-checked fresh rather than
  trusted from the old tracker — still correctly not agent-resolvable as filed:
  - NCOW-7: explicitly PARKED (its own implementation notes) pending NCOW-15, since NCOW-13/15
    would likely make a rebuilt wizard structure throwaway work.
  - NCOW-11: has an open, unresolved design question (where do usage metrics actually come
    from against a stock, database-free LiteLLM install) that must be answered before the
    work is even scopeable.
  - NCOW-13: depends on NCOW-14, which is itself undecomposed.
  - NCOW-14: its own description says "Expect this to want splitting into subtasks when it is
    picked up" — a deep, multi-provider abstraction, not a single agent-sized unit.
  - NCOW-15: same self-described need to split into subtasks, plus multiple undecided design
    questions (single vs. multi-proxy, client-config-on-switch behavior).
  These five need a separate planning/decomposition session before a future campaign round
  can queue them — not something this round can resolve.

## Confirmed queue order (2026-08-04) — do not re-ask

User confirmed the proposed order: docs-only and comment-only fixes first (lowest risk,
zero/near-zero behavior change), then isolated hardening, then the tray refactor (structural
but well-scoped, precedent in menu.js), then the mutex-serialization change (most
behaviorally significant, touches live uninstall/auto-update proxy-stop paths) last.

## Frontier

The "ready now" set is ALWAYS recomputed live from the Backlog task list + this table
at the start of every restore/wave — never trust a persisted "next wave" plan.
As of wave 1 settlement (2026-08-04): 4 resolved (NCOW-34/33/36/35, all Done), 1 ready
(NCOW-32 — was deferred out of wave 1 by conflicts, no longer conflicts with anything since
its former conflict partners NCOW-33/NCOW-35 are both merged and resolved), 0 blocked,
5 excluded pending human decomposition (see Not queued).

Wave 1 conflict graph (file-citation read against real code, not just cluster labels), kept
for history: NCOW-34 = README.md/DESIGN.md only. NCOW-33 = engine-context.js comment only.
NCOW-36 = src/engine/configGen.js only. NCOW-35 = src/main/tray.js + src/main/index.js (createTray
call site) + test files. All four were mutually conflict-free and formed wave 1. NCOW-32 was
deferred solely because it would touch both engine-context.js (conflict with NCOW-33) and
src/main/index.js (conflict with NCOW-35, a finding made fresh at this restore — not previously
noted). Now that NCOW-33 and NCOW-35 are both merged, NCOW-32 is the only remaining queued task
and forms wave 2 alone (no conflict-avoidance decision needed — it's a singleton).

## Queue (confirmed order)

| # | Task ID | Cluster | Deps (mirrors each task's real `dependencies` field) | Status | Wave | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | NCOW-32 | proxy-mutex | NCOW-31 (Done) | To Do | | Serialize Uninstall + auto-update proxy-stop against the shared proxy mutex — ready now, forms wave 2 alone |

## Resolved

| # | Task ID | Status/date/wave | Evidence summary |
| --- | --- | --- | --- |
| 1 | NCOW-34 | Done, 2026-08-04, wave 1 | Documented the shutdown-mutex carve-out in README.md/DESIGN.md §7.4. AC #1 confirmed by independent review (opus): new doc text checked against the real engine-context.js comment, shutdown.js, index.js's tray mutex wiring, ipc.js's UNSERIALIZED_METHODS. npm test 333/333 (reviewer's own run). Merged as PR #24 (059f888). One wave-integration finding (dangling README cross-reference) fixed in the wave-1 cleanup (PR #28, e9fe0a7). |
| 2 | NCOW-33 | Done, 2026-08-04, wave 1 | Corrected engine-context.js's shutdown-mutex-exclusion comment (mechanism + window size). Both ACs confirmed by independent review (opus): technical claims re-verified against shutdown.js/pm2Control.js/autoUpdate.js; comment-only claim verified byte-for-byte (comment-stripped file diff was empty). npm test 333/333. Merged as PR #25 (8145984). One wave-integration finding (a window-size figure elsewhere in the same comment block, "up to 60s" vs "60s+") fixed in the wave-1 cleanup (PR #28, e9fe0a7). |
| 3 | NCOW-36 | Done, 2026-08-04, wave 1 | Hardened configGen's thrown-value logging guard with a structural safeStringify()/describeThrownValue() fix (2 review rounds — round 1 found the initial single-case fix still leaked on adjacent shapes; round 2 confirmed the structural rewrite closes it via 60+ adversarial probes and non-vacuity replay against pre-fix source). All 3 ACs confirmed by independent review (opus). npm test 339/339 at final review. Merged as PR #26 (8431df3). One wave-integration finding (orphaned JSDoc block) fixed in the wave-1 cleanup (PR #28, e9fe0a7). Two non-blocking follow-up candidates noted, not yet proposed as tasks (see Wave log). |
| 4 | NCOW-35 | Done, 2026-08-04, wave 1 | Extracted tray actions into createTrayActions({ mutexes, handlers }) in tray.js, matching menu.js precedent, with a genuine behavioral mutex-identity test (2 review rounds — round 1 found AC#2's core claim not yet proven, since the exact nested-scope-shadowing mutation still passed; round 2 confirmed a targeted static single-binding check closes that specific mutation class). All 3 ACs confirmed by independent review (opus), which also documented several further adversarial variants the guard still doesn't catch and judged that an acceptable stopping point. npm test 337/337 at final review (343/343 after later rebase). Merged as PR #27 (362202d). Two non-blocking follow-up candidates noted, not yet proposed as tasks (see Wave log). |

## Not queued — needs a human / blocked

- NCOW-7: PARKED pending NCOW-15 (own implementation notes, 2026-07-31) — rebuilding the
  Setup wizard now would likely be thrown away once NCOW-13/15 land.
- NCOW-11: open design question unresolved — where usage metrics come from against a stock,
  database-free LiteLLM install is not yet established, so the work isn't scopeable yet.
- NCOW-13: depends on NCOW-14, which is itself undecomposed — not resolvable until NCOW-14 is
  split and at least partly landed.
- NCOW-14: self-described as needing decomposition into subtasks before it's agent-sized; a
  deep multi-provider abstraction, not a single unit of work.
- NCOW-15: same — self-described need to split into subtasks, plus undecided design
  questions (single vs. multi-proxy, client-config-on-switch behavior) that need a human
  product decision first.

## Wave log

- 2026-08-04 — wave 1 dispatched (tasks: NCOW-34, NCOW-33, NCOW-36, NCOW-35): ground-truth
  drift check found no leftover branches/worktrees/PRs from prior init; treehouse pool had 3
  available (unleased) trees (grew to 4 on demand for this wave, all leased/branched off the
  same pinned wave-base SHA e0b528c). File-citation conflict read found a new NCOW-32↔NCOW-35
  conflict via src/main/index.js not previously noted.
- 2026-08-04 — wave 1 settled (tasks: NCOW-34, NCOW-33, NCOW-36, NCOW-35, all Done): all four
  implemented by parallel Sonnet workers, reviewed by an Opus reviewer per task. NCOW-34 and
  NCOW-33 approved on the first pass. NCOW-36 and NCOW-35 each needed one request_changes ->
  fix -> re-review cycle (1 of the 2 allowed retries each, well within the fix-cycle budget):
  NCOW-36's first fix patched only the exact reported shape and review found it still leaked
  on adjacent ones; the re-fix made the guard structurally throw-proof instead. NCOW-35's first
  fix's behavioral test was solid but didn't yet prove AC#2's specific claim (the tray's
  identity vs the shared mutex, seen from index.js's own call site); the re-fix added a
  narrowly-scoped static check for exactly that. All four merged serially via rebase + mandatory
  re-verify (npm test) + squash-merge + worktree/branch cleanup: NCOW-34 (PR #24, 059f888),
  NCOW-33 (PR #25, 8145984), NCOW-36 (PR #26, 8431df3), NCOW-35 (PR #27, 362202d — test count
  grew 333 -> 343 across the four merges as each built on the previous). A mandatory wave-level
  integration review over the cumulative diff then found 3 small, narrow, non-blocking
  cross-task issues (verdict: narrow_findings, no new task needed): (F1) engine-context.js's
  carve-out comment said the restart holds the lock "for up to 60s" while NCOW-34's own new
  DESIGN.md/README.md text correctly said "60s+"/"a minute or more" (the critical section can
  genuinely exceed 60s) -- three-way disagreement on the same fact; (F2) NCOW-34's new README
  paragraph had a dangling "as described above" that pointed at text that only exists in
  DESIGN.md, not README; (F3) NCOW-36 had inserted two helper functions between
  regenerateStaleConfig's JSDoc block and the function itself, orphaning the doc. A direct
  follow-up worker fixed all three (pure prose/comment corrections + pure code motion verified
  byte-identical via function-body hashing), reviewed and approved, merged as PR #28 (e9fe0a7,
  trailers on all of NCOW-34/33/36). Final suite: 343/343 passing on merged dev.
  Non-blocking follow-up candidates surfaced during review, NOT yet proposed to the user or
  created as tasks (per campaign convention -- task creation needs explicit approval): (a)
  harden configGen's adjacent "restart-failed" branch and autoUpdate.js:100 with the same
  safeStringify() pattern NCOW-36 introduced; (b) guard the tray call site in index.js against
  a post-spread onStart/onStop/onRestart key override (the most realistic accidental-regression
  shape found during NCOW-35's review); (c) soften a test comment that still slightly overstates
  what the tray's mutex-identity checks jointly prove. These will be proposed to the user (via
  AskUserQuestion, not created unilaterally) before the next wave, per this skill's Task-write
  concurrency rule.
