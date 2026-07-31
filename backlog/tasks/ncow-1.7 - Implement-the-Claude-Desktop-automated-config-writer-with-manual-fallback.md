---
id: NCOW-1.7
title: Implement the Claude Desktop automated config writer with manual fallback
status: Done
assignee:
  - '@claude'
created_date: '2026-07-31 15:26'
updated_date: '2026-07-31 17:00'
labels: []
dependencies:
  - NCOW-1.6
  - NCOW-1.2
parent_task_id: NCOW-1
type: task
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement claudeDesktopConfig.js using the confirmed findings from NCOW-1.6 (docs/reverse-engineering/claude-desktop-config/FINDINGS.md). REVISED approach based on those findings (Claude Desktops own internal model is multiple named profiles, not a single mutable active config): applyGatewayConfig({port, masterKey, consent}) requires consent:true (throws ConsentRequiredError otherwise); refuses to act if configLibrary/_meta.json does not exist yet (throws NoExistingConfigLibraryError so the UI can direct the user to open Claude Desktops own Configure Third-Party Inference form once first - never synthesizes a first-run scaffold from a guess); takes a full timestamped backup of the whole configLibrary directory before any write; creates (or reuses, via an id recorded in manifest.json) a DEDICATED named entry (e.g. "NIM Proxy Manager") in _meta.json.entries ({id,name} only - no provider/note persisted), writes the gateway config (inferenceProvider=gateway, inferenceGatewayBaseUrl, inferenceGatewayApiKey, inferenceGatewayAuthScheme=bearer, inferenceCredentialKind=static, inferenceModels=[nim-large/sonnet, nim-small/haiku]) into that entrys own configLibrary/<id>.json (read-modify-write preserving unknown existing keys if the entry already existed), then sets _meta.json.appliedId to that entrys id - NEVER touching the users other entries. revertToDefault() mirrors Claude Desktops own internal vPt() logic exactly: search entries (applied-first) for one whose config already has inferenceProvider=anthropic; else find-or-create an entry literally named "Claude API" and patch it to inferenceProvider=anthropic; then activate it via appliedId. detectStatus() is read-only and best-effort (macOS also tries defaults read com.anthropic.claudefordesktop), always allowing not-detectable as an answer. DESKTOP-SETUP.md (DESIGN.md section 8 content, port/master-key substituted) is always generated regardless of whether the automated path is attempted, as the permanent fallback.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 applyGatewayConfig refuses to run without explicit consent and refuses to create a configLibrary directory from scratch
- [x] #2 A full backup of configLibrary is taken before any write and is restorable
- [x] #3 detectStatus never throws and returns 'not-detectable' rather than guessing when it cannot confirm state
- [x] #4 DESKTOP-SETUP.md guided instructions are generated on every run regardless of whether the automated writer is used
- [x] #5 Applying the gateway config creates/reuses a dedicated named entry and activates it via appliedId, never modifying or deleting any of the users other existing entries in _meta.json or configLibrary
- [x] #6 revertToDefault mirrors Claude Desktop's own vPt() logic (find-or-create an inferenceProvider=anthropic entry, then activate it) rather than blindly flipping a field on an arbitrary last-touched file
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. claudeDesktopConfig.js core functions: readMeta/writeMeta (parse-or-null, JSON.stringify(obj,null,2)), readEntryConfig(id)/writeEntryConfig(id,content) for configLibrary/<id>.json, findEntryByName(meta,name), createEntry(name) (crypto.randomUUID + empty {} file + push {id,name} to meta.entries), setApplied(id) (validates id known, sets meta.appliedId).
2. backupConfigLibrary(dir) - full recursive copy to a sibling timestamped dir (or null if configLibrary does not exist yet).
3. applyGatewayConfig({configLibraryDir, port, masterKey, manifest, consent}) - consent gate, NoExistingConfigLibraryError if dir missing, backup, find-or-create OUR_ENTRY_NAME=NIM Proxy Manager entry (reuse id from manifest.desktop_config_entry_id if still present in meta.entries, else create fresh and record the new id), merge the 6 gateway fields onto whatever that entrys file already contains, setApplied. Returns {entryId, backupPath} for the caller to persist into manifest.json.
4. revertToDefault({configLibraryDir, manifest}) - mirrors vPt(): search entries applied-first for inferenceProvider=anthropic; else find-or-create a Claude API entry and patch it; setApplied.
5. detectStatus({configLibraryDir, port, masterKey}) - read-only: read meta, read the applied entrys config, compare inferenceGatewayBaseUrl/ApiKey against ours; macOS defaults read best-effort; always returns not-detectable rather than throwing on any failure.
6. desktopSetupMarkdown({port, masterKey}) - DESIGN.md section 8 template, port/master-key substituted.
7. Unit tests with node:test against a temp configLibrary directory fixture (never the real one, which does not exist on this machine anyway per NCOW-1.6) - cover: refuses without consent, refuses when dir missing, never touches other entries, merge-preserves-unknown-keys on re-apply, revert creates Claude API entry when none exists, revert reuses an existing anthropic entry when one does exist, backup+restore.
8. Verify: node --test passes; a manual smoke test creating a synthetic configLibrary dir and running apply/detect/revert against it end to end.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented claudeDesktopConfig.js using the NCOW-1.6 findings, with the revised dedicated-named-entry approach (not the originally-planned edit-the-active-file-in-place approach) - see that tasks notes and docs/reverse-engineering/claude-desktop-config/FINDINGS.md for why. applyGatewayConfig creates/reuses an entry literally named "NIM Proxy Manager" (never touching any pre-existing entry), read-modify-writes only the 6 gateway fields onto that entrys own file, and sets appliedId to it. revertToDefault mirrors Claude Desktops own decompiled vPt() logic exactly: reuse an existing inferenceProvider=anthropic entry if one exists (applied-first search), else find-or-create a "Claude API" entry.

