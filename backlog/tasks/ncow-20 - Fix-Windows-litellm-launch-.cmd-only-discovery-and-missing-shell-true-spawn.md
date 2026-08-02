---
id: NCOW-20
title: 'Fix Windows litellm launch: .cmd-only discovery and missing shell:true spawn'
status: In Progress
assignee: []
created_date: '2026-08-02 04:37'
updated_date: '2026-08-02 09:24'
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

REVIEW (opus): request_changes. Confirmed AC indices: [1, 4] (AC2 partially, AC3 not confirmed). All findings independently verified LIVE on winvm (Windows VM), not just code-read.

AC1 (discovery fix): CONFIRMED. Bare names now reach findExecutable() correctly; traced platform.js's PATHEXT loop directly. resolveCliCommand() correctly retained for its other legitimate uses (pm2/claude/npm). This half is genuinely correct.

AC2 (launch fix): PARTIALLY CONFIRMED, real defect found. Direct .exe spawn path (the common real-world case after AC1's fix) is correct and injection-free. BUT the new cmd.exe /d /s /c wrapper for .cmd/.bat paths is BROKEN for any path containing a space (verified live: libuv quotes the spaced path, cmd.exe's /s rule strips only the outer quotes, shredding the command -- reproduced with and without /s). This project's own paths regularly contain spaces (e.g. "C:\Program Files\...", "C:\Users\Jeremy Newhouse\..."). Reachable in practice: engine-context.js's config.generate only checks checkLitellmOnPath().ok, not gated on a working version check, so a .cmd shim does reach the launcher -- would silently pm2-restart-loop instead of erroring cleanly.

