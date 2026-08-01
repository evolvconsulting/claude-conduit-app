---
id: NCOW-16
title: Diagnostics completion checks time out against slow NIM models
status: In Progress
assignee: []
created_date: '2026-07-31 22:29'
updated_date: '2026-08-01 01:04'
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
