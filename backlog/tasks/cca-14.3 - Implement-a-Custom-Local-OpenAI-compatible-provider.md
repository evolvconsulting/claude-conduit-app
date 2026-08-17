---
id: CCA-14.3
title: Implement a Custom/Local (OpenAI-compatible) provider
status: In Progress
assignee: []
created_date: '2026-08-16 14:45'
updated_date: '2026-08-17 03:40'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design note from reviewing deepseek-ai/deepseek-harness's llm-pi-ai package (prior art for multi-provider LLM adapters): bound the model-listing response size for this provider's user-typed base URL before parsing JSON (check Content-Length up front, then cap the accumulated bytes while reading the stream) -- unlike NVIDIA's trusted first-party endpoint, a Custom/Local base URL is user-typed and untrusted.
<!-- SECTION:NOTES:END -->
