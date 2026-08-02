---
id: NCOW-10.2
title: >-
  Add CI release workflow publishing artifacts + update metadata to GitHub
  Releases
status: In Progress
assignee: []
created_date: '2026-08-02 01:07'
updated_date: '2026-08-02 02:40'
labels: []
dependencies:
  - NCOW-9
references:
  - docs/distribution.md
parent_task_id: NCOW-10
priority: high
type: chore
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a CI workflow (GitHub Actions) that builds this app with electron-builder and publishes the artifacts plus the update-metadata files (latest.yml, latest-mac.yml, latest-linux.yml — already emitted by electron-builder into dist/ per NCOW-9, no extra build config needed) to GitHub Releases on evolvconsulting/claude-conduit.

Follow docs/distribution.md (from NCOW-9) for the existing release checklist, including its documented asset-naming footgun: GitHub's web UI rewrites spaces to periods in uploaded filenames, which silently breaks auto-update if artifacts are ever uploaded by hand instead of via this CI workflow — the whole point of this workflow is to avoid that failure mode by always publishing through CI.

Per the campaign tracker (doc-4): builds are UNSIGNED for now (no code-signing certs yet) — the workflow does not need to invoke a signing step, just produce and publish the same artifacts electron-builder already produces locally.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CI workflow builds all target platforms and publishes the resulting artifacts to a GitHub Release
- [ ] #2 The update-metadata files (latest.yml / latest-mac.yml / latest-linux.yml) are published alongside the artifacts, with filenames intact (no space-to-period corruption)
- [ ] #3 Workflow trigger is defined and documented (e.g. on version tag push)
- [ ] #4 docs/distribution.md is updated to reference the new CI workflow as the recommended release path
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
GitHub Actions release workflow (.github/workflows/release.yml): matrix build across ubuntu-latest/macos-latest/windows-latest, npm ci + npm test as a gate, electron-builder --publish always on a version-tag push to publish artifacts + latest*.yml/latest-mac.yml/latest-linux.yml to GitHub Releases. Unsigned (no signing step, per campaign decision). docs/distribution.md updated to reference it as the recommended release path. Verified via a real, clearly-labeled smoke-test tag (v0.0.0-ci-smoketest) rather than trusting the YAML unread, per this project's verification standard -- this surfaced 6 real bugs across 6 fix passes (a Windows production bug in configDirMigration.js's path-rewrite, a broken npm run licenses on Windows, 2 Windows-only test bugs, 2 CI-workflow races), all fixed and re-verified against real Windows/macOS/Linux CI runs before merge.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented by worker (with one concurrency incident: an earlier worker instance kept running silently after being told to stand down and clobbered uncommitted work mid-fix-pass; force-killed via TaskStop once discovered, no data lost since the fixes were fully re-described and reapplied by the surviving instance). Final run 30729113396: all three platforms (Windows/Linux/macOS) build+test+publish cleanly. Independently confirmed by orchestrator: real non-draft release published with all expected assets and correct, intact latest.yml/latest-mac.yml/latest-linux.yml filenames (AC2); only Claude.Conduit-...-universal-mac.zip.blockmap has a corrupted name, a documented upstream electron-builder 26.15.3 bug (unsanitized artifact name reaching its blockmap builder for the macOS zip target), non-load-bearing since macOS auto-update is notify-only per NCOW-10.1. npm test: 220/220 passing (219 + 1 new win32-path regression test). Real bugs found+fixed along the way (verified against real Windows CI, not just code reading): (1) src/engine/configDirMigration.js -- genuine Windows production bug, JSON.stringify escaping doubles backslashes in generated run.js/ecosystem.config.cjs, migration's rewrite check compared against the raw unescaped path and silently never matched, leaving a real Windows upgrade's pm2 launcher files pointing at the deleted legacy directory; fixed to match the JSON-escaped form. (2) scripts/generate-licenses.js + test/main/licenses.test.js -- npm run licenses (required by CLAUDE.md after any dependency change) was silently broken on Windows: execFileSync('npm',...) threw ENOENT (needs npm.cmd via the existing resolveCliCommand convention), then EINVAL (.cmd needs shell:true, safe here since fixed literal args, no secrets). (3) test/main/licenses.test.js's nameOfDir() hardcoded a forward-slash node_modules/ literal against Windows' backslash npm ls output, plus a JSON-escaping-mismatch regex bug mirroring #1. (4) test/engine/platform.test.js -- test-only bug, hardcoded bare 'node' expectation; findExecutable's win32 PATHEXT behavior was already correct. (5) .github/workflows/release.yml -- fixed a tag/package.json-version mismatch race and a concurrent-publish duplicate-draft-release race, both found via real triggered runs. (6) docs/distribution.md documents all of the above plus the electron-builder blockmap bug. Cleanup verified by orchestrator directly: test release + tag both gone from the real repo, package.json version confirmed back to 0.1.0, working tree clean. Branch pushed, ready for review.
<!-- SECTION:NOTES:END -->
