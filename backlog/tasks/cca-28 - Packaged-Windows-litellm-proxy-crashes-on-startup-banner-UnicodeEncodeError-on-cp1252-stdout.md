---
id: CCA-28
title: >-
  Packaged Windows litellm proxy crashes on startup: banner UnicodeEncodeError
  on cp1252 stdout
status: Done
assignee: []
created_date: '2026-08-03 15:26'
updated_date: '2026-08-03 23:12'
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
Found during CCA-27's opus review while live-verifying the packaged proxy.start() fix on a real Windows VM (winvm). CCA-27 fixed the pm2 managed-app interpreter (asar-path) defect on all platforms, but on Windows a SEPARATE, pre-existing defect means proxy.start() still fails from a stock packaged install: litellm 1.94.1's startup banner (litellm/proxy/common_utils/banner.py) writes characters that the default Windows stdout codepage (cp1252) cannot encode, raising a UnicodeEncodeError (observed live: "'charmap' codec can't encode characters in position 5-7") before litellm ever finishes starting, which times out as HEALTH_CHECK_TIMEOUT under pm2. The reviewer confirmed the fix: setting PYTHONIOENCODING=utf-8 in the child process env resolves it cleanly (proxy.start() -> {"ok":true}, real LLM completion through the running proxy, clean stop/restart). This app never sets that env var today. Net effect: as of CCA-27 merging, every currently published release (and dev) still cannot start the LiteLLM proxy from a real packaged Windows install without a manual workaround -- the same class of "no release has actually been proven to work" gap CCA-27 just closed for macOS and Linux, now isolated to Windows alone.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A stock packaged Windows build (no manual env-var workaround) can run proxy.start()/stop()/restart() successfully, verified live on a real Windows VM with no pre-existing litellm process
- [x] #2 A real request through the running proxy on Windows gets a genuine LLM completion, verified live
- [x] #3 The fix is scoped to the child process env this app controls (e.g. the generated run.js launchers env), not a global system-wide encoding change
- [x] #4 A regression test covers the generated launcher/ecosystem entry carrying the correct env field(s) for this fix
- [x] #5 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Add PYTHONIOENCODING: 'utf-8' to the generated managed litellm-nim pm2 entry's
env object in configGen.js's renderEcosystemConfigCjs(), alongside the existing
ELECTRON_RUN_AS_NODE: '1' (CCA-27). Unconditional across platforms (harmless
no-op where the console is already UTF-8). Add a doc comment on the Windows
cp1252/UnicodeEncodeError mechanism, and a regression test in
test/engine/configGen.test.js asserting env.PYTHONIOENCODING === 'utf-8' in the
generated ecosystem config.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Worker evidence (fix/CCA-28-windows-litellm-banner-encoding, commit 5bae1f8):

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

AC#4 - new test: "renderEcosystemConfigCjs: CCA-28 -- sets
env.PYTHONIOENCODING=utf-8..."; existing CCA-27 env-equality assertion
updated to include the new key.

AC#5 - npm test 259/259, run twice (before and after the winvm work).

