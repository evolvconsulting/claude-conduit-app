---
id: NCOW-20
title: 'Fix Windows litellm launch: .cmd-only discovery and missing shell:true spawn'
status: In Progress
assignee: []
created_date: '2026-08-02 04:37'
updated_date: '2026-08-02 06:55'
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
