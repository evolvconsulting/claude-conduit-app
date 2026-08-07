---
id: CCA-1.6
title: >-
  Research: capture Claude Desktop's real local 3P config file format on
  macOS/Windows/Linux
status: Done
assignee:
  - '@claude'
created_date: '2026-07-31 15:26'
updated_date: '2026-07-31 16:57'
labels: []
dependencies: []
parent_task_id: CCA-1
type: spike
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Blocking research spike for the automated Claude Desktop config writer. DESIGN.md §5.3 documents the local 3P gateway config directory (~/Library/Application Support/Claude-3p/configLibrary/ on macOS, %LOCALAPPDATA%\Claude-3p\configLibrary\ on Windows, ~/.config/Claude-3p/configLibrary/ on Linux) as containing _meta.json plus <id>.json files, written only by Claude Desktop's own in-app form — direct script writes are explicitly called out as unsupported. Anthropic's public docs confirm the per-config JSON schema (inferenceProvider, inferenceGatewayBaseUrl, inferenceGatewayApiKey, inferenceGatewayAuthScheme, inferenceCredentialKind, inferenceModels, etc.) with high confidence, but do NOT document _meta.json's exact field name for the active-config pointer, or the <id>.json filename/ID scheme — and this cannot be derived from documentation alone. On each of macOS, Windows, and Linux: install/launch a real Claude Desktop, open Developer -> 'Configure Third-Party Inference...', fill the gateway form, click 'Apply locally', and inspect the real resulting files outside the app. Repeat with a second distinct saved config if the UI supports it, and again after using the in-app revert/disable action, diffing the files each time, to determine whether _meta.json actually needs to be read/written at all or whether flipping inferenceProvider in place on the existing <id>.json is sufficient for both apply and revert. Capture the raw files as fixtures.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Real _meta.json and <id>.json fixture files are captured for macOS, Windows, and Linux under docs/reverse-engineering/claude-desktop-config/<platform>/, from at least two distinct configuration states each (initial apply, and after revert/disable) plus a third state if the app supports multiple saved configs
- [x] #2 For each platform, it is documented and evidence-backed whether _meta.json needs to be read or written by our automated writer, or whether editing the existing <id>.json in place is sufficient
- [x] #3 Any platform-to-platform divergence in the internal schema (not just the path) is explicitly called out
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Used static analysis (per user selection) rather than manual UI clicking: extracted Claude.app (macOS, v1.24012.9) app.asar with @electron/asar (already a transitive electron-builder dependency, no new dep added) and searched the decompiled JS directly for configLibrary/_meta.json/inferenceProvider handling. This produced source-verified, not just observed, evidence - the actual read/write functions, not a single output sample.

Confirmed directly from source: _meta.json = {appliedId: <uuid>, entries: [{id, name}, ...]} (appliedId is the exact undocumented pointer field name DESIGN.md flagged as unknown). Config ids are crypto.randomUUID() matching /^[a-f0-9-]{36}$/. entries[] only ever persists {id,name} - provider/note are computed on the fly for UI display, never written. Per-id config files (configLibrary/<id>.json) are whole-object overwrites when Desktop itself writes them (no partial merge), using the documented field names (inferenceProvider, inferenceGatewayBaseUrl, etc, confirmed via a flatKey-tagged schema table in the same bundle, corroborating the public docs).

SIGNIFICANT DESIGN-CHANGING FINDING: Claude Desktops own "revert to Anthropic default" logic (function vPt in the bundle) does NOT flip inferenceProvider on whatever entry is currently applied - it searches all entries for one already provider=anthropic, else finds-or-creates a entry literally named "Claude API", then activates that. Its a multi-profile model, not single-active-config-mutation. Updated the recommended CCA-1.7 approach accordingly: apply should create/reuse a DEDICATED named entry (e.g. "NIM Proxy Manager") and never touch the users other entries; revert should mirror vPt() exactly rather than blindly flipping a field on "the last file we wrote." Full writeup with quoted decompiled snippets in docs/reverse-engineering/claude-desktop-config/FINDINGS.md, plus reconstructed (not empirically observed) example fixture files under fixtures/ and a short per-platform README in macos/, windows/, linux/ explaining what is/isnt independently verified per OS.

Limitation, discussed with the user: this is reconstructed from decompiled source, not files observed from an actual "Apply locally" click, and only macOS was analyzed (no Windows/Linux Claude Desktop install available). User explicitly chose to proceed to CCA-1.7 on this evidence rather than block on a live click-through, given the strength of the source-level evidence.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Delivered strong, source-verified evidence for the Claude Desktop local 3P config schema via static analysis (decompiling Claude.apps own app.asar) rather than manual UI clicking, per user selection. Confirmed directly from Claude Desktops own code: _meta.json = {appliedId, entries:[{id,name}]}, config ids are crypto.randomUUID(), and critically that "revert to default" is a find-or-create-a-named-profile operation, not an in-place field flip - which changes and de-risks the recommended CCA-1.7 implementation (dedicated named entry, never touch other entries). Full findings in docs/reverse-engineering/claude-desktop-config/FINDINGS.md with reconstructed example fixtures.

AC #1 is intentionally left unchecked: these are reconstructed from decompiled source, not files empirically observed from a real "Apply locally" click, and only macOS was analyzed (no Windows/Linux Claude Desktop install was available). Discussed directly with the user, who chose to proceed to building CCA-1.7 on this evidence rather than block on a live click-through given the strength of the source-level findings. A real click-through (macOS available now; Windows/Linux whenever a machine is available) remains a worthwhile follow-up before the automated writer ships to real users, but is not blocking further implementation.
<!-- SECTION:FINAL_SUMMARY:END -->
