---
id: CCA-1.9
title: Implement uninstall flow
status: Done
assignee:
  - '@claude'
created_date: '2026-07-31 15:27'
updated_date: '2026-07-31 17:01'
labels: []
dependencies:
  - CCA-1.3
  - CCA-1.5
  - CCA-1.7
parent_task_id: CCA-1
type: task
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement uninstall.js per DESIGN.md section 9.4: remove exactly the manifest-recorded env_keys_set from settings.json via claudeCodeConfig.removeClaudeCodeSettings (only if cli_configured), pm2Control.remove() (pm2 delete litellm-nim, ignore not-found, pm2 save), print/show Claude Desktop removal guidance, and support a purge option that deletes the whole config directory (without purge, keep it and show its path). Do not automatically call claudeDesktopConfig.revertToDefault() as a side effect of uninstall - that requires its own separate, explicit confirmation in the UI, since it touches a Desktop-owned file domain outside the proxy config directory.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Uninstall without purge removes the pm2 app and Claude Code CLI keys but leaves the config directory and its contents in place
- [x] #2 Uninstall with purge additionally deletes the entire config directory
- [x] #3 Claude Desktop is only reverted when the user separately and explicitly confirms it, never automatically
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. uninstall.js: uninstall({configDir, manifest, pm2Control, purge}) orchestrating: if manifest.cli_configured, call claudeCodeConfig.removeClaudeCodeSettings(manifest.settings_file, manifest.env_keys_set); pm2Control.remove(); if purge, fs.rmSync(configDir, {recursive:true,force:true}) else leave it; Claude Desktop is explicitly NOT touched here (needs separate confirmation per the task description) - return a structured {removed: [...]} summary of what actually happened for the UI to display.
2. Unit tests with node:test using a fake pm2Control and temp directories/settings.json fixtures (never real state) - cover: keep-vs-purge, cli_configured=false skip, already-uninstalled idempotency.
3. Verify: node --test passes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented uninstall.js orchestrating claudeCodeConfig.removeClaudeCodeSettings (only if manifest.cli_configured), pm2Control.remove(), and an optional purge of the config directory. Deliberately has zero dependency on claudeDesktopConfig.js - Claude Desktop reversion requires its own separate, explicit confirmation per the task description, verified by a structural test asserting there is no require() of that module (not just a substring check, since the modules name legitimately appears in this files own doc comment explaining the exclusion).

Verified with 88 passing tests (npm test): keep-mode leaves the config directory and correctly strips exactly the Claude Code CLI env keys from a real merged settings.json fixture; purge-mode additionally deletes the whole config directory; CLI removal is correctly skipped when cli_configured is false or manifest is null entirely; and a fake pm2Control confirms remove() is always called regardless of manifest state.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented uninstall.js per DESIGN.md section 9.4, adapted for the GUI: removes exactly the recorded Claude Code CLI env keys (when configured), removes the pm2 app, and optionally purges the config directory - with Claude Desktop explicitly excluded (requires separate confirmation, structurally verified with no dependency on claudeDesktopConfig.js). Verified with 88 passing tests covering keep vs purge, the never-configured case, and correct pm2Control invocation.
<!-- SECTION:FINAL_SUMMARY:END -->
