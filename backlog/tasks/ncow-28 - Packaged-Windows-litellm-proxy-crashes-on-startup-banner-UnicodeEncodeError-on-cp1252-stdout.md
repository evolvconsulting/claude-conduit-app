---
id: NCOW-28
title: >-
  Packaged Windows litellm proxy crashes on startup: banner UnicodeEncodeError
  on cp1252 stdout
status: In Progress
assignee: []
created_date: '2026-08-03 15:26'
updated_date: '2026-08-03 22:44'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Add PYTHONIOENCODING: 'utf-8' to the generated managed litellm-nim pm2 entry's
env object in configGen.js's renderEcosystemConfigCjs(), alongside the existing
ELECTRON_RUN_AS_NODE: '1' (NCOW-27). Unconditional across platforms (harmless
no-op where the console is already UTF-8). Add a doc comment on the Windows
cp1252/UnicodeEncodeError mechanism, and a regression test in
test/engine/configGen.test.js asserting env.PYTHONIOENCODING === 'utf-8' in the
generated ecosystem config.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Worker evidence (fix/NCOW-28-windows-litellm-banner-encoding, commit 5bae1f8):

AC#1/#2 - live on a real Windows VM (winvm), fresh packaged Windows arm64
artifact built from this branch via npm run pack. No pre-existing litellm-nim
pm2 entry beforehand (pm2 list empty). Ran the packaged Claude Conduit.exe
under --dev + NIM_PROXY_TEST_HOME (via a one-shot Scheduled Task so it
survives the SSH session), driven live via CDP:
  prereqs.check() found litellm 1.94.1 on PATH
  config.generate() succeeded
  proxy.start() -> {"ok":true}, pid 6644, status "running"
  proxy.testConnection() -> NIM upstream pass, real completion pass (2246ms),
    tool-calling pass
  proxy.stop() -> stopped
  proxy.restart() -> new pid 7896, running again; testConnection() passed again
  proxy.stop() -> stopped (final)
out.log shows litellm's banner (the exact crash trigger) printing twice with
zero UnicodeEncodeError, followed by real POST /v1/messages 200 OK entries
both times.

AC#3 - confirmed the generated ecosystem.config.cjs under the fake test home
sets env: { ELECTRON_RUN_AS_NODE: '1', PYTHONIOENCODING: 'utf-8' } only on this
app's own pm2-managed child entry; nothing system-wide touched.

AC#4 - new test: "renderEcosystemConfigCjs: NCOW-28 -- sets
env.PYTHONIOENCODING=utf-8..."; existing NCOW-27 env-equality assertion
updated to include the new key.

AC#5 - npm test 259/259, run twice (before and after the winvm work).

Cleanup: all Claude Conduit.exe processes killed, scheduled task deleted, fake
home + build dirs removed from winvm, litellm-nim left stopped on the real
shared pm2 daemon (its pre-test state; never pm2 kill'd).

Awaiting opus review.
<!-- SECTION:NOTES:END -->
