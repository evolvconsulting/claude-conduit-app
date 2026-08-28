---
id: CCA-15.3
title: Active-connection switch mechanism
status: To Do
assignee: []
created_date: '2026-08-28 15:01'
labels: []
dependencies:
  - CCA-15.1
  - CCA-15.2
parent_task_id: CCA-15
type: feature
ordinal: 90000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement switching the active connection: regenerate litellm.env/config.yaml from the newly-active connection and restart the proxy, with visible progress and a clear result. Per the approved decisions (2026-08-28): Claude Code's settings.json and Claude Desktop's config entry (port, master key) stay fixed across every switch - only the upstream credential/model routing changes - so clients never need reconfiguring; an in-flight request on the connection being deactivated is allowed to finish before the proxy restarts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Exactly one connection is active at a time and which one is unambiguous throughout the UI
- [ ] #2 Switching regenerates the LiteLLM config from the newly-active connection and restarts the proxy, with visible progress and a clear success or failure result
- [ ] #3 Claude Code's settings.json and Claude Desktop's config entry (port, master key) are unchanged by a switch - documented as the approved decision, with reasoning
- [ ] #4 An in-flight request against the connection being deactivated is allowed to finish before the proxy restarts - documented as the approved decision, with reasoning
- [ ] #5 A documented decision records the single-proxy-vs-multi-proxy reasoning, derived from this task's own AC#1/#2 (exactly one active connection, restarts 'the' proxy)
- [ ] #6 Every connection credential stays in OS-backed secret storage through a switch, never written into the config directory
<!-- AC:END -->