Cleanup: all Claude Conduit.exe processes killed, scheduled task deleted, fake
home + build dirs removed from winvm, litellm-nim left stopped on the real
shared pm2 daemon (its pre-test state; never pm2 kill'd).

Awaiting opus review.

Opus review verdict: APPROVE. All 5 ACs independently confirmed with fresh
live evidence, not the implementer's claims.

AC#1/#2 - reviewer built its OWN packaged Windows arm64 artifact from this
branch, ran it live on winvm under --dev + a fresh NIM_PROXY_TEST_HOME,
confirmed no pre-existing litellm (port 4000 free): proxy.start -> ok:true
(13.1s/13.5s), running with 0 restarts, restart -> new pid, stop -> stopped,
zero renderer exceptions, banner printed with all glyphs intact,
UnicodeEncodeError/charmap grep over err.log -> 0 matches. Real completion via
raw HTTP POST to the live proxy -> HTTP 200 with real NVIDIA nvext
timing/worker metadata, both before and after restart; app's own
testConnection() also passed (completion + tool-calling).

AC#3 - confirmed on the generated artifact (not source): ecosystem.config.cjs
carries only { ELECTRON_RUN_AS_NODE: '1', PYTHONIOENCODING: 'utf-8' }; pm2 env
0 on the live process confirms it reached the child; nothing system-wide
(no setx/registry/chcp).

AC#4 - mutation-tested: removing PYTHONIOENCODING from configGen.js makes
test/engine/configGen.test.js fail 18/20 (the new CCA-28 test plus CCA-27's
env deepEqual); restoring it passes 20/20.

AC#5 - npm test 259/259, run twice independently.

A/B control (reviewer's own build pair, fix vs no-fix from the identical
tree): without the fix, proxy.start -> HEALTH_CHECK_TIMEOUT, crash-looped
(restarts 3->4), out.log empty (banner never printed), err.log 201KB with the
exact UnicodeEncodeError from the task description, completion ->
ECONNREFUSED. With the fix, all of the above pass cleanly. Isolates this one
env var as the load-bearing change.

Scope: diff is 2 files, additive only. CCA-27's fields (interpreter,
ELECTRON_RUN_AS_NODE) confirmed still live and working, not clobbered. No
overlap with CCA-21 (cmdQuoteArg/renderRunLauncherJs untouched) or CCA-24
(pm2Control.js untouched).

Non-blocking findings (not addressed in this task):
- configGen.generateAll() has exactly one caller (config.generate); nothing
  regenerates ecosystem.config.cjs on launch or version change, so an existing
  Windows install that ran setup on an older build keeps a stale ecosystem
  file missing this fix (and CCA-27's, if pre-dating it) until it re-runs
  setup. Inherited from CCA-27, not introduced here -- worth a possible
  follow-up task (regenerate generated configs on version change), pending
  user decision.
- electron-builder.yml's win targets are x64 only; reviewer verified a
  win-arm64 --dir build (native to winvm, matching the implementer) -- the fix
  itself is arch-independent, not a gap in this task, but no artifact this
  project actually SHIPS for Windows has been launched end-to-end yet (a
  release-readiness concern, not this task's).
- Minor test-name nit on CCA-27's existing test (title only mentions
  ELECTRON_RUN_AS_NODE even though its deepEqual now also pins
  PYTHONIOENCODING) -- reviewer recommends leaving as-is since the assertion
  is more valuable than the name.

Cleanup: all winvm artifacts (builds, both asars/exes, driver script, a key
file with the real NVIDIA key) removed; reviewer's own driver processes
terminated; pm2 daemon (pid 8832) never touched; litellm-nim left stopped
(same state found); real %APPDATA%\claude-conduit confirmed byte-identical
(7 files, SHA-256 + LastWriteTimeUtc) before/after. Local worktree clean,
259/259.

Ready for merge queue.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added PYTHONIOENCODING: 'utf-8' to configGen.js's renderEcosystemConfigCjs() generated env object for the managed litellm-nim pm2 entry, alongside CCA-27's ELECTRON_RUN_AS_NODE. Fixes litellm's startup banner crashing with UnicodeEncodeError on Windows' default cp1252 stdout codepage, which previously timed out as HEALTH_CHECK_TIMEOUT under pm2 -- blocking every packaged Windows install even after CCA-27's fix. Opus review independently confirmed all 5 ACs with an A/B control on a real Windows VM (winvm): a matched no-fix build reproduced the exact crash/crash-loop, the fix build ran proxy.start/stop/restart cleanly with a real LLM completion before and after restart. Mutation-tested the regression test. npm test 259/259 (261/261 after rebase onto CCA-29). Squash-merged PR #18 -> dev @ a6d80ea.
<!-- SECTION:FINAL_SUMMARY:END -->
