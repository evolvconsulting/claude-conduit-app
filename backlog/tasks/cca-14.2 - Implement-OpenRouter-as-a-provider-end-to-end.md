---
id: CCA-14.2
title: Implement OpenRouter as a provider end to end
status: Done
assignee:
  - '@claude'
created_date: '2026-08-16 14:45'
updated_date: '2026-08-16 22:40'
labels: []
dependencies:
  - CCA-14.1
parent_task_id: CCA-14
priority: high
type: feature
ordinal: 78000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement OpenRouter as a second provider against the CCA-14.1 interface: credential validation, model listing (with tool-calling/context/pricing metadata where OpenRouter's catalog exposes it), LiteLLM config generation, and capability declaration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 OpenRouter credential validation succeeds against a real key and fails clearly against an invalid one
- [x] #2 OpenRouter model listing returns the catalog including tool-calling and context-window metadata
- [x] #3 LiteLLM config generation for an OpenRouter provider produces a working config
- [x] #4 A real completion succeeds end to end through the running proxy configured for OpenRouter
- [x] #5 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Research (live-verified against the real OpenRouter API, plus context7 docs /websites/openrouter_ai):
- GET https://openrouter.ai/api/v1/models is public/unauthenticated (HTTP 200, 413 models, no key needed) -- same shape as NVIDIA: cannot be used to validate a key.
- POST /chat/completions DOES enforce auth: a garbage or missing key returns HTTP 401 {"error":{"message":"User not found."|"No cookie auth credentials found","code":401}}. Docs also document 403 (permissions) and 402 (insufficient credits) as distinct auth-adjacent failure modes.
- Each /models entry carries context_length, pricing.{prompt,completion} (string decimal $/token), and supported_parameters (array) -- "tools" present in that array is OpenRouter's own documented way to identify tool-calling-capable models (confirmed via context7: `?supported_parameters=tools` query filter is a first-class documented feature).

Design decision (additive, does not touch CCA-14.1's closed code): the Provider contract's listModels() data gains an OPTIONAL `modelInfo` field -- Record<modelId, {contextWindow?, supportsToolCalling?, pricingPromptPerMTok?, pricingCompletionPerMTok?}> -- alongside the existing `models: string[]`. NVIDIA's adapter is untouched (no modelInfo key at all, exactly today's behavior); OpenRouter's populates it. declareCapabilities()'s supportsToolCalling enum widens (JSDoc only) to add 'varies-by-model' for providers like OpenRouter where it's genuinely per-model, not provider-wide.

1. Add src/engine/providers/openrouter.js: id 'openrouter', label 'OpenRouter', litellmProvider 'openrouter', apiKeyEnvVar 'OPENROUTER_API_KEY', defaultBaseUrl 'https://openrouter.ai/api/v1'.
2. validateCredential: fetch /models (always "succeeds"), then a real max_tokens:1 completion probe against the cheapest available model in the live catalog (minimizes real spend) -- 401/403 -> UNAUTHORIZED ("OpenRouter rejected the key."), 402 -> INSUFFICIENT_CREDITS ("OpenRouter accepted the key, but the account has no credits."), network/timeout errors mirror nvidiaKey.js's networkError() shape.
3. listModels: maps /models into {models: string[] ids, modelInfo: {...}} as described above.
4. maskCredential: small local helper matching nvidiaKey.maskKey's exact prefix6…last4 shape (not extracted into a shared util -- 4 lines of duplication across 2 files doesn't earn an abstraction yet).
5. recommendedModels: returns {primary: [], small: []} -- OpenRouter has no NVIDIA-style curated recommendation list yet, and inventing one would be an uncommunicated product decision. Documented as a known gap, not a bug.
6. Register openrouterProvider in registry.js's PROVIDERS map; widen the declareCapabilities JSDoc enum.
7. Tests: test/engine/providers/openrouter.test.js mirroring nvidia.test.js's structure (mocked fetch throughout); update registry.test.js's listProviderIds assertion to include 'openrouter'.
8. engine-context.js is NOT touched -- it still hardcodes the NVIDIA provider (CCA-15 makes this dynamic per active connection). AC#4's "real completion through the running proxy" is verified via a standalone script (configGen.generateAll + a real pm2/litellm run), same pattern as CCA-14.1's live check, NOT through the app's UI/IPC (which isn't wired for a second provider yet).

