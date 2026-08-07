---
id: NCOW-62
title: Add evolv hosted gateway as a provider/connection type (remote LiteLLM in AWS)
status: To Do
assignee: []
created_date: '2026-08-07 16:28'
updated_date: '2026-08-07 18:09'
labels: []
dependencies:
  - NCOW-14
  - NCOW-15
references:
  - 'https://docs.litellm.ai/docs/proxy/guardrails/bedrock'
  - >-
    https://github.com/evolvconsulting/evolv-coder-be/blob/main/infra/litellm-task-definition.json
priority: medium
ordinal: 75000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Decision (2026-08-07): alongside the local proxy, evolv will run a hosted LLM gateway in AWS as a standalone stack, deliberately decoupled from evolv-coder-be — whose infra/litellm ECS deployment is the working precedent (LiteLLM on Fargate routing to Bedrock + NVIDIA NIM, master key in Secrets Manager, same 1.82.7/1.82.8 version blocklist as this repo). The hosted stack lives in its own repo (not this one, not evolv-coder-be) with: ALB + TLS + DNS; Postgres-backed LiteLLM virtual keys as the auth boundary so nothing is publicly usable without a per-user bearer key; Langfuse callbacks pointed at the evolv-ultra Langfuse instance; and one provider-agnostic guardrails system enforced at the proxy layer (Bedrock ApplyGuardrail hooks, which LiteLLM applies to requests regardless of upstream provider).

This task covers the claude-conduit side only: model the hosted gateway as a provider/connection type behind the NCOW-14 abstraction, managed as a saved connection per NCOW-15. A hosted connection is a base URL plus a per-user virtual key; there is no local process to install or supervise, so pm2/litellm prerequisites, port checks, and proxy lifecycle do not apply in that mode. Local-proxy mode remains fully supported (offline, personal-key, and client-machine-isolation cases). Server-side work (the gateway stack itself, key issuance, guardrail policy, Langfuse wiring) is tracked in the gateway repo, not here.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A hosted-gateway connection can be created from a base URL and per-user virtual key, and is validated with a live authenticated request before being saved
- [ ] #2 Activating a hosted connection configures Claude Code and Claude Desktop to point at the hosted URL with the virtual key, and starts or supervises no local process
- [ ] #3 Prerequisite checks for pm2 and litellm are skipped for hosted connections, and setup completes on a machine with neither installed
- [ ] #4 Diagnostics for a hosted connection report reachability, auth validity, and a real completion through the gateway; local-process checks are not run and cannot fail the connection
- [ ] #5 Status reflects the remote gateway health endpoint rather than pm2 state, including a distinguishable gateway-unreachable state
- [ ] #6 Removing a hosted connection removes local configuration only and never mutates server-side state
- [ ] #7 Switching between a hosted connection and a local-proxy connection works in both directions per NCOW-15 connection semantics
- [ ] #8 A Request Key flow captures an @evolvconsulting.com email, sends it to the gateway key broker with a locally generated device nonce, accepts the emailed short-lived code, exchanges code + nonce for the virtual key, and stores it in the secret store without ever displaying it
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Owner decisions 2026-08-07: self-service key issuance via email-verified short-lived codes (code emailed, never the key; exchange requires the device nonce). Design source of truth now lives in the claude-conduit-docs repo (spec claude-conduit-v2-architecture + ADRs); the broker itself is claude-conduit-gateway CCG-5.
<!-- SECTION:NOTES:END -->
