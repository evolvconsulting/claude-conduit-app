---
id: CCA-15.5
title: Live multi-provider connection verification
status: To Do
assignee: []
created_date: '2026-08-28 15:01'
labels: []
dependencies:
  - CCA-15.1
  - CCA-15.2
  - CCA-15.3
  - CCA-15.4
parent_task_id: CCA-15
type: feature
ordinal: 92000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Close the parent's AC#10 with real, driven verification: at least three connections across at least two providers, switching between them with a real completion confirmed through each. Per the approved decision (2026-08-28), the third connection uses the now-live evolv-hosted CCG gateway (scripts/mint-key.sh) alongside the existing NVIDIA NIM and OpenRouter test keys.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 At least 3 connections exist spanning at least 2 providers (NVIDIA NIM, OpenRouter, and the evolv-hosted CCG gateway)
- [ ] #2 Switching between all 3 connections in the real driven UI, a real completion is confirmed through each
- [ ] #3 Claude Code/Desktop are confirmed still working with zero manual reconfiguration across all 3 switches, proving the client-config-fixed decision live
- [ ] #4 CCA-15.1's migration path is confirmed live: a real pre-CCA-15 fixture upgrades into one connection and keeps working
<!-- AC:END -->
