---
id: CCA-14.3
title: Implement a Custom/Local (OpenAI-compatible) provider
status: In Progress
assignee: []
created_date: '2026-08-16 14:45'
updated_date: '2026-08-17 03:52'
labels: []
dependencies:
  - CCA-14.1
parent_task_id: CCA-14
priority: high
type: feature
ordinal: 79000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement a Custom/Local provider type for any OpenAI-compatible base URL (covers Ollama, vLLM, LM Studio, self-hosted gateways), including the no-API-key case. These endpoints may have no listable model catalog, so allow model IDs to be entered manually with validation feedback.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Custom/Local provider works end to end against an OpenAI-compatible base URL, including with no API key
- [ ] #2 Model IDs can be entered manually when no catalog-listing endpoint is available, with validation feedback
- [ ] #3 Capability declaration reflects that tool-calling support may be unverified for this provider type
- [ ] #4 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read registry.js's Provider typedef, nvidia.js, openrouter.js, nvidiaKey.js, modelCatalog.js, and
   engine-context.js in full to understand the seam and HTTP/timeout conventions.
2. Verify litellm's real documented convention for custom OpenAI-compatible endpoints (via context7,
   not memory): model: openai/<name> + api_base -- confirms litellmProvider: 'openai'.
3. Implement src/engine/providers/customLocal.js against the full Provider interface, plus one extra
   export (validateManualModelId) to fill a real interface gap (no method exists for validating a
   manually-typed model ID at all).
4. Apply the untrusted-endpoint response-size bound (Content-Length pre-check + streamed-byte cap)
   to listModels, since a Custom/Local base URL is user-typed and untrusted unlike NVIDIA's.
5. Register in registry.js's PROVIDERS map (the one authorized line + import).
6. Write test/engine/providers/customLocal.test.js; update registry.test.js's now-stale
   two-provider-array assertion (unavoidable direct consequence of the one authorized registry.js
   change).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design note from reviewing deepseek-ai/deepseek-harness's llm-pi-ai package (prior art for multi-provider LLM adapters): bound the model-listing response size for this provider's user-typed base URL before parsing JSON (check Content-Length up front, then cap the accumulated bytes while reading the stream) -- unlike NVIDIA's trusted first-party endpoint, a Custom/Local base URL is user-typed and untrusted.

## Wave-18 implementation evidence (worker, branch `feat/CCA-14.3-custom-local-provider`,
commits `27176e2` + `b79da62`, branched from `52a7f7e`)

Recorded by the orchestrator from the worker's structured return. NOT yet independently reviewed.

**Design decisions, each documented in the module itself:**
- `apiKeyEnvVar: 'CUSTOM_LOCAL_API_KEY'`, not `null` -- the typedef's "null if no credential is
  needed" describes a provider that structurally NEVER has a credential; this provider's credential
  is OPTIONAL, not absent (some self-hosted gateways behind this shape do enforce a bearer token).
  Optionality is expressed by every function tolerating an absent `apiKey` instead.
- `defaultBaseUrl: ''`, not `null` -- no target (Ollama/vLLM/LM Studio/self-hosted) has a sensible
  universal default. Flagged as a minor interface gap: the typedef still types this field as plain
  `string`, not `string|null` (out of this task's authorized scope to change).
- `declareCapabilities()`: `requiresApiKey: false`, `supportsModelListing: true`,
  `supportsToolCalling: 'unverified'` (AC#3, unconditional) -- both of the first two are genuinely
  "depends on the target server" answers forced into the typedef's strict boolean shape; documented
  as a real interface-shape limitation with the reasoning for which value is least misleading.
- `recommendedModels()` always `{primary:[], small:[]}` -- no universal "good model" exists for an
  arbitrary target (same documented gap as openrouter.js's own precedent). Also noted the interface's
  signature has no parameter for manually-typed IDs, so it structurally cannot help AC#2 even in
  principle.
- AC#2 "validation feedback": the Provider typedef has NO method for validating a manually-typed
  model ID at all -- a real interface gap. Filled via a plain extra export, `validateManualModelId(id)`
  (real format validation: empty/whitespace/character-set), mirroring `modelCatalog.js`'s
  `validateExplicitModelChoice` pattern relative to nvidia.js.
- Security bound (untrusted user-typed base URL): `readBoundedBody()` checks `Content-Length` before
  reading any bytes, and separately caps bytes accumulated while streaming (verified Node's
  `Response` never synthesizes a `content-length` header for a `ReadableStream` body, so the
  streamed-cap path is real, not theoretical, since a malicious server could omit/lie about the
  header). Two dedicated tests: an honestly-large declared Content-Length (rejected pre-parse) and a
  3MB streamed body with no Content-Length header at all (rejected mid-stream, cap = 2MB).

**AC#1** (no-key end-to-end): `validateCredential({baseUrl})` with no `apiKey` succeeds, sends no
`Authorization` header, `maskedKey: '(no key configured)'`; also verified the reverse (a
key-requiring target gives a distinct "requires an API key" message vs. a supplied-but-bad key
giving "rejected the provided key").

**AC#2** (manual entry): `listModels` tolerates 404 (`HTTP_ERROR`) and non-JSON bodies
(`INVALID_RESPONSE`) as ordinary `{ok:false}`, never throwing; `validateManualModelId` gives concrete
`EMPTY_MODEL_ID`/`WHITESPACE`/`INVALID_CHARACTERS` feedback and accepts real-world shapes
(`llama3.1:8b`, `TheBloke/Mixtral-8x7B-...`).

**AC#3**: `declareCapabilities().supportsToolCalling === 'unverified'` asserted directly,
unconditionally.

**npm test**: baseline (via `git stash`) **522/522**, matching the confirmed dev baseline exactly.
Post-change: **542/542** (+20 tests, 0 regressions). A transient Electron-install flake on the very
first pre-change run (516, 2 failing in unrelated files) was confirmed a one-off via the stash-based
re-check, not a real baseline discrepancy.

Files touched: `src/engine/providers/customLocal.js` (new), `src/engine/providers/registry.js`
(import + one `PROVIDERS` map line only -- the one authorized change), `test/engine/providers/
customLocal.test.js` (new), `test/engine/providers/registry.test.js` (updated the now-stale
two-provider-array assertion + one new `getProvider` test -- an unavoidable direct consequence of
the one authorized registry.js line, not a scope violation; did not touch nvidia.js, openrouter.js,
diagnostics.js, or any renderer/UI code). No `secretStore.js` blocker hit: `customLocal.js` never
calls `secretStore` at all (that only happens in `engine-context.js`, untouched); the optional-key
case is fully modeled inside the provider module itself.
<!-- SECTION:NOTES:END -->
