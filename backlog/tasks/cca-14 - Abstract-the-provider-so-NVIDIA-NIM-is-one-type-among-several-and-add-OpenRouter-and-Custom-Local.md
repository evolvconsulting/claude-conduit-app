---
id: CCA-14
title: >-
  Abstract the provider so NVIDIA NIM is one type among several, and add
  OpenRouter and Custom/Local
status: Done
assignee:
  - '@claude'
created_date: '2026-07-31 21:51'
updated_date: '2026-08-18 16:02'
labels: []
dependencies: []
priority: high
type: feature
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The app is built around NVIDIA NIM as the only possible upstream. NIM should become one provider type behind an abstraction, with OpenRouter and a Custom/Local option (any OpenAI-compatible base URL, covering Ollama, vLLM, LM Studio and self-hosted gateways) alongside it.

This is a deep change, not a dropdown. NVIDIA specifics are currently spread across the engine: key validation hits NVIDIA endpoints, the model catalog is fetched from an NVIDIA account, the generated LiteLLM config uses NIM model naming and base URL, diagnostics probe NVIDIA behaviour, and the prerequisite and manifest shapes assume a single NVIDIA configuration. Each needs a provider-shaped seam: validate a credential, list models, emit LiteLLM config, and declare capabilities.

Providers differ in ways the abstraction has to survive rather than paper over: OpenRouter exposes a large catalog with per-model pricing and its own routing semantics; a Custom/Local endpoint may have no key, no catalog listing endpoint, and no reliable tool-calling support, so model IDs may have to be typed by hand and capabilities probed instead of assumed. Diagnostics should report what a given provider actually supports rather than failing checks that were only ever meaningful for NIM.

Expect this to want splitting into subtasks when it is picked up. It also interacts with CCA-8 (model alias rename), CCA-12 (rebrand, which drops the NVIDIA-specific product framing) and CCA-15, which builds multiple saved connections on top of this abstraction.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A provider interface exists covering credential validation, model listing, LiteLLM config generation and capability declaration
- [x] #2 NVIDIA NIM is reimplemented as one provider against that interface with no behaviour regression
- [x] #3 OpenRouter is supported end to end: key validation, model listing, config generation, and a real completion through the running proxy
- [x] #4 Custom/Local is supported end to end against an OpenAI-compatible base URL, including the no-API-key case
- [x] #5 Providers with no listable catalog allow model IDs to be entered manually, with validation feedback
- [x] #6 Diagnostics report per-provider capabilities instead of failing checks that only ever applied to NIM
- [ ] #7 No NVIDIA-specific string, URL or assumption remains outside the NVIDIA provider implementation
- [x] #8 The manifest format carries the provider type, and an existing NVIDIA-only install still works after upgrading
- [x] #9 Secret storage handles multiple credentials, including providers that need none
- [x] #10 Verified end to end against at least one real non-NVIDIA provider with a live completion, not mocks
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Finalization-only session (no implementation): verified all 10 parent ACs against the 5 already-Done subtasks' recorded evidence plus a live grep of the current source tree.

AC#1/#2: CCA-14.1 defines the Provider contract (providers/registry.js) and reimplements NVIDIA NIM against it; verified live against the real NVIDIA API with byte-identical generated config, 503/503 tests.
AC#3: CCA-14.2 — OpenRouter end to end, verified with a real key: real validateCredential, a real spawned litellm process, and a real completion (HTTP 200, real model response) through it. This also independently satisfies AC#10 (live completion against a real non-NVIDIA provider, not mocks).
AC#4/#5: CCA-14.3 — Custom/Local, verified with real http.createServer sockets confirming no auth header sent when keyless, distinct error paths for no-key/bad-key/good-key, and validateManualModelId tested against 25 model-ID shapes including shell-injection-shaped strings.
AC#6: CCA-14.4 — diagnostics keyed off declareCapabilities(); 2 review passes, 1 fix cycle (UI 'skipped' state fix across 3 renderer views); 562/562 tests.
AC#8/#9: CCA-14.5 — manifest.provider field + resolveManifestProviderId(); secretStore saveFor/loadFor/clearFor(providerId); AC#3-equivalent (upgrade migration) proven non-vacuously with a real pre-CCA-14.5 fixture run through createEngineContext(); 581/581 tests.

AC#7 left UNCHECKED — genuine gap, not paperwork. Live grep of current source (not subtask notes) confirms real NVIDIA-specific leakage outside providers/nvidia.js:
- src/main/engine-context.js:33 hard-pins `activeProvider = providers.getProvider('nvidia-nim')` as a module-level constant — no way to select another provider at runtime.
- src/renderer/views/setup-view.js's entire setup wizard step 2 is NVIDIA-only text and a hardcoded build.nvidia.com link — no UI path exists for a user to configure OpenRouter or Custom/Local.
- src/main/ipc.js:773 has a second hardcoded https://build.nvidia.com.
- configGen.js/secretStore.js retain 'NVIDIA_NIM_API_KEY' as a *default parameter value* (backward-compat only, never reached once a provider is recorded in the manifest per AC#8/#9's migration) — lower-severity than the above three, noted for completeness.

This is exactly the gap CCA-14.1's own AC#4 flagged and left open pending CCA-14.5, and CCA-14's own description names CCA-15 ('builds multiple saved connections on top of this abstraction') as the ticket that unpins activeProvider and builds the provider-choice UI. Per backlog task-finalization guidance ('do not create or start follow-up tasks without user approval'), asked the user how to close this out. User decided: close CCA-14 as Done with AC#7 as a documented, deliberate exception — the backend abstraction (providers 1-6/8-10) is real and independently verified; wiring it into the UI/engine-context selection is CCA-15's explicit scope, and CCA-15 is already next-in-queue depending on CCA-14.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Finalization-only: all 5 subtasks (CCA-14.1-14.5) were already Done, delivering a real Provider abstraction (interface + NVIDIA/OpenRouter/Custom-Local implementations), capability-driven diagnostics, and manifest/secret multi-credential storage with a non-vacuously-proven upgrade migration. Verified 9 of 10 parent ACs directly against each subtask's recorded live evidence (real NVIDIA API calls, a real OpenRouter completion through a spawned litellm process, real-socket Custom/Local auth tests, a real pre-upgrade migration fixture) — no box checked on inference alone.

AC#7 ('no NVIDIA-specific string/URL/assumption remains outside the NVIDIA provider implementation') left unchecked: a live grep of the current tree found genuine remaining NVIDIA-pinning outside providers/nvidia.js — engine-context.js's activeProvider constant, setup-view.js's NVIDIA-only wizard UI, and a hardcoded build.nvidia.com URL in ipc.js. This is a real, scoped gap, not an oversight: CCA-14.1's own AC#4 flagged it and deferred it, and CCA-14's own description names CCA-15 as the ticket that wires the abstraction into an actual provider-choice UI. Per task-finalization rules (no unilateral follow-up work), asked the user; decided to close CCA-14 as Done with AC#7 documented as a deliberate exception, since CCA-15 (next in the campaign queue, already dependent on CCA-14) is where that wiring belongs.
<!-- SECTION:FINAL_SUMMARY:END -->
