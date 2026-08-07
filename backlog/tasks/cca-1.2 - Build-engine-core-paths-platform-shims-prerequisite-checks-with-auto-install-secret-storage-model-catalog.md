---
id: CCA-1.2
title: >-
  Build engine core: paths, platform shims, prerequisite checks with
  auto-install, secret storage, model catalog
status: Done
assignee:
  - '@claude'
created_date: '2026-07-31 15:25'
updated_date: '2026-07-31 15:44'
labels: []
dependencies:
  - CCA-1.1
parent_task_id: CCA-1
type: task
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the plain-Node engine modules per DESIGN.md §2 and §4 Step 1/3, as designed in the plan: paths.js (resolves ~/.config/claude-nim-proxy on macOS/Linux, %APPDATA%\claude-nim-proxy on Windows, exact §2 file table); platform.js (cross-platform exec resolution incl. the Windows .cmd-shim fix for CLI tools like 'claude', argv-array execCli that never uses shell:true, securePrivateFile using chmod 0600 on POSIX and best-effort icacls on Windows, and safeTimestampForFilename stripping ':' so backup filenames don't break on Windows); manifest.js (read/write manifest.json per §9.3, extended with desktop_config_path/backup/prior_provider and secret_store_backend); prereqs.js (Node/Python/litellm-version/port checks per §4 Step 1, PLUS an auto-install flow: detect python3/python/py then uv/pipx/pip in that preference order and run the pinned 'litellm[proxy]==<PINNED>' install command as a child process with streamed output; hard-block with no auto-fix if the detected litellm version is 1.82.7 or 1.82.8 per the malware advisory; pm2 itself is bundled as a package.json dependency and driven via its programmatic API so it is never a missing prerequisite); secretStore.js (Electron safeStorage adapter for the NVIDIA key — save/load/clear/importFromExistingEnvFile — with graceful fallback to 're-enter your key' when encryption is unavailable or a stored blob fails to decrypt, never a crash or silent weak fallback); modelCatalog.js (live NIM catalog fetch, RECOMMENDED_PRIMARY/RECOMMENDED_SMALL constants quoted verbatim from DESIGN.md §4 Step 3, search/intersect-with-live-list helpers).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 paths.js resolves the documented directory + file table exactly on macOS/Linux and the Windows equivalent
- [x] #2 prereqs.js reports Node/pm2(bundled)/litellm/port status and can drive an end-to-end auto-install of litellm on a machine with Python present, blocking hard on litellm 1.82.7/1.82.8
- [x] #3 secretStore.js round-trips a key through Electron safeStorage and degrades gracefully when encryption is unavailable
- [x] #4 modelCatalog.js returns the live catalog plus the curated lists intersected against it, and supports substring search
- [x] #5 All modules are plain Node (Electron APIs only received as injected parameters) and are unit-testable without launching Electron
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. paths.js: resolveConfigDir({platform,homedir,appData}) + getFilePaths(configDir) per DESIGN.md section 2 (macOS/Linux ~/.config/claude-nim-proxy, Windows %APPDATA%\claude-nim-proxy).
2. platform.js: findExecutable (PATH walk, PATHEXT-aware on win32), resolveCliCommand (.cmd shim fix for npm-global CLIs like claude), execCli (execFile, argv array, never shell:true), securePrivateFile (chmod 0600 POSIX / best-effort icacls win32), safeTimestampForFilename (strip characters invalid in Windows filenames).
3. manifest.js: read/write manifest.json per section 9.3, extended with desktop_config_path/backup/prior_provider, secret_store_backend.
4. prereqs.js: checkNode/checkPython/checkLitellmOnPath/checkLitellmVersionSafe (hard block on 1.82.7/1.82.8)/checkPortFree, installLitellm() streaming child_process output, detecting uv/pipx/pip preference order. pm2 itself is not checked as a prerequisite - it is a bundled dependency, used programmatically (wired in CCA-1.3).
5. secretStore.js: factory taking an injected safeStorage + storagePath (never imported ambiently) - save/load/clear/importFromExistingEnvFile, graceful degradation when encryption unavailable or decrypt fails.
6. modelCatalog.js: RECOMMENDED_PRIMARY/RECOMMENDED_SMALL constants quoted verbatim from DESIGN.md section 4 Step 3, fetchCatalog (NIM /v1/models), intersectWithLive, searchModels, validateExplicitModelChoice.
7. Unit tests under test/engine/ using node:test for the pure-logic pieces (paths resolution, platform helpers, manifest round-trip, catalog intersect/search) - no Electron or real network required.
8. Verify: node --test test/engine/**/*.test.js passes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented paths.js, platform.js, manifest.js, prereqs.js, secretStore.js, modelCatalog.js under src/engine/. All plain Node (Electron injected as a parameter where needed, e.g. secretStore.createSecretStore(safeStorage, storagePath) — never imported ambiently), so every module is unit-testable without launching Electron.

Design choices worth recording:
- litellm pin refreshed against PyPI at implementation time: 1.94.1 (was a placeholder <PINNED> in DESIGN.md).
- pm2 itself is intentionally absent from prereqs.js/runAllPrereqChecks — per the plan it is a bundled dependency driven programmatically (CCA-1.3s job), never a detected/missing prerequisite.
- installLitellm() follows DESIGN.md section 4 Step 1s uv > pipx > pip preference order, streams child_process stdout/stderr via an onOutput callback for real UI progress, and the malware-advisory versions (1.82.7/1.82.8) are a hard, non-auto-fixable stop with no reinstall attempt — verified by dedicated tests.

Verified with real evidence, not just unit tests:
- 33/33 node --test cases pass (npm test), covering paths resolution (macOS/Linux/Windows), platform shims (Windows .cmd fix, safe timestamp filenames, real PATH walk against this machines actual node binary), manifest read/write/merge round-trip, litellm version-safety logic including the malware block, and modelCatalog intersect/search/near-match logic against the verbatim DESIGN.md section 4 Step 3 constants.
- Ran prereqs checks against this real machines actual state: correctly detected Python3 (pyenv shim), correctly reported litellm as NOT found (it genuinely was not installed), correctly detected uv as the preferred installer, correctly reported an ephemeral port as free.
- Ran installLitellm() for real: `uv tool install litellm[proxy]==1.94.1` completed successfully end-to-end (streamed real installer output), and the post-install checkLitellmOnPath()/checkLitellmVersionSafe() calls then correctly found the newly-installed binary at ~/.local/bin/litellm and confirmed its version passes the safety check. litellm is now genuinely installed on this dev machine, which also unblocks real testing of CCA-1.3 (pm2/proxy lifecycle).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the plain-Node engine core: paths.js (cross-platform config-dir/file resolution matching DESIGN.md section 2 exactly on macOS/Linux, plus Claude Code settings.json and Claude Desktop configLibrary path resolution for later subtasks), platform.js (PATH-walk exec resolution, Windows .cmd-shim fix, argv-array execCli, chmod-0600/icacls file securing, Windows-safe backup timestamps), manifest.js (read/write/merge), prereqs.js (Node/Python/litellm/port checks plus a real, working uv/pipx/pip auto-install flow with a hard non-auto-fixable block on the two malware-advisory litellm versions), secretStore.js (an injected-safeStorage adapter with graceful degradation), and modelCatalog.js (live catalog fetch/search/recommend using the verbatim DESIGN.md section 4 Step 3 constants).

Verified with 33 passing node:test cases (npm test) plus real, non-synthetic runs against this machine: prereqs correctly read this machines actual Python/litellm/port state, and installLitellm() was run for real via uv, genuinely installing litellm 1.94.1 end-to-end with streamed output, then re-verified by the same checks.
<!-- SECTION:FINAL_SUMMARY:END -->
