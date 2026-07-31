---
id: NCOW-1.5
title: Implement Claude Code CLI settings.json integration
status: Done
assignee:
  - '@claude'
created_date: '2026-07-31 15:26'
updated_date: '2026-07-31 15:57'
labels: []
dependencies:
  - NCOW-1.2
parent_task_id: NCOW-1
type: task
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement claudeCodeConfig.js per DESIGN.md §9.1/§9.4 exactly: read ~/.claude/settings.json (same path on all 3 platforms), abort with a typed error and write nothing if unparseable or not a JSON object, set only the 11 documented env keys (ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_MODEL, ANTHROPIC_DEFAULT_SONNET_MODEL, ANTHROPIC_DEFAULT_OPUS_MODEL, ANTHROPIC_DEFAULT_HAIKU_MODEL, ANTHROPIC_SMALL_FAST_MODEL, API_TIMEOUT_MS, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS, CLAUDE_CODE_MAX_OUTPUT_TOKENS), preserve every other top-level and env.* key byte-for-byte, write a timestamped backup (settings.json.bak.claude-nim-proxy.<safe-timestamp>, using platform.js's Windows-safe timestamp helper — a raw ISO string with ':' breaks fs.renameSync on Windows) before any write, and write atomically via temp-file-plus-rename. Removal deletes exactly the manifest-recorded env_keys_set, never a blind restore from backup.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Merging into a settings.json that already has unrelated permissions/hooks/model keys preserves them byte-for-byte, changing only the 11 documented env keys
- [x] #2 An unparseable or non-object settings.json aborts with a clear error and the file is left completely untouched
- [x] #3 A timestamped backup is created before every write and the backup filename is valid on Windows
- [x] #4 Removing the integration deletes exactly the keys that were set, leaving all other settings.json content intact
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. claudeCodeConfig.js: ENV_KEYS constant (the 11 keys, DESIGN.md section 9.1), mergeClaudeCodeSettings(settingsPath, envValues) implementing the exact algorithm (read/parse-or-abort, set only the 11 env keys inside settings.env preserving everything else, timestamped Windows-safe backup before write, atomic temp+rename write), removeClaudeCodeSettings(settingsPath, keysToRemove) mirroring it for uninstall.
2. Unit tests using node:test against temp-file copies only, INCLUDING a copy of this machines actual real settings.json shape (env/permissions.deny/model/hooks) as a realistic fixture - never touching the real ~/.claude/settings.json itself.
3. Verify: node --test passes, including byte-for-byte preservation of unrelated keys, unparseable-JSON abort-without-writing, and a merge-then-remove round trip that restores the original content.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented claudeCodeConfig.js: ENV_KEYS/buildEnvValues (the exact 11 keys and values from DESIGN.md section 9.1s table), mergeClaudeCodeSettings (read-or-abort-if-unparseable, backup-then-atomic-write), removeClaudeCodeSettings (deletes exactly the recorded keys, never a blind restore).

Deliberately never touched this machines real ~/.claude/settings.json during testing/verification (it is this live sessions own active config) - instead built a realistic fixture modeled on its actual shape (env with pre-existing unrelated vars, permissions.deny list, top-level model, hooks) read via cat for reference only, and ran every test against temp-file copies.

Verified with 68 passing tests (npm test), specifically: byte-for-byte preservation of unrelated top-level keys (permissions/hooks/model) and pre-existing env entries against the realistic fixture; unparseable JSON (and non-object top-level JSON like a bare array) aborts with zero bytes written and zero backup/temp files created; idempotent re-merge overwrites only the 11 keys with no duplication; and a full merge-then-remove round trip restores the original file byte-for-byte.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the exact DESIGN.md section 9.1/9.4 settings.json merge and removal algorithm in claudeCodeConfig.js. Verified with 68 passing unit tests against temp-file fixtures, including one modeled on this machines actual real settings.json shape for realism, without ever touching the real file (this sessions own active config). Confirmed byte-for-byte preservation of unrelated content, abort-without-writing on unparseable input, and a full merge-then-remove round trip that restores the original file exactly.
<!-- SECTION:FINAL_SUMMARY:END -->
