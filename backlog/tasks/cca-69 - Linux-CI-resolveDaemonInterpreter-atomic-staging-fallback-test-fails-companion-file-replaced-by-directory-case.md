---
id: CCA-69
title: >-
  Linux CI: resolveDaemonInterpreter atomic-staging fallback test fails
  (companion-file-replaced-by-directory case)
status: To Do
assignee: []
created_date: '2026-08-17 23:26'
updated_date: '2026-08-17 23:27'
labels:
  - test-infra
  - bug
  - linux
dependencies: []
priority: high
ordinal: 87000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Discovered 2026-08-17 while verifying CCA-67's Linux-CI fix (a sibling test in the same file, pm2Control.test.js). Confirmed with a clean, CI-faithful `npm ci` inside a node:20-slim Linux container (node 20, matching .github/workflows/release.yml) — NOT a node_modules/platform-mismatch artifact.

Failing test: 'resolveDaemonInterpreter: a failed re-copy attempt leaves no partial state behind (atomic staging, NCOW-24 review finding 3)' at test/engine/pm2Control.test.js:1252.

The test replaces a companion file (snapshot_blob.bin) with a directory to force fs.copyFileSync to fail mid-copy, then asserts resolveDaemonInterpreter() falls back to returning the original execPath untouched (atomic staging: no partial copy left behind). On Linux this assertion fails:

  expected: '.../app/fake-exe'
  actual:   '.../pm2home/daemon-interpreter/fake-exe'

i.e. resolveDaemonInterpreter() returned the NEW copied-interpreter path instead of falling back to execPath — implying the forced copy failure does not actually fail on Linux the way it does on macOS (fs.copyFileSync/fs.cpSync against a directory-as-source likely surfaces a different error, or none, on Linux vs macOS/Darwin's copyfile(3)-backed implementation).

This is release-blocking the same way CCA-67/CCA-68 are: a failing `npm test` aborts electron-builder's build+publish step for that platform in .github/workflows/release.yml. CCA-63's next real release re-attempt will hit THIS failure on Linux CI even after CCA-67 and CCA-68 land, since it's a distinct test in the same file.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Root cause identified: why replacing a companion file with a directory does not reliably make resolveDaemonInterpreter()'s re-copy attempt fail on Linux the way it does on macOS
- [ ] #2 A fix or mitigation implemented so this test passes reliably on Linux CI (both x64 and arm64), verified by actually re-running the GitHub Actions release workflow (or an equivalent Linux CI job) rather than only local macOS runs
- [ ] #3 npm test passes on Linux CI with no regression to the atomic-staging guarantee this test guards (a failed re-copy must still leave the previous good copy completely untouched, with no partial/broken interpreter and no dangling temp staging directory)
<!-- AC:END -->