Open item before implementing further: AC#4 needs a real OpenRouter API key to prove an actual completion. Asking the user whether one is available.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented src/engine/providers/openrouter.js (validateCredential, listModels with the additive modelInfo map, maskCredential, declareCapabilities, recommendedModels) and registered it in registry.js. Widened the Provider contract's JSDoc additively (modelInfo optional field, supportsToolCalling gains 'varies-by-model') -- NVIDIA's adapter/tests untouched.

Verification so far:
- npm test: 515/515 passing (12 new tests: openrouter.test.js + 2 registry.test.js updates).
- LIVE against the real OpenRouter API (no key needed for these): listModels() returned all 413 real models with correct context/pricing/tool-calling parsing (346 report tool-calling support via supported_parameters.includes('tools'), confirmed as OpenRouter's own documented signal via context7); validateCredential() with a garbage key correctly returned UNAUTHORIZED via a real network call (safe -- OpenRouter's 401 short-circuits before any billed inference).
- Verified against context7 (/websites/litellm_ai, LiteLLM's own docs): litellm's OpenRouter integration expects exactly model: "openrouter/<model-id>" and env var OPENROUTER_API_KEY -- matching this implementation's litellmProvider/apiKeyEnvVar exactly. Confirmed generated config.yaml/litellm.env content directly.

Still pending: AC#4 (a real completion through a running proxy) needs the OpenRouter key you offered to provide.

AC#4 LIVE end-to-end verification (real OpenRouter key, provided via .env by the user):
- validateCredential({apiKey}) against the REAL key: ok:true, 414 live models, correctly masked key.
- Generated a real OpenRouter-wired config via configGen.generateAll (litellmProvider: 'openrouter', apiKeyEnvVar: 'OPENROUTER_API_KEY') and spawned a REAL litellm process directly (bypassing pm2 entirely -- a throwaway child process, no shared daemon involved, so none of the pm2-daemon constraints in CLAUDE.md apply).
- A REAL completion succeeded end to end: POST /v1/messages (Anthropic format, exact request shape diagnostics.js's postMessages/buildRequestA use) -> HTTP 200 -> real OpenRouter model response ("OK", usage {input_tokens:15, output_tokens:2}), litellm correctly routing openrouter/meta-llama/llama-3.1-8b-instruct via the generated config. This directly satisfies AC#4.
- (Bonus, not required by any AC) attempted a real tool-calling completion against qwen/qwen3-coder-480b-a35b-instruct -- that specific model ID is stale/incorrect on OpenRouter's current catalog ("not a valid model ID"), a test-script issue, not a provider bug; not investigated further since AC#4 only requires "a real completion," already proven above.
- Cleaned up: killed the spawned litellm process, confirmed port 4999 free, removed the throwaway config dir and verification script (nothing committed).

Final npm test run: still 515/515 (no source changes since the last npm test run recorded above).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented src/engine/providers/openrouter.js against the CCA-14.1 Provider contract: validateCredential (fetch-catalog-then-probe-completion pattern, same shape as NVIDIA's, since OpenRouter's /models is likewise public/unauthenticated), listModels (with an additive modelInfo map -- context window, tool-calling support, per-million pricing -- sourced from OpenRouter's own documented supported_parameters/context_length/pricing fields), maskCredential, declareCapabilities ('varies-by-model' for tool calling, since it's genuinely per-model unlike NVIDIA), and recommendedModels (documented empty default -- no curated list exists yet). Registered in registry.js; the Provider contract's JSDoc widened additively (NVIDIA's code/tests untouched). Verified via npm test (515/515, 12 new tests), context7 (LiteLLM's own docs confirm the openrouter/<model> + OPENROUTER_API_KEY wiring), and a full LIVE end-to-end run using a real OpenRouter key provided by the user: real credential validation, a real spawned litellm process, and a real completion succeeding through it end to end (HTTP 200, real model response, correct usage accounting) -- satisfying AC#4 directly.
<!-- SECTION:FINAL_SUMMARY:END -->
