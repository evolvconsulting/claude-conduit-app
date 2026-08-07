---
id: CCA-14
title: >-
  Abstract the provider so NVIDIA NIM is one type among several, and add
  OpenRouter and Custom/Local
status: To Do
assignee: []
created_date: '2026-07-31 21:51'
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
- [ ] #1 A provider interface exists covering credential validation, model listing, LiteLLM config generation and capability declaration
- [ ] #2 NVIDIA NIM is reimplemented as one provider against that interface with no behaviour regression
- [ ] #3 OpenRouter is supported end to end: key validation, model listing, config generation, and a real completion through the running proxy
- [ ] #4 Custom/Local is supported end to end against an OpenAI-compatible base URL, including the no-API-key case
- [ ] #5 Providers with no listable catalog allow model IDs to be entered manually, with validation feedback
- [ ] #6 Diagnostics report per-provider capabilities instead of failing checks that only ever applied to NIM
- [ ] #7 No NVIDIA-specific string, URL or assumption remains outside the NVIDIA provider implementation
- [ ] #8 The manifest format carries the provider type, and an existing NVIDIA-only install still works after upgrading
- [ ] #9 Secret storage handles multiple credentials, including providers that need none
- [ ] #10 Verified end to end against at least one real non-NVIDIA provider with a live completion, not mocks
<!-- AC:END -->
