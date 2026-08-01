---
id: NCOW-16
title: Diagnostics completion checks time out against slow NIM models
status: In Progress
assignee: []
created_date: '2026-07-31 22:29'
updated_date: '2026-08-01 01:05'
labels: []
dependencies: []
priority: high
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
diagnostics.js's postMessages() hardcodes a 30-second AbortController timeout for every proxy request. Discovered while live-verifying NCOW-8: meta/llama-3.3-70b-instruct genuinely takes ~54s for even a trivial 64-token completion on this NVIDIA account (confirmed via direct curl and via a live runDiagnostics() run), so checks 4 (Completion), 5 (Tool calling), 6 (Streaming) and 8 (claude-* wildcard) — every check that exercises the primary model — abort at exactly 30000-30005ms and report false failures, even though the proxy and model are working correctly and the same request succeeds when given enough time. checkSmallModel and checkLiveCliSmoke (no 30s cap) are unaffected. This is pre-existing and unrelated to any specific model alias; it will reproduce for any NIM model whose real upstream latency exceeds 30s on a given account.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 postMessages' timeout is no longer a single hardcoded 30s for every check — either raised to accommodate known-slow NIM models, made configurable per call, or otherwise reworked so a slow-but-working model does not read as a diagnostics failure
- [ ] #2 Re-running diagnostics against meta/llama-3.3-70b-instruct on the real account (or an equivalently slow model) shows checks 4, 5, 6 and 8 passing rather than aborting
- [ ] #3 checkStreaming's own read-loop timing (50 chunks) is reviewed for the same slow-model assumption while touching this area
- [ ] #4 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Split postMessages' single hardcoded 30s timeout into DEFAULT_TIMEOUT_MS (30s,
   unchanged, for checks like auth-enforced that never reach a model) and a
   per-call-configurable MODEL_COMPLETION_TIMEOUT_MS for checks that exercise a
   real completion (checkCompletion, checkToolCalling, checkStreaming; checks 7/8
   inherit it via checkCompletion). Also fix AC#3: checkStreaming's read loop
   capped at a fixed 50 reads regardless of elapsed time -- reworked to an
   elapsed-time bound tied to the same timeoutMs, removing a second, uncoordinated
   slow-model assumption.
2. Live-verified against the real NVIDIA account. Simply raising the constant did
   not converge: 90s, 180s, and 300s were each tried live and still timed out
   against genuine NVIDIA-side queueing on their shared/free trial endpoint
   (confirmed via a raw curl straight to NVIDIA, bypassing this app and litellm
   entirely -- 186.6s wall time, with the response body's own
   nvext.scheduler_snapshot reporting real queue depth: num_running_reqs 16,
   num_waiting_reqs 11).
3. Given that evidence, the user made an explicit product-level call: a model
   that takes minutes to respond is not "slow but fine" for an interactive
   coding-assistant proxy -- diagnostics should say so accurately rather than
   hide it behind an ever-bigger timeout. Re-scoped the fix accordingly:
   MODEL_COMPLETION_TIMEOUT_MS settled at an interactive-reasonable 60s. On a
   timeout, checks 4/5/6/8 now report an accurate, actionable message via a new
   timeoutDetail() helper ("Timed out after 60s -- <model> is responding too
   slowly for interactive use right now (this can happen on NVIDIA's
   shared/free endpoint under load). Try again later or pick a different
   model.") instead of the old opaque "This operation was aborted". Non-timeout
   errors (real network failures) still surface their own message unchanged --
   catch blocks discriminate on err.name === 'AbortError'. checkStreaming
   additionally distinguishes a clean stream end with no message_start (a real
   protocol/proxy issue, keeps its original specific message) from its
   elapsed-time budget expiring while still connected (gets the same accurate
   slow-model message).
4. AC#2 is correspondingly re-scoped from "checks 4/5/6/8 must show a green pass
   against meta/llama-3.3-70b-instruct" (not reliably achievable given real,
   external NVIDIA-side congestion at any given moment) to "re-running
   diagnostics against a genuinely slow-but-working model produces an accurate
   'too slow' diagnosis instead of a generic/confusing failure that looks like
   the proxy is broken."
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented on branch fix/NCOW-16-diagnostics-timeout (pushed to origin), commit
9a73f76d4c7aef197bb9f4089efa13ce5bde271e "fix(engine): stop diagnostics from
misreporting slow models as broken". Files touched: src/engine/diagnostics.js,
test/engine/diagnostics.test.js only.

npm test: 150 tests, 149 pass. The 1 failure ("licenses: the generated list
covers the whole production tree") is unrelated to this task -- reproducible
only under a genuinely fresh `npm install` against the current lockfile (not on
the orchestrator's own checkout, whose node_modules happens to be stale enough
to mask it), independently confirmed by the orchestrator. Flagged separately as
a candidate follow-up task, not fixed here.

Live AC#2 verification (real NVIDIA account, real litellm-nim proxy via pm2,
driven directly through the engine modules under a fake NIM_PROXY_TEST_HOME):
against meta/llama-3.3-70b-instruct (the known-congested slow model) -- check 8
(claude-* wildcard) PASS at 43.4s; check 4 (Completion) TIMED OUT at 60001ms
with the accurate "too slow for interactive use" message; check 5 (Tool
calling) TIMED OUT at 60001ms with the same accurate message; check 6
(Streaming) PASS at 54.1s. Against meta/llama-3.1-8b-instruct (fast model),
same three checks (4/5/6) all PASS cleanly and fast (264ms/398ms/788ms),
confirming the normal-speed path is unaffected.

The two TIMED OUT results above are the intended, correct outcome of the
re-scoped fix (see recorded plan), not an unresolved bug or a partially-met AC
-- the mix of legitimate passes and legitimate accurately-labeled timeouts,
plus a clean fast-model control, is exactly the target behavior and reflects
genuine, uncherry-picked live conditions on NVIDIA's shared/free endpoint.

AC status: #1 done (configurable timeout, no longer a single hardcoded 30s).
#2 done under the re-scoped interpretation above. #3 done (checkStreaming's
50-chunk cap replaced with the same elapsed-time budget). #4 done (npm test
passes modulo the pre-existing, unrelated licenses failure noted above).
<!-- SECTION:NOTES:END -->
