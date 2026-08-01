---
id: NCOW-16
title: Diagnostics completion checks time out against slow NIM models
status: In Progress
assignee: []
created_date: '2026-07-31 22:29'
updated_date: '2026-08-01 00:14'
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
