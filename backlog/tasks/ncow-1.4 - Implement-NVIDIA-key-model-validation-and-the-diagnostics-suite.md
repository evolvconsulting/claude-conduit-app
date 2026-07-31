---
id: NCOW-1.4
title: Implement NVIDIA key + model validation and the diagnostics suite
status: Done
assignee:
  - '@claude'
created_date: '2026-07-31 15:26'
updated_date: '2026-07-31 15:56'
labels: []
dependencies:
  - NCOW-1.3
parent_task_id: NCOW-1
type: task
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement nvidiaKey.js (GET {nim_base}/models key validation per DESIGN.md §4 Step 2: 401/403 handling, network-error host naming) and diagnostics.js: the full 10-check suite from §11 (proxy alive, auth enforced, NIM reachable with 401-on-key-invalid distinguished from empty-catalog-warn, Anthropic-format completion via Request A, tool-calling via Request A+get_weather tool as 'the single most valuable check' including the exact required verdict text when check 5 fails but check 4 passes, streaming via message_start detection, small-model completion, claude-* wildcard, Claude Code settings.json coherence as warn-only, and a warn-only live 'claude -p' smoke test), PLUS a focused runQuickValidation({apiKey, primaryModel, smallModel}) that runs the equivalent of checks 3+4 (and optionally 5) scoped to just the currently selected key/models, callable independently of the full suite — used both automatically right after model selection in the setup wizard and as a standalone re-runnable 'Test Connection' action later.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 nvidiaKey.js validation correctly distinguishes 401/403 (bad key) from network failure (names the failing host)
- [x] #2 All 10 diagnostics checks from §11 are implemented and produce the documented pass/fail criteria, including the exact tool-calling failure verdict text
- [x] #3 runQuickValidation gives a clear pass/fail for a specific key+model pair in well under the time the full 10-check suite takes, and is callable standalone
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Investigate the HTTP 500 vs 401 discrepancy from NCOW-1.3 by starting a real proxy and sending DESIGN.md section 11 Request A shaped correctly, with and without auth, to determine actual litellm behavior.
2. nvidiaKey.js: validateApiKey({apiKey, nimBaseUrl}) per DESIGN.md section 4 Step 2 (GET {nim_base}/models, 10s timeout, 401/403 vs network-error distinction).
3. diagnostics.js: implement all 10 checks from section 11 against a running proxy + real/placeholder NIM key, using the exact Request A/B shapes; the tool-calling check five verdict text exactly as specified when check 5 fails but 4 passes.
4. runQuickValidation({apiKey, primaryModel, smallModel}): the focused subset (checks 3+4, optionally 5) exposed independently, callable from setup and later as a standalone re-runnable Test Connection action.
5. Unit tests for pure logic (request-shape builders, verdict-text formatting) with node:test; integration verification against the real proxy from NCOW-1.3 for the checks that need a live server (using a real NVIDIA key from the user if available, otherwise verifying the checks correctly detect an invalid-key failure state end-to-end).
6. Verify: node --test passes; a live run against the real pm2-managed proxy shows correct pass/fail behavior for at least checks 1, 2, 6, 8 (which do not require a genuinely valid NVIDIA key to verify their logic).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented nvidiaKey.js and diagnostics.js, with two significant real-world deviations from DESIGN.md discovered and confirmed via live testing (not assumed):

1) DESIGN.md section 11 check 2 (auth enforced) expects a clean 401/403 for an unauthenticated /v1/messages request. Confirmed against litellm 1.94.1 own source (proxy/auth/user_api_key_auth.py): master-key comparison only short-circuits DB access when the key MATCHES; any non-match without a configured DATABASE_URL (which this app deliberately never provisions — unwanted complexity for a local proxy) raises "No connected db.", surfacing as HTTP 500 (missing key) or HTTP 400 (wrong key) rather than 401/403. checkAuthEnforced() was implemented against the real, verified invariant instead: any non-2xx response proves the key was never forwarded to a model, which is what the check actually needs to prove.

2) BIGGER FINDING: DESIGN.md section 4 Step 2 validates the NVIDIA key via GET {nim_base}/models expecting 401/403 for a bad key. Confirmed live against https://integrate.api.nvidia.com/v1/models with curl: it returns HTTP 200 with the full ~102-model catalog with NO Authorization header at all, and also with a garbage bearer token — it is a fully public, unauthenticated endpoint. A /models-based check can never detect an invalid key. Also confirmed live that POST /v1/chat/completions DOES correctly enforce auth (401 for both no-key and garbage-key). Rewrote nvidiaKey.validateApiKey() to fetch the catalog (still useful for populating the setup wizard, and unaffected — it never claimed to validate auth) then send a minimal real completion probe (max_tokens:1) against a small/cheap model to actually validate the key. This directly implements the users explicit ask for "a mechanism to check the API key / model combo is valid."

Verified with real evidence:
- 59/59 node --test cases pass (npm test), including a LIVE network test (not mocked) confirming a garbage key against the real NVIDIA API is genuinely rejected via the new probe-completion approach.
- Ran the full runDiagnostics() suite against a real pm2-managed proxy (fresh generateAll + startOrRestart, same pattern as NCOW-1.3) with a placeholder/invalid NVIDIA key: checks 1 (proxy alive) and 2 (auth enforced) correctly PASSED; checks 4/5/6/7/8 (all of which require real upstream completion) correctly FAILED with HTTP 403 detail, proving they detect a bad key/model combo rather than silently passing; check 3 correctly listed the real 102-model catalog (and its doc comment now explains why that alone does not prove key validity); check 9 correctly passed as not-configured; check 10 correctly skipped/failed gracefully depending on whether a local claude CLI was reachable. Cleanly tore down afterward (confirmed via ps, no orphaned litellm process).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented nvidiaKey.js (validateApiKey, maskKey, warnIfUnexpectedKeyFormat) and diagnostics.js (all 10 DESIGN.md section 11 checks plus a focused runQuickValidation subset).

Two real, verified deviations from DESIGN.md, found by live-testing against the actual NVIDIA API and the actual installed litellm rather than assuming its written behavior: (1) NVIDIA GET /models is genuinely a public, unauthenticated endpoint — confirmed with curl using no key and a garbage key, both HTTP 200 with the full catalog — so key validation now uses a minimal real POST /chat/completions probe instead, which IS correctly auth-enforced (confirmed 401 both ways); this directly implements the requested "check the API key / model combo is valid" mechanism. (2) litellm 1.94.1 does not return clean 401/403 for missing/wrong master-key auth without a DATABASE_URL (confirmed against its own source) — checkAuthEnforced now asserts the real, meaningful invariant (never reaches a model) instead.

Verified with 59 passing tests (including one live, unmocked network test against the real NVIDIA API) plus a full runDiagnostics() run against a real pm2-managed proxy: correctly passed proxy-alive/auth-enforced, correctly failed every check requiring genuine upstream access when given a deliberately invalid key, and cleanly tore down with no orphaned process.
<!-- SECTION:FINAL_SUMMARY:END -->
