---
id: CCA-14.4
title: 'Diagnostics: report per-provider capabilities instead of NIM-only checks'
status: In Progress
assignee: []
created_date: '2026-08-16 14:45'
updated_date: '2026-08-17 04:15'
labels: []
dependencies:
  - CCA-14.1
parent_task_id: CCA-14
priority: high
type: enhancement
ordinal: 80000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update the diagnostics suite (src/engine/diagnostics.js) to report what the active provider actually supports, per its declared capabilities, instead of failing checks that only ever applied to NIM.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Diagnostics checks are keyed off the active provider's declared capabilities rather than hardcoded NIM assumptions
- [ ] #2 A provider that does not support a given check (e.g. no catalog listing) reports that plainly rather than failing
- [ ] #3 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read diagnostics.js, its test file, providers/registry.js + nvidia.js + openrouter.js, and
   engine-context.js in full to find every NIM-only assumption and how the active provider is
   already threaded through (listModels).
2. Identify the two hardcoded NIM-only checks: model-catalog reachability (assumed always listable)
   and tool-calling criticality (always hardcoded critical:true).
3. Rework both to key off declareCapabilities() (supportsModelListing, supportsToolCalling), with a
   new non-critical "skipped" status for an unsupported check rather than an attempted-then-failed
   one. Default to the old NIM-shaped behavior when capabilities is omitted (backward compatible).
4. Thread capabilities/providerLabel into diagnostics' two call sites in engine-context.js, alongside
   the already-existing listModels wiring -- same pattern, minimal diff.
5. Prove AC#1 with OpenRouter vs NVIDIA's real declared capabilities producing different diagnostic
   output; prove AC#2 with a constructed unsupported-capability case reporting "skipped" rather than
   failing or silently omitting; prove non-vacuity by reverting the gates and confirming exactly the
   3 new tests fail.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Wave-18 implementation evidence (worker, branch `feat/CCA-14.4-diagnostics-per-provider`,
commits `f73371f` + `3f49918`, branched from `52a7f7e`)

Recorded by the orchestrator from the worker's structured return. NOT yet independently reviewed.

Found exactly two NIM-only assumptions in `diagnostics.js`: a model-catalog-reachability check that
always assumed listing was possible (reworked as `checkModelCatalog`, gated on
`capabilities.supportsModelListing`, returning a new non-critical `status: 'skipped'` result rather
than attempting-then-failing when unsupported), and a tool-calling check that always hardcoded
`critical: true` (now keyed off `capabilities.supportsToolCalling` -- `'verified'` stays critical,
`'varies-by-model'`/`'unverified'` become non-critical with a plain "not guaranteed by this provider"
note). Both default to the old NIM-shaped behavior when `capabilities` is omitted, so no pre-existing
caller's behavior changes implicitly.

**AC#1** proven with OpenRouter's and NVIDIA's REAL, already-registered `declareCapabilities()`:
identical mocked response, but `checkToolCalling` returns `critical: true` for NVIDIA and `critical:
false` for OpenRouter -- a genuine behavioral difference driven only by declared capability, not a
hypothetical.

**AC#2** proven with a constructed `{supportsModelListing: false}` capability: `checkModelCatalog`
returns `status: 'skipped'`, `critical: false`, a detail matching `/does not support/i`, and asserts
`listModels` was NEVER CALLED -- confirming it reports plainly rather than attempting-then-failing.
Backward-compat tests confirm omitting `capabilities` entirely reproduces the exact old hardcoded
behavior.

**Non-vacuity (AC#3/process discipline this campaign requires)**: backed up the fixed file, reverted
both capability gates in place (hardcoded `critical=true`, removed the `supportsModelListing`
short-circuit), reran the suite -- exactly the 3 new capability-driven tests failed, nothing else
regressed. Restored via a byte-identical diff, reran clean.

**npm test**: 38/38 on `diagnostics.test.js` alone; **528/528 full suite** (522 baseline + 6 new
tests -- worker hit a transient Electron-binary-installation flake mid-session unrelated to this
change, resolved itself once Electron finished installing in that environment; both files that
briefly failed pass cleanly in isolation).

Files touched: `src/engine/diagnostics.js` and its test file (expected footprint); `engine-context.js`
gained exactly 8 lines across its two existing `diagnostics.*` call sites, threading
`capabilities: activeProvider.declareCapabilities()` and `providerLabel: activeProvider.label`
alongside the already-existing `listModels` wiring -- same established pattern, the `activeProvider`
pinning itself (`'nvidia-nim'`) untouched. No changes to `registry.js`/`nvidia.js`/`openrouter.js`; no
blocker hit.

## Wave-18 review pass 1 verdict — REQUEST_CHANGES (reviewer, Opus, in the branch's own worktree)

Reviewed `f73371f`+`3f49918`. AC#1/#3 confirmed with independent evidence (read both real providers'
`declareCapabilities()` directly; own `npm test` run: 528/528, +6 from the 522 baseline; independently
reverted both gates and reproduced exactly 3 test failures, restored byte-identical). AC#2 confirmed
at the ENGINE layer only -- the reviewer found the reporting path does not actually honor it.