SECURITY FINDING (important): the worker's stated rationale for why the cmd.exe wrapper avoids shell-injection risk is WRONG, empirically disproven on real Windows. cmd.exe re-parses the command line libuv produces; libuv's quoting only escapes whitespace/quotes, never cmd metacharacters (&, |, <, >, ^, %, etc). Reviewer proved live: an arg containing `&echo,INJECTED>marker` with no whitespace passes through unescaped and executes via the new wrapper (marker file created) -- identical result to naive shell:true+args, i.e. the new form is NOT meaningfully safer against injection, only marginally better for whitespace-only args. Also %USERNAME%-style env-var args get expanded through the wrapper. VERDICT: not currently exploitable in practice (args here are the app's own resolved paths + a hardcoded port; model IDs/keys/base URLs travel via config.yaml/litellm.env, never reach this argv) -- so request_changes, not escalate -- but the doc comment's safety claim is false and load-bearing for future maintainers, must be corrected to state the real reason (these specific args are app-generated, not "shell is off").

AC3 (tests): NOT CONFIRMED -- CI-BREAKING BUG. 6 of 7 new prereqs.test.js tests are filesystem-case-dependent: fixtures created as lowercase "litellm.exe" only match the default pathExt fallback ('.EXE;.CMD;.BAT') because macOS APFS is case-insensitive. Reviewer proved by mounting a case-sensitive volume: 6/13 fail. release.yml's CI matrix runs npm test on ubuntu-latest (case-sensitive) -- this branch as-is WOULD BREAK THE RELEASE PIPELINE. Minimal fix: pass explicit lowercase pathExt ('.exe;.cmd;.bat') in test opts, or match fixture case to the real default.

Additional findings (lower severity): taskkill spawn has no 'error' listener (a missing taskkill binary would crash via unhandled error event); runAllPrereqChecks()'s execCli(path,['--version']) on a .cmd shim still throws EINVAL (swallowed, reported as a critical "unparseable version" failure) -- same EINVAL class, unaddressed, arguably closer to the stated ACs than the installLitellm() item the worker already flagged as out-of-scope (that one is confirmed accurate and low-risk, real installers ship .exe).

RECOMMENDATION (priority order): (1) fix the case-dependent tests -- CI-breaking, must fix regardless of anything else; (2) either properly fix the cmd.exe wrapper with metacharacter-aware quoting (not just whitespace) plus windowsVerbatimArguments and a regression test covering a spaced path + a metacharacter-bearing arg, OR remove the wrapper branch entirely and rely on the .exe path (defensible since finding on the version-check gate means a .cmd shim doesn't cleanly reach the launcher today anyway) -- worker's call, with justification; (3) correct the doc comment's safety rationale; (4) add the missing taskkill 'error' listener. AC1's fix is solid and should not be touched by the fix pass.

FIX PASS 1 (fresh worker): addressed all 4 reviewer findings from review pass 1, in the same worktree/branch (2 new commits, no amends).

1. Case-dependent tests fixed: added explicit WIN32_PATH_EXT = '.exe;.cmd;.bat' passed in all 6 affected prereqs.test.js tests. Verified the fix is filesystem-independent by direct reasoning (not by re-hitting the same case-insensitive-FS blind spot): findExecutable's candidate is built as name+ext; with the old default '.EXE;.CMD;.BAT' the candidate 'litellm.EXE' is not === the fixture's exact bytes 'litellm.exe', it only "passed" before because macOS APFS folds case in fs.accessSync/statSync (confirmed live on this machine). With explicit lowercase pathExt the candidate is byte-identical to the fixture -- a plain string comparison that holds on any filesystem.

2. cmd.exe wrapper fixed via Option A (proper fix, not removal): replaced the broken construction with a single fully-escaped command string built by a cmdQuoteArg() emitted into the generated launcher (Windows argv quote/backslash rules + ^-escaping every cmd.exe metacharacter & | < > ^ ( ) % ! -- required even inside quotes), wrapped in one more quote pair, invoked as cmd.exe /d /s /c "<joined>" with windowsVerbatimArguments:true. Verified without Windows access by writing a reference cmd.exe-shaped decoder (strip outer quote per /s, quote-aware tokenize, un-escape ^X->X) and confirming round-trip to the exact original argv for both a spaced path (C:\Program Files\litellm\litellm.cmd, spaced username) and a metacharacter-bearing arg (&echo,INJECTED>marker&set), plus confirmed every &/> in the raw joined string is immediately preceded by an escaping ^. Two new regression tests added in configGen.test.js covering exactly these cases. Direct .exe spawn path untouched, still passing.

3. Doc comment corrected: now states the true reason (these args are app-generated absolute paths + a hardcoded port, never model IDs/keys/URLs which travel via config.yaml/litellm.env) and explicitly disclaims the false "shell is off" framing given cmd.exe's re-parsing behavior.

4. Missing error handling fixed: taskkill spawn now has killer.on('error', ...) logging + falls back to child.kill(sig), matching the existing child.on('error', ...) pattern already used in prereqs.js's installer spawn (closest existing precedent in this codebase; shutdown.js wraps pm2 via injected deps rather than raw spawn so wasn't a direct match).

npm test: 234/234 passing (232 baseline + 2 net new tests). prereqs.js's AC1 fix (confirmed correct by review pass 1) was NOT touched, per instruction. Two commits pushed to origin/fix/NCOW-20-windows-litellm-launch.

Open item carried forward unchanged (same as before this fix, out of scope, prereqs.js is do-not-touch for this pass): runAllPrereqChecks()'s version-check still throws EINVAL on a .cmd shim -- pre-existing, unaddressed, not in NCOW-20's ACs.

REVIEW PASS 2 (opus): request_changes. Confirmed AC indices: [1, 3, 4] (AC1 discovery fix intact/untouched; AC4 taskkill error handling resolved; AC3/tests -- finding_1's case-sensitivity fix genuinely resolved, verified twice live: pre-fix commit reproduces 6/13 failures on a real case-sensitive APFS volume, post-fix commit is 234/234 clean on the same volume). AC2 (launch fix) is the single remaining blocker.

finding_1 (case-sensitive tests): RESOLVED. Verified by code trace (candidate string is byte-identical to fixture, no case-fold anywhere) AND empirically on a real case-sensitive volume (HEAD~2: 6/13 fail, reproducing pass 1's exact finding; HEAD: 234/234 clean).

finding_2 (cmd.exe wrapper): PARTIALLY RESOLVED, still defective, BLOCKING. Live-tested on winvm against the real generated launcher with a recording litellm.cmd shim. The space-path bug from pass 1 IS genuinely fixed (C:\Program Files\...\litellm.cmd + a spaced-username config path now round-trips argv exactly). BUT the fix's central premise is inverted: cmd.exe does NOT treat &|<>()  as control characters inside a double-quoted region, and ^ is NOT an escape character there either -- it survives as a literal byte. The current code's blanket ^-escape of every metacharacter therefore corrupts values instead of protecting them: C:\Program Files (x86)\...\litellm.cmd now fails outright (exit 1, path not found) since the caret gets inserted into the parenthesized directory name; %USERNAME% is "prevented" from expanding only by mangling the variable name into garbage; and a crafted arg containing an embedded quote (a"&echo,BREAKOUT>marker&"b) achieves real injection -- marker file created with BREAKOUT content, proven live. Confirmed via a controlled experiment: regenerating the identical launcher with ONLY the caret-escaping line removed made every one of these cases (Program Files (x86), the metachar arg, the embedded-quote injection arg) behave correctly -- proper double-quoting alone is sufficient and the caret pass is pure downside. Not a newly-introduced regression (HEAD~2 also failed these cases, differently) and not currently exploitable in this codebase (only app-generated paths/flags/a numeric port reach this argv, confirmed by re-checking prereqs.js/engine-context.js) -- but the code's escaping logic and its doc comment's stated rationale are both wrong and must not ship as correct.

finding_3 (doc comment): NOT RESOLVED -- one false claim was replaced by a different false claim (comment claims quoting alone does NOT stop cmd.exe treating metachars as control chars and that caret-escaping "costs nothing" -- both live-disproven per finding_2). The closing paragraph about safety resting on app-generated inputs IS true and should be kept.

finding_4 (taskkill error handling): RESOLVED. killer.on('error', ...) correctly falls back to child.kill(); no double-kill or race (error only fires if the spawn itself failed, meaning taskkill never ran).

NEW FINDING: the new regression test (configGen.test.js) enshrines the same wrong model -- its decodeCmdLine() helper un-escapes ^X->X inside quotes (the same false assumption) and its metachar assertion ("every &/> must be preceded by an escaping ^") will FAIL against the actually-correct implementation. The test itself needs inverting alongside the code, or it will block the real fix.

RECOMMENDATION: precisely fixable in one more pass, not a deeper design problem -- reviewer explicitly expects pass 3 to approve. (1) In configGen.js's generated cmdQuoteArg, delete the caret-escaping regex line entirely; keep everything else (the embedded-quote-doubling rule, trailing-backslash-doubling, outer quote pair, /d /s /c, windowsVerbatimArguments:true) -- all independently live-verified correct without it. (2) Rewrite the doc comment to state that per-argument double-quoting alone is what neutralizes cmd.exe's metacharacters inside a quoted region (& | < > ( ) do not act as control chars there), that ^ is NOT an escape character in a quoted region and inserting it corrupts values (breaks paths like "Program Files (x86)"), and that the one honest residual is %VAR%-style expansion which still occurs inside quotes and cannot be escaped on a cmd command line -- acceptable specifically because these args are app-generated and never carry a literal %. Keep the existing true paragraph about app-generated inputs. (3) In configGen.test.js, remove the ^X->X un-escape from decodeCmdLine and invert the metachar test's assertion (verbatim round-trip inside quotes, no bare metachar outside a quoted region) instead of expecting a caret before each one; add a "Program Files (x86)" path case since that's the one realistic production trigger and it currently fails. Do not touch prereqs.js or the finding_1 test fix again -- both confirmed correct.

OPERATIONAL NOTE (unrelated to code, recorded for continuity): the reviewer's own test-volume cleanup accidentally ran `diskutil unmountDisk force` on a whole-container basis, briefly unmounting and FileVault-locking /Volumes/_data (this repo's disk) mid-review. No data was lost; the user unlocked it and the orchestrator confirmed the repo and worktree were both intact afterward before continuing.
<!-- SECTION:NOTES:END -->
