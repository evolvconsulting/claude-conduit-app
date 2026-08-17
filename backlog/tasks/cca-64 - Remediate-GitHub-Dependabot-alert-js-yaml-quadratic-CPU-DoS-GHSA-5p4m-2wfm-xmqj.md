---
id: CCA-64
title: >-
  Remediate GitHub Dependabot alert: js-yaml quadratic-CPU DoS
  (GHSA-5p4m-2wfm-xmqj)
status: In Progress
assignee: []
created_date: '2026-08-17 00:10'
updated_date: '2026-08-17 03:40'
labels:
  - security
  - dependencies
dependencies: []
references:
  - 'https://github.com/evolvconsulting/claude-conduit-app/security/dependabot/1'
  - 'https://github.com/advisories/GHSA-5p4m-2wfm-xmqj'
priority: high
ordinal: 82000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Dependabot flagged a high-severity (CVSS 7.5) advisory on the transitive js-yaml@4.3.0 dependency (>=4.0.0 <4.3.1, fixed in 4.3.1): resolveYamlOmap() does an O(n) indexOf scan per entry inside its dedupe loop, making !!omap resolution in yaml.load() quadratic in input size and able to block the Node event loop for seconds on a modestly sized malicious YAML document. js-yaml is pulled in transitively via electron-builder, electron-updater, and pm2 (all deduped to the same 4.3.0), not imported directly by app code, so the fix is a version bump rather than a code change. Resolve or explicitly dismiss the alert so the repo's Dependabot page is clean.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 js-yaml resolves to >=4.3.1 everywhere in package-lock.json (via update, override, or upstream dependency bump)
- [ ] #2 npm test and npm run build (or equivalent) still pass after the bump
- [ ] #3 GitHub security alert https://github.com/evolvconsulting/claude-conduit-app/security/dependabot/1 shows fixed, or is dismissed with a documented reason if a fix genuinely isn't available yet
<!-- AC:END -->
