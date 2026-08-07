---
id: CCA-8
title: Rename proxy model aliases to claude-sonnet-4-5 / claude-haiku-4-5
status: Done
assignee:
  - '@claude'
created_date: '2026-07-31 20:38'
updated_date: '2026-07-31 22:30'
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
- [x] #1 Generated litellm config exposes model_name `claude-sonnet-4-5` for the primary slot and `claude-haiku-4-5` for the background slot
- [x] #2 Claude Code settings.json integration points ANTHROPIC_MODEL (and the small/background model variable) at the new IDs
- [x] #3 Claude Desktop config entry references the new IDs
- [ ] #4 Diagnostics probe the new IDs and pass against a live proxy
- [x] #5 The UI display name for each slot is the actual NVIDIA NIM model name backing it, not the alias
- [x] #6 No occurrence of `nim-large` or `nim-small` remains in src/, tests, fixtures, or DESIGN.md
- [x] #7 DESIGN.md updated to document the new IDs
- [x] #8 `npm test` passes
- [x] #9 Verified end-to-end: a real request through the proxy for `claude-sonnet-4-5` and `claude-haiku-4-5` returns a completion using the real NVIDIA key
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. src/engine/configGen.js: rename model_name aliases in renderConfigYaml — nim-large -> claude-sonnet-4-5, nim-small -> claude-haiku-4-5; adjust the two inline comments.
2. src/engine/claudeCodeConfig.js: buildEnvValues — ANTHROPIC_MODEL/DEFAULT_SONNET_MODEL/DEFAULT_OPUS_MODEL -> 'claude-sonnet-4-5'; DEFAULT_HAIKU_MODEL/SMALL_FAST_MODEL -> 'claude-haiku-4-5'.
3. src/engine/claudeDesktopConfig.js: applyGatewayConfig's inferenceModels name fields, and desktopSetupMarkdown's models table + verify-step text -> new IDs.
4. src/engine/diagnostics.js: rename every hardcoded/default 'nim-large'/'nim-small' occurrence (buildRequestA/B defaults, checkCompletion/checkToolCalling defaults, checkSmallModel, checkNimReachable's detail text, and the 4 call sites in runDiagnostics/runQuickValidation) -> claude-sonnet-4-5/claude-haiku-4-5. (Confirmed via research: these are correctly hardcoded constants, not a primaryModelId pass-through bug — the alias is fixed across installs, only the underlying NIM model varies — so this is a pure rename, no behavior change.)
5. docs/reverse-engineering/claude-desktop-config/fixtures/nim-proxy-entry.example.json: rename the two inferenceModels entries.
6. Update test/engine/configGen.test.js, test/engine/claudeDesktopConfig.test.js, test/engine/diagnostics.test.js: replace nim-large/nim-small literals and assertions with the new IDs.
7. DESIGN.md: update section 6.1's config.yaml sample + comments, section 8's Desktop instructions table + verify text, section 9.1's env-keys table, section 11's test-mode request/sample-output/small-model row, section 12.2 gotcha #2, section 13's T7 manual-test row. Add a short note (matching the section 7.4/CCA-4 pattern) documenting the CCA-8 rename and why (nim-large/nim-small are not valid client-facing model IDs).
8. Confirmed via research (no code change needed): AC 5 is already satisfied structurally — dashboard-view.js/setup-view.js/diagnostics-view.js already display manifest.primary_model/small_model (the real upstream NIM id) or the live catalog's real ids, and never hardcode the alias literal. Will still verify live per the verification standard.
9. npm test — expect 141/141 (pure rename, no new tests needed since existing tests already cover this surface).
10. Live end-to-end (AC 4, 9): regenerate the real config directory's config.yaml via the updated configGen against the existing resolved manifest (port 4000, primary meta/llama-3.3-70b-instruct, small meta/llama-3.1-8b-instruct per doc-2), restart the pm2-supervised proxy, then send two real completions through it for model=claude-sonnet-4-5 and model=claude-haiku-4-5 using the real NVIDIA key. Screenshot the Dashboard to confirm the Primary/Small labels show the real upstream model id, never the alias.
11. Check off each AC against observed evidence per the finalization guide; leave any AC unchecked with a stated reason if it genuinely cannot be verified in this environment.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Context added 2026-07-31 while updating docs, before this task was started:
1. Still fully valid and self-contained. It was chosen as the next task precisely because it survives CCA-14 (provider abstraction) unchanged - the exposed alias names are a client-facing contract, independent of which upstream serves them.
2. AC 5 is worded as "the actual NVIDIA NIM model name". Read that as "the actual upstream model name". CCA-14 makes NIM one provider among several, so do not build anything NVIDIA-specific to satisfy it.
3. Current occurrences of nim-large / nim-small at time of writing: src/engine/configGen.js, claudeCodeConfig.js, claudeDesktopConfig.js, diagnostics.js; test/engine/configGen.test.js, diagnostics.test.js, claudeDesktopConfig.test.js; docs/reverse-engineering/claude-desktop-config/fixtures/nim-proxy-entry.example.json; DESIGN.md; and the two prior backlog task files (leave those alone - they are history).
4. The real config dir on this machine has a working manifest (port 4000, primary meta/llama-3.3-70b-instruct, small meta/llama-3.1-8b-instruct), so an end-to-end check for AC 9 can start the proxy without running setup first. Prefer meta/llama-3.1-8b-instruct for speed.

Live verification (real config dir, real NVIDIA key, meta/llama-3.3-70b-instruct + meta/llama-3.1-8b-instruct, port 4000):

AC1: Regenerated the real config.yaml via configGen with the updated code. model_name lines now read claude-sonnet-4-5 / claude-haiku-4-5 / "claude-*". Confirmed live via GET /v1/models on the running proxy: ["claude-sonnet-4-5","claude-haiku-4-5","claude-*"] - no nim-large/nim-small.

AC2: Live-executed claudeCodeConfig.buildEnvValues({port:4000, masterKey}) directly (real function call, not code reading): ANTHROPIC_MODEL/DEFAULT_SONNET_MODEL/DEFAULT_OPUS_MODEL = claude-sonnet-4-5; DEFAULT_HAIKU_MODEL/SMALL_FAST_MODEL = claude-haiku-4-5. Did not write the real ~/.claude/settings.json to avoid touching this machine's live Claude Code config unnecessarily.

AC3: Verified via the updated unit test (test/engine/claudeDesktopConfig.test.js "applyGatewayConfig: creates a dedicated entry...") which executes the real function against a temp configLibraryDir and asserts inferenceModels === [claude-sonnet-4-5/sonnet, claude-haiku-4-5/haiku]; test passes. Deliberately did NOT re-apply against this machine's REAL Claude Desktop configLibrary (a real "NIM Proxy Manager" entry already exists there from a prior session) to avoid mutating live third-party-inference config without a separate explicit ask.

AC4: PARTIAL / NOT FULLY PASSING - see comment below. Diagnostics correctly reference the new IDs (check 3 detail: "102 models; claude-sonnet-4-5=meta/llama-3.3-70b-instruct"; check 7 label "Completion (claude-haiku-4-5)" passed at 379ms), but running the real diagnostics.runDiagnostics() against the live proxy showed checks 4/5/6/8 (all exercising the PRIMARY model, meta/llama-3.3-70b-instruct) fail with "This operation was aborted" at exactly 30003-30005ms. Independently confirmed via direct curl that this model's real latency on this NVIDIA account is ~54s for a 64-token completion - i.e. diagnostics.js's postMessages() hardcodes timeoutMs=30_000, which is shorter than this specific model's real upstream latency. This is a PRE-EXISTING bug unrelated to the alias rename (postMessages/timeoutMs untouched by this task; same model, same timeout, would abort identically under the old nim-large alias). checkSmallModel (claude-haiku-4-5, fast model) and checkLiveCliSmoke (claude CLI, no 30s cap) both passed cleanly.

AC5: Live CDP session against the real Dashboard (electron . --dev --remote-debugging-port=9222, no NIM_PROXY_TEST_HOME so it loaded the real manifest): body text read "Port 4000 · Primary meta/llama-3.3-70b-instruct · Small meta/llama-3.1-8b-instruct" - the real upstream model IDs, never the alias. Zero Runtime.exceptionThrown events. Quit via Apple Event; confirmed via ps that no Electron process remained, and confirmed via `pm2 list` that quitting correctly stopped litellm-nim again (CCA-4 regression check, still working).

AC6: Repo-wide grep for nim-large/nim-small after all edits returns zero hits outside backlog/tasks/cca-1.x, cca-8's own description/plan text, and backlog/docs/doc-2 (all explicitly named as historical/leave-alone in this task's own Implementation Notes).

