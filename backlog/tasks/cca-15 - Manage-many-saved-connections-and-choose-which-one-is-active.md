---
id: CCA-15
title: Manage many saved connections and choose which one is active
status: In Progress
assignee:
  - '@claude.coder2@evolvconsulting.com'
created_date: '2026-07-31 21:51'
updated_date: '2026-08-28 15:00'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Decompose per the task's own instruction and this campaign's CCA-14 precedent, presented to and approved by the user 2026-08-28: CCA-15.1 (connection storage + migration), CCA-15.2 (connection CRUD UI), CCA-15.3 (switch mechanism), CCA-15.4 (delete safety), CCA-15.5 (live multi-provider verification, closes AC#10).
2. AC#5 (single- vs multi-proxy) decided from the task's own ACs, not asked to the user: AC#3 ("exactly one connection is active at a time") and AC#4 ("restarts the proxy", singular) already specify single-proxy as the model; a multi-proxy design would contradict both as written. Document this reasoning as AC#5's evidence when CCA-15.3 lands.
3. AC#6 (client config on switch) decided WITH the user (2026-08-28, AskUserQuestion): keep Claude Code's settings.json and Claude Desktop's config entry (port + master key) FIXED across every switch. Only litellm.env/config.yaml regenerate behind the same address; clients never need reconfiguring, satisfying "no manual intervention" directly. CCA-15.3 implements and records this.
4. Mid-switch in-flight-request behavior decided WITH the user (2026-08-28): let in-flight requests on the deactivated connection finish, then restart the proxy — no request fails, small added latency. CCA-15.3 implements and records this.
5. AC#10's third provider decided WITH the user (2026-08-28): mint a test key against the now-live evolv-hosted CCG gateway (this campaign's own CCG-2/4/5/7 work) via scripts/mint-key.sh, alongside the existing NVIDIA NIM and OpenRouter test keys. CCA-15.5 uses this.
6. Each subtask gets its own plan, notes, checked ACs and final summary per task-execution's subtask rule; work through them one at a time, in dependency order (15.1 -> 15.2 -> 15.3 -> 15.4 -> 15.5), most likely across multiple future campaign sessions given the size.
7. This session's own deliverable is the decomposition itself (subtask creation + these 4 decisions recorded) plus, context permitting, starting CCA-15.1. CCA-15 (parent) stays In Progress, not Done, until all 5 subtasks land — mirroring CCA-14's own parent/subtask lifecycle.
<!-- SECTION:PLAN:END -->
