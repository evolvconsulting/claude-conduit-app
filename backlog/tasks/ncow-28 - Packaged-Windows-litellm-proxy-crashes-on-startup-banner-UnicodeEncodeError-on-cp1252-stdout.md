---
id: NCOW-28
title: >-
  Packaged Windows litellm proxy crashes on startup: banner UnicodeEncodeError
  on cp1252 stdout
status: To Do
assignee: []
created_date: '2026-08-03 15:26'
labels:
  - windows
  - release
  - litellm
dependencies: []
priority: high
type: bug
ordinal: 41000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during NCOW-27's opus review while live-verifying the packaged proxy.start() fix on a real Windows VM (winvm). NCOW-27 fixed the pm2 managed-app interpreter (asar-path) defect on all platforms, but on Windows a SEPARATE, pre-existing defect means proxy.start() still fails from a stock packaged install: litellm 1.94.1's startup banner (litellm/proxy/common_utils/banner.py) writes characters that the default Windows stdout codepage (cp1252) cannot encode, raising a UnicodeEncodeError (observed live: "'charmap' codec can't encode characters in position 5-7") before litellm ever finishes starting, which times out as HEALTH_CHECK_TIMEOUT under pm2. The reviewer confirmed the fix: setting PYTHONIOENCODING=utf-8 in the child process env resolves it cleanly (proxy.start() -> {"ok":true}, real LLM completion through the running proxy, clean stop/restart). This app never sets that env var today. Net effect: as of NCOW-27 merging, every currently published release (and dev) still cannot start the LiteLLM proxy from a real packaged Windows install without a manual workaround -- the same class of "no release has actually been proven to work" gap NCOW-27 just closed for macOS and Linux, now isolated to Windows alone.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A stock packaged Windows build (no manual env-var workaround) can run proxy.start()/stop()/restart() successfully, verified live on a real Windows VM with no pre-existing litellm process
- [ ] #2 A real request through the running proxy on Windows gets a genuine LLM completion, verified live
- [ ] #3 The fix is scoped to the child process env this app controls (e.g. the generated run.js launchers env), not a global system-wide encoding change
- [ ] #4 A regression test covers the generated launcher/ecosystem entry carrying the correct env field(s) for this fix
- [ ] #5 npm test passes
<!-- AC:END -->