### Finding A (BLOCKING) — `status: 'skipped'` renders as a red X failure in all 3 UI consumers

AC#2 requires an unsupported check to report "plainly rather than failing." True only inside
`diagnostics.js` itself. Every consumer treats `status` as binary pass/fail:
`src/renderer/views/diagnostics-view.js:76,79`, `src/renderer/views/setup-view.js:279`, and
`src/renderer/views/dashboard-view.js:84` all use a `status === 'pass' ? ... : 'fail'/✗` ternary with
no third branch. A `skipped` result renders as a red X labeled "warn-only" -- visually a failure,
exactly what AC#2 forbids. Unreachable today (both registered providers declare
`supportsModelListing: true`, `activeProvider` still pinned to `'nvidia-nim'`), but **CCA-14.3's new
Custom/Local provider is the single most likely provider ever to declare
`supportsModelListing: false`, activating this in the SAME wave.** No renderer test covers `skipped`
at all. Fix is three one-line ternaries plus a renderer test.

### Finding B (should-fix) — a third hardcoded NIM assumption the worker's "exactly two" claim missed

`diagnostics.js:83`'s `timeoutDetail()` emits, on ANY timeout across checks 4-8: "...this can happen
on NVIDIA's shared/free endpoint under load...". Simply false for an OpenRouter (or future Custom/
Local) user. `providerLabel` is already threaded into `opts` for this exact purpose but not used here
-- `checkCompletion`/`checkStreaming` would need it passed through too.

### Nits (non-blocking)
- Self-contradictory test title ("real capability difference" on a test asserting two providers are
  IDENTICAL) -- the inline comment is honest, the title isn't.
- An unsubstantiated parenthetical claims NVIDIA's `'verified'` tool-calling rests on the app having
  "confirmed tool calling works for every recommended NIM model" -- reviewer found no such
  verification record in DESIGN.md/README.md, only curation intent and an "unverified" warning for
  NON-recommended models. Invented justification for a pre-existing value this branch didn't even set.
- `nimBaseUrl` param name and its no-injection NVIDIA-specific fallback default persist in the now-
  generic `checkModelCatalog` (documented, not live-reachable since `engine-context.js` always
  injects).

### Confirmed clean
Scope: exactly the 3 claimed files (105/8/110 line diff); `engine-context.js`'s +8 lines are far from
CCA-14.3's likely edit region, and the pinning at line 31 is untouched -- no merge conflict expected
with that sibling. Notes the real cross-task risk IS Finding A, since CCA-14.3 is what would actually
trigger the `skipped` path in practice. `requiresApiKey` (the third capability field) is never
consulted in diagnostics -- not a defect, just noted as unused today.

Fix pass 1 dispatched into the same worktree with both findings verbatim.

## Wave-18 fix pass 1 (fresh worker, same worktree, commits `c11f586` + `60400f7`)

Recorded by the orchestrator from the worker's structured return. NOT yet independently reviewed.

**Finding A (BLOCKING) fixed.** All three UI consumers previously mapped anything other than
`'pass'` to the failure class/symbol. Added a genuine third `status === 'skipped'` branch to each:
`diagnostics-view.js` (new `statusClass()`/`statusSymbol()` helpers), `setup-view.js` (new
`quickResultClass()`/`quickResultSymbol()`), `dashboard-view.js` (inline third ternary arm), plus a
new `.skip { color: var(--muted); font-weight: 600; }` CSS rule matching the existing `--muted`
precedent already used for other non-pass/fail states. Concrete before/after evidence: executed the
real extracted template (same technique `test/main/index.test.js` already uses) -- a skipped row now
renders `class="skip"`, symbol `-`, where it previously rendered `class="fail"`, `X`. New tests in
3 files prove ACTUAL rendered output for skipped/fail/pass all three (not just source-text presence).