All functions take configLibraryDir as an explicit parameter - nothing in this module hardcodes or assumes the real ~/Library/Application Support/Claude-3p/configLibrary path (that wiring belongs to the IPC/main layer in NCOW-1.8), which is also why every test below could safely use a disposable temp directory and never risked touching this machines real Claude Desktop state (confirmed separately in NCOW-1.6 that this machine has no real configLibrary at all yet anyway).

Verified with 83 passing tests (npm test), specifically: refuses without consent (ConsentRequiredError) and refuses against a missing configLibrary dir (NoExistingConfigLibraryError, and confirmed it does NOT create the directory itself); apply creates a dedicated entry while leaving a seeded users other entry (name/content) completely untouched; a second apply call reuses the same entry id (no duplicates) and updates the port; apply preserves unknown existing fields on its own entry (e.g. modelDiscoveryEnabled) via read-modify-write; apply falls back to creating a fresh entry if the manifest-recorded id was removed out from under it; a full backup+corrupt+restore round trip exactly restores the original _meta.json; revert creates a Claude API entry when none exists and reuses one when it does (with the untouched gateway entry still present afterward, never deleted); detectStatus never throws across a missing-directory case, an active case, and a post-revert inactive case; and the DESKTOP-SETUP.md template correctly substitutes port/master key.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented claudeDesktopConfig.js: a consent-gated, backup-first automated writer for Claude Desktops local 3P gateway config, built on the NCOW-1.6 static-analysis findings. It manages a dedicated NIM Proxy Manager profile entry and never touches the users other entries, and its revert logic mirrors Claude Desktops own internal find-or-create-anthropic-entry behavior rather than blindly mutating whatever was last active - directly implementing the safer approach that research uncovered. The always-on manual-instructions fallback (desktopSetupMarkdown) is generated regardless of whether the automated path is used.

Verified with 83 passing tests against disposable temp-directory fixtures (never this machines real Claude Desktop state, which has no configLibrary yet). Confirmed: consent and existing-directory gates both refuse correctly; a seeded users other entry survives apply/revert completely untouched; repeated applies are idempotent (no duplicate entries); unknown existing fields on our own entry survive a re-apply; a full backup/corrupt/restore cycle exactly restores the original state; and detectStatus never throws across missing/active/inactive scenarios.
<!-- SECTION:FINAL_SUMMARY:END -->
