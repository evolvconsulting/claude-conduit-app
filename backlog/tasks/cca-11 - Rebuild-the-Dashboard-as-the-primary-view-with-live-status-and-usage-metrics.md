---
id: CCA-11
title: Rebuild the Dashboard as the primary view with live status and usage metrics
status: To Do
assignee: []
created_date: '2026-07-31 21:50'
updated_date: '2026-07-31 21:52'
labels: []
dependencies:
  - CCA-15
priority: high
type: enhancement
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Dashboard should be the top-level landing view in the nav, not a peer buried below Setup, and it should actually tell the user what their proxy is doing. Today it shows a status pill, Start/Stop/Restart, a log tail and a Test Connection button; there are no usage metrics at all.

Promote Dashboard to the first nav entry and make it the default route once configuration exists. Then add live status plus usage statistics: request counts, tokens in/out, context consumed, error and rate-limit counts, latency, and per-model breakdown.

Consult the frontend-design skill before designing the layout. The renderer is deliberately plain HTML/CSS/ES modules with no framework and no bundler, and a hash router with bare route names - keep that.

OPEN QUESTION to resolve first, because it determines what is buildable: where do the metrics come from? LiteLLM options each have costs. Its Prometheus /metrics endpoint may be enterprise-gated; spend and usage logging generally wants a database this app does not currently provision; a callback or custom logger writing to a local file avoids that but means owning the aggregation. Establish what a stock, database-free LiteLLM install actually exposes before designing around it, and do not promise a metric the proxy cannot supply.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Dashboard is the first entry in the sidebar and the default route once the app is configured
- [ ] #2 A documented decision records where usage metrics come from, verified against a real running proxy rather than assumed from docs
- [ ] #3 Dashboard shows live proxy status, uptime and the active model configuration
- [ ] #4 Dashboard shows request volume over time, token usage in and out, and error plus rate-limit counts
- [ ] #5 Context consumption is shown per request or per session, or its absence is explained if the proxy cannot supply it
- [ ] #6 Metrics are broken down by model
- [ ] #7 The empty state (proxy never started, no traffic yet) is designed, not a blank panel
- [ ] #8 Metrics collection does not measurably slow the proxy or grow unbounded on disk
- [ ] #9 Layout was designed with the frontend-design skill and stays framework-free and bundler-free
- [ ] #10 Verified against a real proxy with real traffic through it, with the numbers cross-checked against the proxy own logs
<!-- AC:END -->
