---
id: doc-5
title: Backlog campaign tracker
type: other
created_date: '2026-08-04 20:04'
updated_date: '2026-08-05 01:46'
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

**Extended 2026-08-04 (wave 2 restore) — same principle, not a new decision**: wave 1's
reviews surfaced 3 non-blocking follow-ups; the user approved filing all three as NCOW-37
(hardening, isolated), NCOW-38 (tray call-site guard, structural but well-scoped), and NCOW-39
(comment-only). Slotted into the queue using the identical already-confirmed principle —
comment-only first, isolated hardening next, tray-related next, mutex-serialization
(NCOW-32) last — rather than re-asking the user to re-rank four items against a rule they
already gave.

## Frontier

The "ready now" set is ALWAYS recomputed live from the Backlog task list + this table
at the start of every restore/wave — never trust a persisted "next wave" plan.
As of wave 3 dispatch (2026-08-04): 6 resolved (wave 1 + wave 2, all Done), 3 ready
(NCOW-38, NCOW-32, NCOW-40), 1 blocked (NCOW-41 — depends on NCOW-38, not yet Done; see
Critical context for why this dependency was added), 0 other blocked, 5 excluded pending
human decomposition (see Not queued). Wave 2's integration review findings were approved by
the user and filed as NCOW-40/41, with NCOW-38 amended (AC#4) — see Wave log.

Wave 1 conflict graph (file-citation read against real code, not just cluster labels), kept
for history: NCOW-34 = README.md/DESIGN.md only. NCOW-33 = engine-context.js comment only.
NCOW-36 = src/engine/configGen.js only. NCOW-35 = src/main/tray.js + src/main/index.js (createTray
call site) + test files. All four were mutually conflict-free and formed wave 1. NCOW-32 was
deferred solely because it would touch both engine-context.js (conflict with NCOW-33) and
src/main/index.js (conflict with NCOW-35, a finding made fresh at this restore — not previously
noted).

**Wave 2 conflict graph (file-citation read, fresh at this restore)**: NCOW-32 candidates =
src/engine/uninstall.js, src/main/engine-context.js, src/main/autoUpdate.js, src/main/index.js
(deps wiring into createAutoUpdate), test/main/ipc-mutex.test.js, test/engine/uninstall.test.js,
test/main/autoUpdate.test.js. NCOW-37 candidates = src/engine/configGen.js,
src/main/autoUpdate.js, test/engine/configGen.test.js, test/main/autoUpdate.test.js (confirmed:
existing describeThrownValue/restart-failed unit tests live in test/engine/configGen.test.js,
not the integration-level test/main/engine-context-config-regen.test.js). NCOW-38 candidates =
src/main/index.js (createTray call site, lines ~174-189), test/main/engine-context-config-regen.test.js
and/or test/main/tray-actions.test.js (both explicitly named in NCOW-38's own description as the
two existing checks its new guard sits beside). NCOW-39 candidates =
test/main/engine-context-config-regen.test.js only (the same comment block + static check
NCOW-38 will extend).

Edges found: NCOW-32↔NCOW-37 (share src/main/autoUpdate.js and test/main/autoUpdate.test.js),
NCOW-32↔NCOW-38 (share src/main/index.js — a repeat of the exact hub-file pattern first noted
in wave 1: this file keeps accumulating unrelated concerns in different regions), NCOW-38↔NCOW-39
(share test/main/engine-context-config-regen.test.js, same comment/check region). No edge
NCOW-32↔NCOW-39, NCOW-37↔NCOW-38, NCOW-37↔NCOW-39. Greedy over confirmed order
[NCOW-39, NCOW-37, NCOW-38, NCOW-32]: NCOW-39 added; NCOW-37 added (no conflict with NCOW-39);
NCOW-38 skipped (conflicts with NCOW-39, already in wave); NCOW-32 skipped (conflicts with
NCOW-37, already in wave). **Wave 2 = {NCOW-39, NCOW-37}.** NCOW-38 and NCOW-32 remain queued
for subsequent waves — they also conflict with each other via src/main/index.js, so expect two
more solo waves (3 and 4), a correct sequential degradation, not a bug.

**Wave 3 conflict graph (file-citation read, fresh at this restore, over the ready set
{NCOW-38, NCOW-32, NCOW-40} — NCOW-41 excluded, blocked on NCOW-38's dependency)**: NCOW-40
candidates = src/main/autoUpdate.js, src/engine/configGen.js (describeThrownValue refactor),
test/main/autoUpdate.test.js, test/engine/configGen.test.js. NCOW-38/NCOW-32 candidates
unchanged from the wave-2 conflict graph above. Edges: NCOW-38↔NCOW-32 (src/main/index.js,
as before), NCOW-32↔NCOW-40 (share src/main/autoUpdate.js — NCOW-32 wires the mutex into
installUpdateAndRestart's stopProxyForShutdown call, NCOW-40 hardens performCheck()'s catch
and the darwin-path branch elsewhere in the same file). No edge NCOW-38↔NCOW-40 (disjoint
file sets). Greedy over confirmed order [NCOW-40, NCOW-38, NCOW-32] (isolated hardening
first, tray-guard next, mutex-serialization last, per the already-confirmed principle):
NCOW-40 added; NCOW-38 added (no conflict with NCOW-40); NCOW-32 skipped (conflicts with both
NCOW-40 and NCOW-38, already in wave). **Wave 3 = {NCOW-40, NCOW-38}.** NCOW-32 deferred to a
solo wave 4; NCOW-41 will join a future wave once NCOW-38 lands and its dependency clears.

## Queue (confirmed order)

| # | Task ID | Cluster | Deps (mirrors each task's real `dependencies` field) | Status | Wave | Note |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | NCOW-40 | error-hardening | NCOW-37 (Done) | Dispatched | 3 | Harden autoUpdate.js's last 2 unguarded sites + 2 configGen.js cleanups |
| 2 | NCOW-38 | tray-guard | NCOW-35 (Done) | Dispatched | 3 | Guard index.js's createTray call site against a post-spread action-key override; AC#4 also updates the shared comment block |
| 3 | NCOW-32 | proxy-mutex | NCOW-31 (Done) | To Do | | Serialize Uninstall + auto-update proxy-stop against the shared proxy mutex — conflicts with NCOW-40 (autoUpdate.js) and NCOW-38 (index.js), deferred to wave 4 |
| 4 | NCOW-41 | tray-guard | NCOW-35 (Done), NCOW-38 (To Do) | Blocked | | Covers the other 3 tray-wiring gaps NCOW-38 doesn't; blocked until NCOW-38 lands (both edit the same comment block) |

## Resolved

| # | Task ID | Status/date/wave | Evidence summary |
| --- | --- | --- | --- |
| 1 | NCOW-34 | Done, 2026-08-04, wave 1 | Documented the shutdown-mutex carve-out in README.md/DESIGN.md §7.4. AC #1 confirmed by independent review (opus): new doc text checked against the real engine-context.js comment, shutdown.js, index.js's tray mutex wiring, ipc.js's UNSERIALIZED_METHODS. npm test 333/333 (reviewer's own run). Merged as PR #24 (059f888). One wave-integration finding (dangling README cross-reference) fixed in the wave-1 cleanup (PR #28, e9fe0a7). |
| 2 | NCOW-33 | Done, 2026-08-04, wave 1 | Corrected engine-context.js's shutdown-mutex-exclusion comment (mechanism + window size). Both ACs confirmed by independent review (opus): technical claims re-verified against shutdown.js/pm2Control.js/autoUpdate.js; comment-only claim verified byte-for-byte (comment-stripped file diff was empty). npm test 333/333. Merged as PR #25 (8145984). One wave-integration finding (a window-size figure elsewhere in the same comment block, "up to 60s" vs "60s+") fixed in the wave-1 cleanup (PR #28, e9fe0a7). |
| 3 | NCOW-36 | Done, 2026-08-04, wave 1 | Hardened configGen's thrown-value logging guard with a structural safeStringify()/describeThrownValue() fix (2 review rounds — round 1 found the initial single-case fix still leaked on adjacent shapes; round 2 confirmed the structural rewrite closes it via 60+ adversarial probes and non-vacuity replay against pre-fix source). All 3 ACs confirmed by independent review (opus). npm test 339/339 at final review. Merged as PR #26 (8431df3). One wave-integration finding (orphaned JSDoc block) fixed in the wave-1 cleanup (PR #28, e9fe0a7). Two non-blocking follow-up candidates noted, not yet proposed as tasks (see Wave log) — both since filed as NCOW-37 and part of NCOW-38/39 (see wave 2 dispatch entry below). |
| 4 | NCOW-35 | Done, 2026-08-04, wave 1 | Extracted tray actions into createTrayActions({ mutexes, handlers }) in tray.js, matching menu.js precedent, with a genuine behavioral mutex-identity test (2 review rounds — round 1 found AC#2's core claim not yet proven, since the exact nested-scope-shadowing mutation still passed; round 2 confirmed a targeted static single-binding check closes that specific mutation class). All 3 ACs confirmed by independent review (opus), which also documented several further adversarial variants the guard still doesn't catch and judged that an acceptable stopping point. npm test 337/337 at final review (343/343 after later rebase). Merged as PR #27 (362202d). Two non-blocking follow-up candidates noted, not yet proposed as tasks (see Wave log) — both since filed as NCOW-38 and NCOW-39 (see wave 2 dispatch entry below). |
| 5 | NCOW-39 | Done, 2026-08-04, wave 2 | Softened test/main/engine-context-config-regen.test.js's overstated "close the chain honestly" comment. 2 review rounds (opus) — round 1 found the first softening replaced one overstatement with a narrower, still-false one (reviewer empirically reproduced a private-handlers-shadow passing 343/343); round 2 confirmed the fix correctly scopes the claim to what each check proves and lists all 4 known residual gaps as siblings. All 3 ACs confirmed. Comment-only diff across both commits. npm test 343/343 (both review passes), 348/348 on merged dev (wave-integration reviewer's own run). Merged as PR #29 (c86f908). |
| 6 | NCOW-37 | Done, 2026-08-04, wave 2 | Hardened configGen.js's regenerateStaleConfig() "restart-failed" branch (new safeReadProperty() + existing safeStringify()) and autoUpdate.js's electron-updater "error" handler (describeThrownValue(), imported from ../engine/configGen) — the 2 remaining unguarded-interpolation sites NCOW-36's reviewer had flagged. Approved on the first review pass (opus): all 4 ACs confirmed, including the reviewer's own from-scratch 38-case adversarial probe (0 failures against the fix, 21 against unpatched dev; reverting to dev made exactly the 5 new tests fail). npm test 348/348 (reviewer's own run; wave-integration reviewer's own run). Merged as PR #30 (6c5ecaf). Wave-2 integration review surfaced 2 real follow-up candidates (see Wave log) — not yet approved/created. |

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
- 2026-08-04 — between waves 1 and 2: proposed all 3 wave-1 follow-up candidates to the user
  via AskUserQuestion; all 3 approved. Created NCOW-37 (harden 2 remaining unguarded
  interpolation sites), NCOW-38 (guard tray call site against post-spread override), NCOW-39
  (soften overstated test comment) — each with concrete file/line references re-verified
  against current source (not assumed from the review notes) and dependencies on their
  originating wave-1 task. Committed + pushed (404fb68).
- 2026-08-04 — wave 2 dispatched (tasks: NCOW-39, NCOW-37): ground-truth drift check found
  dev in sync with origin/dev, all wave-1 PRs merged, all 4 treehouse trees released and
  available, tracker matched the handover exactly -- no drift. Fresh file-citation conflict
  read (see Frontier above) found NCOW-38 and NCOW-32 both conflict with a wave-2 member and
  with each other, so they're deferred to solo waves 3 and 4.
- 2026-08-04 — wave 2 settled (tasks: NCOW-39, NCOW-37, both Done): NCOW-37 approved on the
  first review pass. NCOW-39 needed one request_changes -> fix -> re-review cycle (1 of 2
  allowed retries): pass 1 found the first softening of the "close the chain honestly"
  comment had replaced one overstatement with a narrower, still-false one (the reviewer
  empirically reproduced a private-handlers-shadow passing the full suite, and cross-checked
  2 more gaps already recorded in NCOW-35's own review notes); the re-fix correctly scoped
  the claim to what each check actually proves and listed all 4 known residual gaps as
  siblings, approved on pass 2 with 2 low-severity residuals accepted (narrow, zero blast
  radius). Both merged serially via rebase + mandatory re-verify (npm test) + squash-merge +
  worktree/branch cleanup: NCOW-39 (PR #29, c86f908), NCOW-37 (PR #30, 6c5ecaf — test count
  grew 343 -> 348). A mandatory wave-level integration review over the cumulative diff found
  no cross-task conflicts (disjoint file sets, no stale references, no duplicate/contradictory
  implementations) but verdict `needs_new_task`: it surfaced 2 real, previously-untracked
  follow-up candidates that only become visible at wave level --
  (Task A) autoUpdate.js's checkForUpdates() catch and its darwin-path error interpolation
  remain unguarded (the same class NCOW-37 just fixed elsewhere in the same file), rejecting
  on 4/5 and 3/4 hostile shapes respectively despite the module's own "Always resolves"/
  "never throw" doc comments now reading as overstated for two sites 30-55 lines below;
  bounded severity confirmed (index.js:209 already has a real .catch(), so the practical
  effect is a missed status-broadcast, not a crash or hang). Also noted in the same file:
  safeReadProperty() was extracted from describeThrownValue() but describeThrownValue()
  still carries 2 inline copies of the same guard (dead duplication, behavior-preserving to
  collapse), and the newly-exported safeStringify() has zero consumers.
  (Task B) NCOW-39's new comment documents 4 residual tray-wiring gaps; NCOW-38 (queued,
  wave 3) covers only 1 of them (the post-spread key override). The other 3 -- no `handlers`
  single-binding check, property-level mutation of `mutexes.proxy` (verified a REAL
  serialization break per NCOW-35's own review notes), and parameter shadowing -- have no
  covering task at all. Separately, NCOW-39's review pass 2 explicitly deferred 2 low-severity
  comment-accuracy residuals as "worth folding into NCOW-38's edit of this same block when it
  lands" -- but NCOW-38's current ACs say nothing about touching this comment, so that
  deferral is at risk of being silently lost unless NCOW-38 is amended.
  Per campaign convention, Task A and Task B are proposed to the user (AskUserQuestion) before
  any task is created or NCOW-38 is amended -- not created unilaterally. Final suite: 348/348
  passing on merged dev (wave-integration reviewer's own run).
- 2026-08-04 — between waves 2 and 3: proposed Task A and Task B (from the wave-2 integration
  review) plus amending NCOW-38 to the user via AskUserQuestion; all 3 approved. Created
  NCOW-40 (Task A: harden autoUpdate.js's 2 remaining unguarded sites, plus fold in the
  describeThrownValue()/safeReadProperty() duplication cleanup and the unused safeStringify()
  export) and NCOW-41 (Task B: cover the other 3 tray-wiring gaps NCOW-38 doesn't). Added
  NCOW-38 AC#4 so its edit of the shared comment block also folds in NCOW-39 review pass 2's
  2 accepted residuals, rather than that deferral being silently lost. Also set NCOW-41's
  dependencies to NCOW-35,NCOW-38 (not just NCOW-35) -- both tasks edit the same
  comment/single-binding-check block in test/main/engine-context-config-regen.test.js, and
  NCOW-38's new AC#4 requires it land first; this is a genuine landing-order requirement, not
  just a same-wave scheduling conflict, so it was formalized as a real dependency rather than
  left as a conflict-graph note only. Committed + pushed (43b5103, 5d2982d).
- 2026-08-04 — wave 3 dispatched (tasks: NCOW-40, NCOW-38): ready set recomputed fresh
  ({NCOW-38, NCOW-32, NCOW-40} ready; NCOW-41 blocked on NCOW-38). Fresh file-citation
  conflict read (see Frontier above) found NCOW-32 conflicts with both NCOW-40
  (src/main/autoUpdate.js) and NCOW-38 (src/main/index.js) but NCOW-40/NCOW-38 are
  conflict-free with each other. Wave 3 = {NCOW-40, NCOW-38}; NCOW-32 deferred to a solo
  wave 4.

## Follow-ups to propose

(Resolved 2026-08-04 between waves 1 and 2 — see Wave log entry above. All 3 approved and
filed as NCOW-37/38/39. Resolved again between waves 2 and 3 — Task A/B approved and filed as
NCOW-40/41, NCOW-38 amended — see Wave log entry above.)

## Critical context / traps

- Doc-4 (the prior, complete campaign round's tracker) should not be reopened or edited —
  doc-5 is the live tracker.
- **A new file-conflict finding this round, worth remembering for future waves in this same
  cluster**: `src/main/index.js` already destructures `mutexes` from `createEngineContext()`
  and uses it in more than one place (the autoUpdate `stopProxyForShutdown` wiring AND the
  tray creation block after NCOW-35's merge) — any future task touching either of those two
  regions conflicts with the other via this one file, even when they're in different
  "clusters." Don't rely on cluster labels alone for this file; always do the file-citation
  read. **Confirmed again at wave 2 restore**: NCOW-32 and NCOW-38 collide via this exact same
  file for exactly this reason, and NCOW-37 collides with NCOW-32 via the analogous
  src/main/autoUpdate.js. This file (and autoUpdate.js) are becoming standing hub files for
  this cluster — expect every future proxy-mutex/tray/auto-update task to need a fresh
  file-citation check against them rather than trusting cluster labels.
- **`test/main/engine-context-config-regen.test.js` is also becoming a hub file for the
  tray-mutex-identity sub-cluster** (NCOW-35's static single-binding check and its
  surrounding comment live there) — any future task touching that specific check/comment
  region conflicts with siblings the same way.
- **Review-fix cycles worked exactly as the skill intends, twice in wave 1**: NCOW-36 and
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
  dropped. (NCOW-37/38/39 are exactly those recorded gaps being closed now.)
- Treehouse pool grew from 3 to 4 trees on demand in wave 1; all 4 released and available
  again after wave 1 settlement, warm (`node_modules` present) for wave 2.

## Do not repeat

- Two Agent-tool dispatch attempts failed with `herdr pane split ... pane_not_found` when the
  `name` parameter was passed to the Agent tool call. Retrying the identical dispatch without
  `name` succeeded immediately. If launching worker/reviewer agents ever fails with a
  pane-related error again, drop the `name` parameter before troubleshooting further.
