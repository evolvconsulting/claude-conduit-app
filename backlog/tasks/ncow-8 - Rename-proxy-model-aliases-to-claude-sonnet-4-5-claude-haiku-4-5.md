---
id: NCOW-8
title: Rename proxy model aliases to claude-sonnet-4-5 / claude-haiku-4-5
status: To Do
assignee: []
created_date: '2026-07-31 20:38'
updated_date: '2026-07-31 21:56'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The LiteLLM proxy currently exposes the aliases `nim-large` and `nim-small` as its `model_name` values (see `src/engine/configGen.js`, plus `claudeCodeConfig.js`, `claudeDesktopConfig.js`, `diagnostics.js` and `DESIGN.md`). These are not valid model IDs from the client point of view.

Change the exposed model IDs to `claude-sonnet-4-5` (primary / large) and `claude-haiku-4-5` (background / small). The user-facing display name must be the name of the actual underlying NVIDIA NIM model that the alias maps to (for example the selected `meta/llama-...` model), not the alias — so the UI tells the user which real model is serving each slot.

This touches the generated LiteLLM config, the Claude Code settings.json integration, the Claude Desktop config entry, diagnostics, the model catalog/UI, the fixtures under docs/reverse-engineering, and DESIGN.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Generated litellm config exposes model_name `claude-sonnet-4-5` for the primary slot and `claude-haiku-4-5` for the background slot
- [ ] #2 Claude Code settings.json integration points ANTHROPIC_MODEL (and the small/background model variable) at the new IDs
- [ ] #3 Claude Desktop config entry references the new IDs
- [ ] #4 Diagnostics probe the new IDs and pass against a live proxy
- [ ] #5 The UI display name for each slot is the actual NVIDIA NIM model name backing it, not the alias
- [ ] #6 No occurrence of `nim-large` or `nim-small` remains in src/, tests, fixtures, or DESIGN.md
- [ ] #7 DESIGN.md updated to document the new IDs
- [ ] #8 `npm test` passes
- [ ] #9 Verified end-to-end: a real request through the proxy for `claude-sonnet-4-5` and `claude-haiku-4-5` returns a completion using the real NVIDIA key
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Context added 2026-07-31 while updating docs, before this task was started:
1. Still fully valid and self-contained. It was chosen as the next task precisely because it survives NCOW-14 (provider abstraction) unchanged - the exposed alias names are a client-facing contract, independent of which upstream serves them.
2. AC 5 is worded as "the actual NVIDIA NIM model name". Read that as "the actual upstream model name". NCOW-14 makes NIM one provider among several, so do not build anything NVIDIA-specific to satisfy it.
3. Current occurrences of nim-large / nim-small at time of writing: src/engine/configGen.js, claudeCodeConfig.js, claudeDesktopConfig.js, diagnostics.js; test/engine/configGen.test.js, diagnostics.test.js, claudeDesktopConfig.test.js; docs/reverse-engineering/claude-desktop-config/fixtures/nim-proxy-entry.example.json; DESIGN.md; and the two prior backlog task files (leave those alone - they are history).
4. The real config dir on this machine has a working manifest (port 4000, primary meta/llama-3.3-70b-instruct, small meta/llama-3.1-8b-instruct), so an end-to-end check for AC 9 can start the proxy without running setup first. Prefer meta/llama-3.1-8b-instruct for speed.
<!-- SECTION:NOTES:END -->