**Finding B (should-fix) fixed.** `timeoutDetail()` no longer hardcodes "NVIDIA's shared/free
endpoint" -- now takes a `providerLabel` param, threaded through `checkCompletion`/
`checkToolCalling`/`checkStreaming`/`checkSmallModel`/`checkClaudeWildcard` (which `engine-context.js`
already supplied via `opts.providerLabel` but which wasn't reaching these call sites), falling back to
fully generic wording (no provider named) when absent rather than defaulting to NVIDIA.

**Nits addressed**: reworded the self-contradictory test title; softened the unverified
"confirmed tool calling works for every recommended NIM model" comment to match what DESIGN.md/
README.md actually document (curated-shortlist intent + an "unverified" warning for non-recommended
models) -- confirmed via `git show f73371f` this comment was added by this same branch, so in-scope.

**npm test**: 542/542 (528 baseline -> +14 new tests, 0 regressions).

Files touched: `diagnostics.js`, its test file, all three renderer view files named in the finding,
`dashboard-view.test.js`, two new renderer test files, and `app.css` (one deliberate addition beyond
the original file list -- required to give the new `.skip` class actual neutral styling per the
finding's own "neutral/muted style" instruction). `engine-context.js` and `src/engine/providers/`
confirmed untouched (empty diff against those paths).

Review pass 2 dispatched next, into the same worktree, against `60400f7`.

## Wave-18 review pass 2 verdict — APPROVE (reviewer, Opus, in the branch's own worktree)

Reviewed `f73371f`+`3f49918`+`c11f586`+`60400f7`. All 3 ACs re-confirmed fresh against the post-fix
state (not carried forward from pass 1).

**Finding A CLOSED**: independently rendered the real extracted templates from BOTH `dev` and `HEAD`
against a constructed `status:'skipped'` result -- confirmed the row genuinely changes from
`class="fail"`/`X` to `class="skip"`/`-` in all three consumers. Not cosmetic: `.skip` uses
`var(--muted)` (grey, #6b6b70 light / #9a9a9e dark) vs `.fail`'s `var(--danger)` (red #e74c3c, not
redefined in dark) -- visually distinct in both themes. Confirmed the `--muted` precedent is real
(`.status-pill.status-not-installed`/`.status-unknown` already use it identically). Swept every
`status ===` consumer in `src/` -- no remaining two-state assumption anywhere.

**Finding B CLOSED**: all 4 real `timeoutDetail(` call sites pass `providerLabel`; generic fallback
verified by direct execution to contain no vendor name at all. Nuance recorded: `providerLabel` was
already present in `engine-context.js` from the ORIGINAL implementation commit (`3f49918`), not
something fix pass 1 also had to add there -- "already supplied, just not threaded through
internally" is accurate as claimed.

Both nits confirmed genuinely fixed (test title no longer self-contradicts; the NIM comment now cites
real, verified DESIGN.md/README.md text instead of an invented verification record).

### New findings from this pass, all non-blocking

- **[Medium, premise correction, NOT a code defect]**: pass 1's own rationale for treating Finding A as
  urgent was factually wrong -- CCA-14.3's Custom/Local provider (now merged) actually declares
  `supportsModelListing: TRUE`, not false. **No provider in the repo currently declares false**; the
  `skipped` path is unreachable in production today (only exercised by tests), since `activeProvider`
  is still hard-pinned to `'nvidia-nim'` (CCA-15's job to change). The FIX itself is still correct and
  structurally required by AC#2 regardless -- **just don't carry forward the "CCA-14.3 is the first
  real trigger" claim into the campaign record**, it's the one thing about this branch that turned out
  false.
- **[Low]**: a comment says "a future provider's `'unverified'` gets the same non-critical treatment"
  -- CCA-14.3's `customLocal` provider already declares `'unverified'` TODAY (merged same wave). Stale
  the moment both branches land together; the code path itself is correct.
- **[Low]**: branch needs a rebase (dev moved 6 commits since `52a7f7e`, including CCA-14.3) --
  `git merge-tree` confirms ZERO file overlap, trivial fast rebase, no conflict risk expected.
- Two cosmetic nits (a skipped row's criticality column still reads "warn-only"; a pre-existing,
  out-of-scope `setup-view.js` warning styled red that a dedicated warn class would suit better) --
  neither blocking, left as-is.

npm test (reviewer's own run): 542/542.
<!-- SECTION:NOTES:END -->
