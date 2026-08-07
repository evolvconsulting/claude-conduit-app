---
id: CCA-15
title: Manage many saved connections and choose which one is active
status: To Do
assignee: []
created_date: '2026-07-31 21:51'
labels: []
dependencies:
  - CCA-14
priority: high
type: feature
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reframe the app from configuring one proxy to managing a library of connections. A user should be able to save roughly ten named connections across different providers - several NVIDIA NIM accounts, OpenRouter, a local Ollama, a self-hosted gateway - and switch which one is active.

A connection is the whole bundle: provider type, credential, base URL, chosen primary and small models, and port. The active connection is what the LiteLLM proxy is generated from and what Claude Desktop and Claude Code route through. Switching means regenerating config and restarting the proxy, so it has to be an explicit, visible act with clear feedback, not a silent toggle.

Design decisions to settle while planning, each of which changes the build:
- One proxy serving the active connection, or several proxies on different ports at once. One is far simpler and matches how the Claude clients are configured; several would let a user A/B models without switching.
- Where connections are stored, and how credentials stay in OS-keychain-backed secret storage now that there are many.
- What happens to the client configuration on switch: Claude Code settings.json and the Claude Desktop entry point at a port and master key, so a switch must either keep those stable or rewrite them.
- Whether switching while the proxy is running is allowed mid-request, and what the user sees.

Existing single-configuration installs must migrate cleanly into this model as one connection. Expect to split this into subtasks when it is picked up.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Connections can be created, named, edited, duplicated and deleted
- [ ] #2 Multiple connections coexist across different provider types, including more than one of the same type
- [ ] #3 Exactly one connection is active at a time and which one is unambiguous throughout the UI
- [ ] #4 Switching the active connection regenerates the LiteLLM config and restarts the proxy, with visible progress and a clear success or failure result
- [ ] #5 A documented decision records the single-proxy versus multi-proxy choice and the reasoning
- [ ] #6 A documented decision records what happens to the Claude Code and Claude Desktop client configuration on switch, and it is implemented so those clients keep working without manual intervention
- [ ] #7 Every connection credential is held in OS-backed secret storage, never in the config directory
- [ ] #8 Deleting a connection cannot leave the app with a dangling active reference or an orphaned pm2 app
- [ ] #9 An existing single-configuration install migrates automatically into one named connection, with its stored key intact
- [ ] #10 Verified live with at least three connections across at least two providers, switching between them and confirming a real completion through each
<!-- AC:END -->
