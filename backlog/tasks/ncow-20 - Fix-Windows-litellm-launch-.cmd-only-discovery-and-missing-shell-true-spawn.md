---
id: NCOW-20
title: 'Fix Windows litellm launch: .cmd-only discovery and missing shell:true spawn'
status: In Progress
assignee: []
created_date: '2026-08-02 04:37'
updated_date: '2026-08-02 07:05'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Discovered during NCOW-10.3's real end-to-end verification on a Windows VM (winvm): litellm can currently never actually start on Windows via this app, from two independent, compounding bugs. Both were independently confirmed by an opus reviewer via direct code trace (not just re-read from the worker's claims), and are unrelated to the auto-update mechanism itself (NCOW-10.3's other, now-resolved blocker was the repo being private).

Bug 1 -- discovery: src/engine/platform.js's resolveCliCommand() unconditionally appends .cmd for win32 (used by src/engine/prereqs.js's checkLitellmOnPath()/checkPython()/detectInstaller() call sites). findExecutable()'s win32 PATHEXT loop only appends an extension when the name doesn't already end in one of the pathExt entries, so for the wrapped name "litellm.cmd" the only candidates tried are litellm.cmd.EXE / litellm.cmd / litellm.cmd.BAT -- litellm.exe is never reachable. pip/uv/pipx console-script entry points ship as .exe stubs on Windows, never .cmd, so a real pip-installed litellm (or python) can never be found. checkPython() is broken identically (python.exe/py.exe unreachable). platform.js's own doc comment on resolveCliCommand already says it's for "npm-global CLI shims (pm2, claude)" and explicitly "Not needed for litellm's already-resolved absolute path" -- the prereqs.js call sites contradict the helper's documented intent. The likely fix is narrow: stop wrapping litellm/python names in resolveCliCommand before passing to findExecutable, since findExecutable's own PATHEXT walk already handles Windows extension resolution correctly for a bare name.

Bug 2 -- launch: configGen.js's generated run.js launcher calls child_process.spawn(litellmAbsPath, args, {stdio:'inherit'}) with no shell:true. Modern Node (as bundled in this app's current Electron, which carries the post-CVE-2024-27980 hardening) throws spawn EINVAL for any direct .cmd/.bat spawn without shell:true. So even a .cmd litellm shim that bug 1's fix would allow to be found still cannot actually be spawned without this fix too. These two bugs compound: today, nothing found is ever real (bug 1), and nothing real would be spawnable anyway (bug 2).

Both bugs were confirmed via direct code trace against platform.js, prereqs.js, and configGen.js -- see NCOW-10.3's task notes for the full evidence trail from both the original worker and an independent opus review pass that re-derived the same findings from first principles.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 checkLitellmOnPath() and checkPython() (src/engine/prereqs.js) correctly find a real pip/uv/pipx-installed litellm and python on Windows (not just an artificially-created .cmd shim)
- [ ] #2 The generated run.js launcher (configGen.js) can actually spawn litellm on Windows without throwing EINVAL
- [ ] #3 Regression tests cover both fixes on a simulated Windows platform (this project's existing tests already inject process.platform per test/engine/platform.test.js's pattern)
- [ ] #4 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Two independent fixes matching the two bugs: (1) stop wrapping litellm/python/installer names in resolveCliCommand() before findExecutable() in prereqs.js -- that PATHEXT loop already resolves Windows extensions correctly for bare names. (2) In configGen.js's generated run.js, detect when the resolved litellm path ends in .cmd/.bat on win32 and route the spawn through cmd.exe as the target program (shell left OFF, explicit argv array) instead of a removed direct spawn -- avoids both the EINVAL crash and the shell-injection risk that naive shell:true + args would introduce (user-influenced args like model IDs/API keys flow into this launcher).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
WORKER RESULT: status=implemented, branch fix/NCOW-20-windows-litellm-launch pushed (2 commits: 33e831f prereqs fix, c138564 configGen fix). npm test: 232/232 passing (baseline 220, +13 new regression tests, 0 failing).

AC1: checkLitellmOnPath()/checkPython()/detectInstaller() now pass the bare name to findExecutable(name, extraSearchDirs, opts), forwarding platform/envPath/pathExt through opts instead of pre-wrapping via resolveCliCommand(). 7 new tests in test/engine/prereqs.test.js build a fake win32 PATH dir with .exe files and confirm litellm.exe/python3.exe/py.exe/uv.exe/pip.exe are all found, plus a non-regression check that a bare litellm.cmd shim is still found.

AC2: renderRunLauncherJs() in configGen.js branches on needsCmdWrapper = win32 && /\.(cmd|bat)$/i.test(litellmPath). When true: spawns process.env.ComSpec||'cmd.exe' with ['/d','/s','/c', litellmPath, ...args], shell left undefined/never true -- deliberately avoids the shell-injection risk that naive shell:true + an args array carrying user-chosen model IDs/API keys would introduce. When false (the common real-world .exe case): spawns litellmPath directly, unchanged from before. Also added stopChild() so the wrapper case kills the process tree via taskkill /pid <pid> /t /f instead of a plain child.kill(), since cmd.exe is only an intermediary and killing it alone would orphan the real litellm process. 6 new tests in test/engine/configGen.test.js execute the generated launcher code via a Function-constructor harness with a fake require()/process capturing spawn() calls, asserting both branches' spawn shape and stop behavior.

AC3: 13 new regression tests total, all using the same process.platform-injection/opts pattern as the existing test/engine/platform.test.js style.

AC4: npm test 232/232 passing, confirmed baseline was 220 by stashing and re-running.

OPEN QUESTION flagged by worker (not acted on, out of this task's stated scope): src/engine/prereqs.js's installLitellm() also does a direct spawn(installer.path, args, ...) with no shell handling -- same theoretical EINVAL exposure if an installer (uv/pipx/pip) ever resolved to a .cmd/.bat instead of .exe. In practice these are native/console-script .exe stubs on Windows just like litellm, and this call site wasn't named in NCOW-20's ACs, so left untouched. Worth a follow-up task if it becomes relevant.
<!-- SECTION:NOTES:END -->