AC8: npm test - 141/141, unchanged pass count (pure rename, no new tests needed).

AC9: Live completions through the real proxy using the real NVIDIA key: model=claude-sonnet-4-5 -> HTTP 200, text="OK", stop_reason=end_turn (54239ms - matches the known-slow 70b model); model=claude-haiku-4-5 -> HTTP 200, text="OK", stop_reason=end_turn (276ms).

Machine state restored: litellm-nim stopped (pm2 list confirmed), unrelated "spawner" pm2 app untouched/online throughout.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Renamed the proxy's client-facing model aliases from nim-large/nim-small to claude-sonnet-4-5/claude-haiku-4-5 across every source of truth: configGen.js's generated config.yaml, claudeCodeConfig.js's Claude Code settings.json env values, claudeDesktopConfig.js's inferenceModels entries and DESKTOP-SETUP.md template, diagnostics.js's default models/labels, the docs/reverse-engineering fixture, three test files, and DESIGN.md (sections 6.1, 8, 9.1, 11, 12.2, 13, plus a new CCA-8 note). A repo-wide grep confirms zero remaining occurrences outside historical backlog task files (explicitly excluded per this task's own notes).

AC5 (UI shows the real upstream model, not the alias) required no code change — dashboard-view.js/setup-view.js already displayed manifest.primary_model/small_model, never the alias — confirmed live rather than assumed.

Verified live end-to-end against the real config directory and real NVIDIA key (not mocked): regenerated config.yaml, restarted the pm2-supervised proxy, confirmed GET /v1/models serves exactly [claude-sonnet-4-5, claude-haiku-4-5, claude-*], sent real completions for both new IDs (200/OK for each), live-executed claudeCodeConfig.buildEnvValues() to confirm the Claude Code env values, and drove the real Dashboard over CDP to confirm it shows "Primary meta/llama-3.3-70b-instruct · Small meta/llama-3.1-8b-instruct" with zero renderer exceptions. npm test 141/141.

AC4 left UNCHECKED: running the real diagnostics.runDiagnostics() live surfaced a genuine pre-existing bug, unrelated to this rename — postMessages() hardcodes a 30s abort timeout, but meta/llama-3.3-70b-instruct genuinely takes ~54s on this account, so every primary-model check (4, 5, 6, 8) aborts and fails even though the underlying request succeeds given enough time (independently confirmed via direct curl and via check 7, which uses the fast small model and passed cleanly). This would reproduce identically under the old alias, since nothing about postMessages/timeoutMs changed here. Per user direction, filed as a separate follow-up rather than expanding this task's scope: CCA-16.

Machine state restored: litellm-nim left stopped (matching how the session found it); the unrelated "spawner" pm2 app was untouched throughout.
<!-- SECTION:FINAL_SUMMARY:END -->
