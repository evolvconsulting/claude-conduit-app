---
id: NCOW-57
title: Verify and fix tray notification deliverability on Windows and Linux
status: In Progress
assignee: []
created_date: '2026-08-06 18:16'
updated_date: '2026-08-07 11:48'
labels: []
dependencies:
  - NCOW-55
ordinal: 70000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-55 gave the tray a native OS Notification for wedged Start/Stop/Restart calls. The wave-14 integration review found the app has never called Electron's `app.setAppUserModelId()` anywhere (`grep -rn "setAppUserModelId" src/ package.json` — zero hits). Per Electron's own notifications documentation, Windows notifications need a Start Menu shortcut carrying an AppUserModelID + ToastActivatorCLSID; in production Electron auto-calls `app.setAppUserModelId()`, but a `npm run dev`/source run typically needs it called explicitly, and `electron-builder.yml`'s `win.target` includes `portable` alongside `nsis` — a portable exe installs no Start Menu shortcut at all, so the toast has no AUMID to bind to there either.

`Notification.isSupported()` (the guard NCOW-55 added before constructing a Notification) does not detect either of these conditions — it returns `true` on Windows regardless of AUMID/shortcut state, and also returns `true` on macOS when the user has denied notification permission or has Do Not Disturb on. So NCOW-55's own docstring claim that "a platform/session where it's unsupported just falls back to the console.error trail alone" is narrower in practice than it reads: there are real, currently-unhandled cases where a notification silently fails to appear with no fallback trail at all.

This has never been verified live on Windows or Linux (only informally reasoned about from documentation).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 app.setAppUserModelId() is called appropriately for Windows dev/source runs — either matching Electron's own guidance or deliberately deviating from it with the deviation and its reason documented in the code — so that a Windows dev run's tray notification is accepted and recorded by Windows under an AUMID matching the installed Start Menu shortcut. AMENDED 2026-08-07 (user decision, wave 16): the original wording said "so tray notifications actually appear on a Windows dev run"; pixel-level banner capture proved unobtainable on winvm across four capture strategies, so the standard is acceptance-plus-AUMID-correctness, matching the dispensation already granted to AC#4 for Linux.
- [ ] #2 Decide and implement a mitigation for the portable Windows build target (electron-builder.yml's win.target includes portable, which installs no Start Menu shortcut/AUMID) — either exclude notifications from that target gracefully, or document why it's an accepted gap
- [ ] #3 Live-verified on winvm that a wedged tray Start/Stop/Restart notification is ACCEPTED AND RECORDED BY WINDOWS under an AUMID matching the installed Start Menu shortcut, in both the nsis-installed and portable configurations, and that the portable target's missing-shortcut gap is documented. AMENDED 2026-08-07 (user decision, wave 16): the original wording required "a real, visible Windows toast notification"; pixel-level banner capture is unobtainable in this VM, so visible-banner proof is replaced by OS-recorded acceptance plus AUMID correctness.
- [ ] #4 Live-verified on a Linux desktop environment: a wedged tray action produces a real, visible notification, or the absence is confirmed and documented. CLARIFIED 2026-08-07 (user decision, wave 16): a captured org.freedesktop.Notifications.Notify call accepted by gnome-shell — the actual renderer — satisfies "visible" on a host where pixel proof is environmentally impossible (GNOME 50 denies the Shell Screenshot API; no gnome-screenshot/grim installed).
- [ ] #5 All pre-existing tests continue to pass unmodified and npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Research Electron's current app.setAppUserModelId()/Notification guidance and
   electron-builder's win.target `portable` behavior via Context7 rather than memory.
2. Extract a pure, unit-testable shouldSetAppUserModelId({platform, isPackaged}) into a new
   src/main/appUserModelId.js; wire src/main/index.js to call
   app.setAppUserModelId(process.execPath) before app.whenReady(), gated on win32 && !isPackaged
   (matching Electron's own documented example and rationale). [AC#1]
3. Add test/main/app-user-model-id.test.js: direct tests of the pure function plus static
   source-text checks on index.js, following this project's established pattern for a file that
   cannot be require()d under plain node --test.
4. Decide AC#2 from LIVE evidence rather than documentation: build BOTH Windows targets (nsis and
   portable) on winvm and drive the real packaged process's real createTrayActions().onStart()
   failure path in each, comparing OS-level notification registration between them.
5. Do the equivalent on linuxvm against the real GNOME/Wayland session, capturing the app's own
   org.freedesktop.Notifications.Notify call with dbus-monitor. [AC#4]
6. Document whatever the live comparison actually shows in electron-builder.yml, and correct any
   claim in src/main/tray.js that the evidence contradicts — then sweep the repo for every
   restatement of that same claim.
7. npm test before and after; two logical commits; push.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Wave-16 implementation evidence (worker, pre-review)

Branch `feat/NCOW-57-tray-notify-deliverability`, based at `09cbdd98bbeba7ff04c48fad28ee442e783793a2`.
Commits: `69949426339c55e88f0f6d1aeaf83d4d0b84b16c` (setAppUserModelId), `7448bc2724c94d9b7edc6dd8e52286145f2043b4` (portable-target finding).
Diff vs dev: 5 files, +185/-0 — electron-builder.yml, src/main/appUserModelId.js (new),
src/main/index.js, src/main/tray.js, test/main/app-user-model-id.test.js (new).

**AC#1.** index.js now calls app.setAppUserModelId(process.execPath) before app.whenReady(),
gated by shouldSetAppUserModelId({platform, isPackaged}). Non-vacuity proved by reverting: with
the call removed, `node --test test/main/app-user-model-id.test.js` gives 7 tests / pass 4 /
fail 3 (the 3 static-wiring assertions fail; the 4 pure-function tests correctly still pass,
since appUserModelId.js itself was untouched by the revert). Restored -> pass 7 / fail 0.
Novelty: neither the module nor the tests existed before this task.

**AC#2.** Decided from live comparison, not documentation. `npm run dist:win` (electron-builder
26.15.3) produced both `Claude Conduit Setup 0.1.1.exe` (nsis) and `Claude Conduit 0.1.1.exe`
(portable). Both were driven live (see AC#3) and showed IDENTICAL AUMID
(`electron.app.Claude Conduit`, Electron's own productName-derived default) and identical
notification-registration behavior. No runtime exclusion was therefore added; the finding is
documented in electron-builder.yml's `win` section and cross-referenced from tray.js and
appUserModelId.js. Deliberately kept narrow so as not to pre-empt NCOW-58.

**AC#3 (winvm, Windows 11 Pro).** nsis installed silently (/S); confirmed the installed exe under
AppData\Local\Programs\Claude Conduit\ and a real Start Menu shortcut .lnk. Launched into the
ACTIVE CONSOLE SESSION (session 1) via `schtasks ... /IT`, with NIM_PROXY_TEST_HOME + --dev.
Attached a Node Inspector (--inspect=9229) to the real running main process, required the real
tray.js from app.getAppPath(), and called createTrayActions(...).onStart() with a synthetic
NOT_CONFIGURED failure. Observed
`{"isPackaged":true,"platform":"win32","appPath":"...\\resources\\app.asar","result":{"ok":false,"error":{"code":"NOT_CONFIGURED","message":"Run setup first."}}}`.
Portable repeated the same procedure; app.getAppPath() resolved into the self-extracted temp dir,
isPackaged:true, same result. OS-level evidence for BOTH: Windows itself created/updated
`HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Notifications\Settings\electron.app.Claude Conduit`,
with LastNotificationAddedTime (FILETIME 134305482092933723) converting to 2026-08-06 22:50:09
local — the exact second of the nsis run — and PeriodicNotificationCount incrementing.
**REPORTED LIMITATION, not a pass claim:** pixel-level toast-banner proof was NOT obtained for
either target despite four capture strategies (plain screenshot; an 8-10 frame burst spanning the
expected banner duration; Notification Center via Win+N; minimize-all to rule out Focus Assist
fullscreen suppression). Reported honestly as unresolved, plausibly a VM display/compositor
issue, and left for the reviewer to weigh against AC#3's literal "visible" wording.

**AC#4 (linuxvm, GNOME 50.1 Wayland, session 1 active).** Required XAUTHORITY from
/run/user/1000/.mutter-Xwaylandauth.* — discovered empirically after a first attempt failed with
"Missing X server or $DISPLAY"; this was NOT in the dispatch brief. Ran `electron . --dev
--no-sandbox` from source with NIM_PROXY_TEST_HOME, via a harness requiring the real
src/main/tray.js and calling the real createTrayActions().onStart(). Concurrent
`dbus-monitor --session "interface='org.freedesktop.Notifications'"` captured the real Notify
call: app_name="Electron", summary="Claude Conduit", body="Start failed: Run setup first." —
delivered to gnome-shell, which owns org.freedesktop.Notifications
(GetServerInformation -> ('gnome-shell','GNOME','50.1','1.2')). Pixel proof unavailable by
environment (GNOME 50 denies the Shell Screenshot API; gnome-screenshot/grim absent) — that is
the documented-absence branch for PIXEL PROOF specifically, not for the notification path, which
was positively verified.

**AC#5.** Baseline before any change: npm test -> 476 tests, pass 476, fail 0. Final: 483 tests,
pass 483, fail 0 (476 pre-existing + 7 new, all in a new file; zero pre-existing test files
touched).

**Claim sweep (mandatory per campaign policy).** Swept
`grep -rn "falls back to\|unsupported\|isSupported" src/ test/` for restatements of the
overbroad tray.js claim that was corrected. Only other hits are in test/main/tray-actions.test.js,
which assert the actual mechanism (skip-without-throwing when isSupported() === false) rather
than restating the overbroad claim. Nothing further needed correcting.

**Worker-declared interpretations and side effects, carried forward for review:**
1. Code reached both hosts by rsync/scp (tar+scp on winvm, which lacks rsync) of the worktree
   excluding node_modules/.git/.env, not git clone. The worker reports that .env was
   inadvertently swept into the FIRST tar and was deleted from both hosts before use.
2. Verification drove the real createTrayActions().onStart() through a Node Inspector rather than
   literally clicking a native tray menu (no interactive click automation on Windows; vanilla
   GNOME has no tray-icon support without an extension, so a tray icon may not render on linuxvm
   at all). Stated explicitly as a faithful proxy, not a silent substitution.
3. On winvm, `taskkill /F /IM "Claude Conduit.exe" /T` (clearing the nsis instance so the
   portable exe's requestSingleInstanceLock() would not silently no-op) incidentally also killed
   the pm2 daemon, because pm2 spawnDaemon()'s private interpreter copy is named identically to
   the app binary (this project's own NCOW-22/24 design). Disposable test VM, no other apps on
   that PM2_HOME. Flagged because CLAUDE.md treats killing the shared pm2 daemon as a hard never
   FOR THE APP — this was an incidental manual OS-level taskkill during cleanup, not app code.
4. The NSIS uninstaller (/S) reported success but left the whole app directory behind; cleaned up
   manually. Out of NCOW-57 scope, not investigated.

## Wave-16 review verdict (opus, pass 1): request_changes — confirmed AC #5 only

Reviewer independently re-ran the gate (483/483, matching) and confirmed AC#5. It did NOT confirm
AC#1-#4. It also independently corroborated that the implementer's remote work was REAL, not
fabricated (FILETIME 134305482092933723 decodes to 2026-08-07T03:50:09Z; winvm is Central, giving
2026-08-06 22:50:09 local, exactly as reported; linuxvm's npm debug log and a
`Started app-electron-2852039.scope` journal entry corroborate the Electron run in the live GNOME
session). Cleanup on both hosts confirmed complete.

**Blocking findings.**

1. `src/main/appUserModelId.js:7-9` — the Electron quote is truncated in a way that removes its
   condition. Verified against electron v43.2.0 `docs/tutorial/notifications.md:107-109`, whose
   real sentence is "In production, Electron will also **detect that Squirrel was used** and will
   automatically call app.setAppUserModelId()...". This app packages with electron-builder
   nsis/portable, NOT Squirrel — so the doc does not say the packaged case is handled. This
   elision is the entire justification for the `!isPackaged` gate at line 44.
2. `src/main/appUserModelId.js:13-16`, restated at `test/main/app-user-model-id.test.js:11-13` —
   "so a Windows dev/source run ... had no AUMID at all" is FALSE. Electron's
   `GetRawAppUserModelID()` (`shell/common/application_info_win.cc:55-70`) always generates
   `electron.app.<ProductName>` when none was set explicitly. What is actually missing is a
   MATCHING START MENU SHORTCUT, not an AUMID. Also a false counterfactual: the pre-fix Windows
   dev state was never run. Note this is a NEW claim introduced by this branch, stated in two
   places — fixing it requires fixing both.
3. `electron-builder.yml:57-89` — the documented AC#2 conclusion is not supported by the evidence
   and is contradicted by its own recorded facts. Reviewer verified in this repo's own
   `node_modules`: `app-builder-lib/templates/nsis/include/installer.nsh:200` does
   `WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"` and
   `app-builder-lib/out/targets/nsis/NsisTarget.js:160` sets `APP_ID: appInfo.id`, so the nsis
   Start Menu shortcut carries **com.evolvconsulting.claudeconduit**. The running packaged process
   used **electron.app.Claude Conduit** — Electron's lazy fallback, which fires only when nothing
   set an explicit AUMID. **These do not match, on the nsis target too.** Separately,
   `grep -rn "ToastActivator\|CLSID" node_modules/app-builder-lib/templates/nsis/` returns ZERO
   hits — electron-builder writes no ToastActivatorCLSID for either target. So "nsis and portable
   behaved identically, therefore portable needs no mitigation" cannot distinguish "both work"
   from "both fail identically", and there is now a source-verified mechanism making "both fail" a
   live hypothesis. The real axis is packaged-vs-Squirrel, affecting BOTH Windows targets — not
   portable-vs-nsis.
4. `src/main/index.js:23-25` / AC#1 — the added code path has never executed in ANY live run. The
   gate is `win32 && !isPackaged`; both winvm runs were `isPackaged: true` and linuxvm was linux.
   AC#1's wording is specifically about a Windows DEV run.

**Non-blocking.** Electron's dev recipe has two halves — call `setAppUserModelId(process.execPath)`
AND pin `node_modules\electron\dist\electron.exe` to the Start Menu
(`notifications.md:111-118`); the branch mentions only the first, so "so tray notifications
actually appear on a Windows dev run" overstates what the code alone achieves. The corrected
`src/main/tray.js:224-249` claim is itself accurate and well-scoped, but its Windows recap
inherits AC#2's unsupported reading. Merge-order risk: NCOW-59 edits the same tray.js docblock
region. **Nit:** the attributed electron-builder glossary quote at `electron-builder.yml:58-60`
could not be located in any reachable electron-builder docs source — the substantive claim
(portable creates no Start Menu shortcut) is true, the attribution is unverified.

**Failure-class check.** Instance-vs-claim: reviewer ran its own sweep, found no surviving
restatement of the CORRECTED claim (README/DESIGN have zero notification mentions), but the branch
introduces a NEW false claim in two places. False guards: CLEAN — both guard comments verified by
experiment and both are real guards. Fabricated specifics: MIXED — most concrete specifics
verified real, one unverifiable attribution, two false claims. False counterfactuals: HIT (see #2).
Relative git refs: CLEAN.

**Test verification (reviewer's own).** npm test 483/483. Non-vacuity A: removing the guard block
and import from index.js gives 4 pass / 3 fail, reproducing the implementer's figures exactly.
Non-vacuity B: loosening the gate to `return platform === 'win32'` gives 6 pass / 1 fail.
Guard-by-experiment C: moving the block after `app.whenReady()` fails test 7 only — real guard.
Guard-by-experiment D: changing the argument to the appId fails tests 6 and 7 — real guard.
Novelty: the 4 logic tests cover a brand-new module; the 3 static-source tests reuse
`test/main/index.test.js`'s documented INDEX_SOURCE technique but assert different things, not
verbatim copies. Worktree confirmed restored to committed state (clean status, empty stash).

**.env exposure (risk #4).** Nothing in the committed diff contains any secret and no .env is
tracked. Residual-risk probe: linuxvm `find / -name ".env" -newermt "2026-08-05"` -> no hits, and
the working tree is deleted. winvm recursive search returned exactly one hit,
`C:\Users\jdnewhouse\AppData\Roaming\claude-conduit\litellm.env`, dated 2026-08-02 — a
PRE-EXISTING real install from an earlier wave, not from this task. This task's copies are gone.
Flagged separately for the user: that pre-existing file is a real app config that may hold live
credentials; it predates NCOW-57 and rotation/removal is the user's call, out of scope here.

**Escalated to the user (decide-vs-defer: product/architecture-level, not the reviewer's to guess).**
The reviewer states the packaged-Windows AUMID question "needs a human call, not a worker's
judgement": either call `app.setAppUserModelId(<appId>)` unconditionally so the runtime AUMID
matches the shortcut electron-builder already writes (changes the gate, requires re-verification),
or explicitly accept and document that Windows toasts may not render for EITHER packaged target
with `console.error` as the only guaranteed surface. The current branch silently picks neither
while documenting that there is no problem. Separately, AC#4 needs a human ruling on whether
captured D-Bus delivery to gnome-shell satisfies "visible" on a host where pixel proof is
environmentally impossible.

## User decisions on the wave-16 escalation (AskUserQuestion, 2026-08-07)

1. **Windows AUMID — RESOLVED: set it to the appId unconditionally on win32.** Call
   `app.setAppUserModelId('com.evolvconsulting.claudeconduit')` on Windows for BOTH packaged and
   dev/source runs, so the runtime AUMID matches the AUMID electron-builder's NSIS installer
   already binds to the Start Menu shortcut. The `!isPackaged` gate is dropped. Portable still
   installs no shortcut, so its gap is to be documented honestly as a real, named gap rather than
   dismissed as "no difference observed". Requires re-verification on winvm.
2. **AC#4 evidence standard — RESOLVED: a captured `org.freedesktop.Notifications.Notify` call
   accepted by gnome-shell (the actual renderer) satisfies "visible" on a host where pixel proof
   is environmentally impossible.** Recorded here so it is not relitigated. GNOME 50 denies the
   Shell Screenshot API and neither gnome-screenshot nor grim is installed on linuxvm.
3. **The pre-existing `C:\Users\jdnewhouse\AppData\Roaming\claude-conduit\litellm.env` on winvm
   (dated 2026-08-02, from an earlier wave's real install, NOT from NCOW-57)** — user elected to
   be informed only; no action taken by this campaign. Out of NCOW-57's scope either way.
4. Session budget: continue into a wave 17 (NCOW-58 + NCOW-59) after NCOW-57 settles.

## Wave-16 fix pass 1 (fresh worker) — implemented, commit `6779c3c00c1c6f5add4c7285c6123f2c92e2611a`

Implements the user's DECISION 1 (unconditional win32 AUMID = appId) and addresses all four
blocking findings, both non-blocking findings, and the nit.

**Claims corrected at the claim level, both places each.** The worker independently re-fetched the
two disputed sources from `raw.githubusercontent.com/electron/electron/v43.2.0/` rather than
trusting the reviewer's quotes, and confirmed both at the exact cited lines: the full
`notifications.md:107-109` sentence including "also detect that Squirrel was used", and
`application_info_win.cc:55-70`'s `GetRawAppUserModelID()`. Sweeps run for each corrected claim
across `src/`, `test/`, README/DESIGN/CLAUDE, `archive/`, and the Backlog task/doc files; the only
restatements were the two the reviewer already cited. Backlog files' own phrasing ("no
`app.setAppUserModelId()` call anywhere") was checked and is literally true, so left alone.

**Design.** `shouldSetAppUserModelId({platform})` is now `platform === 'win32'`, unconditional;
`APP_USER_MODEL_ID = 'com.evolvconsulting.claudeconduit'` is an exported constant; `index.js` calls
`app.setAppUserModelId(APP_USER_MODEL_ID)`. A new drift-guard test regex-extracts `appId` from
`electron-builder.yml` and asserts it equals the runtime constant, so the two cannot silently
diverge. `electron-builder.yml`'s `win:` prose was rewritten end to end: it now states only what
was observed, names explicitly what the evidence CANNOT distinguish (accepted-but-suppressed vs.
genuinely displayed; creation vs. activation, since no `ToastActivatorCLSID` is written for either
target — re-verified, zero grep hits), and names portable's shortcut-less gap as a real, still-open
gap rather than something the testing ruled out. The unlocatable glossary quote was removed
entirely. `tray.js`'s recap gained a fix-pass paragraph naming the AUMID mismatch; the worker
proved that edit comment-only by esprima token-stream diff (901 tokens before and after, identical).

**AC#2/#3 — the mismatch is closed. Four values now agree, each read live on winvm:**
- Start Menu shortcut AUMID, read via `Shell.Application` COM `ExtendedProperty('System.AppUserModel.ID')` on the real installed `Claude Conduit.lnk`: `com.evolvconsulting.claudeconduit`
- nsis packaged runtime AUMID: `com.evolvconsulting.claudeconduit`
- portable packaged runtime AUMID: `com.evolvconsulting.claudeconduit`
- source/dev run runtime AUMID: `com.evolvconsulting.claudeconduit`
(pre-fix the runtime value was Electron's fallback `electron.app.Claude Conduit`.)

**AC#1 now has live evidence** — the gap BLOCKING 4 named. A genuine UNPACKAGED source run on
winvm (`electron.app.isPackaged` read as `false` over CDP) carried
`--app-user-model-id=com.evolvconsulting.claudeconduit` on its renderer command line, and a real
Notification fired through the actual `onStart()` failure path landed in
`HKCU\...\Notifications\Settings\com.evolvconsulting.claudeconduit` with
`LastNotificationAddedTime=134305545388759018`.

**AC#4 evidence is now first-hand verifiable** — preserved at
`/home/jdnewhouse/ncow57-evidence/dbus-capture-ncow57-fixpass.log` on linuxvm (the previous pass
deleted its tree, which is why the reviewer could only corroborate circumstantially). The capture
shows the app's own `Notify` (`sender=:1.235` = PID 3512849 = the electron process) with
`body="Start failed: ncow57-verify-live-test-source"`, forwarded `:1.33` -> `:1.24`; destination
PIDs independently confirmed via `GetConnectionUnixProcessID` as gjs
`org.gnome.Shell.Notifications` (2373) and `/usr/bin/gnome-shell --mode=ubuntu` (2198).

**AC#5** — 485/485 locally (476 pre-existing + 9 new; the new file grew 7 -> 9 tests). Zero
pre-existing test files touched. Guard proofs: non-vacuity by reverting the function (1/9 fail) and
the call site (2/9 fail); guard-by-experiment by drifting `electron-builder.yml`'s appId (drift
test fails) and by drifting the constant instead (same test fails); novelty confirmed — no other
test asserts `appId` (`app-identity.test.js` reads productName, `licenses.test.js` the files
allowlist).

**INCIDENT — a real, pre-existing, out-of-scope bug, discovered and reported by the worker itself.**
Running `npm test` on winvm (a sanity check, not required) overwrote the REAL
`%APPDATA%\claude-conduit` config files. Cause: `test/main/engine-context-config-regen.test.js`
calls `paths.resolveConfigDir({homedir: homeDir})` and `createEngineContext()` WITHOUT threading
`paths.resolveWindowsAppDataOverrides()` — exactly the NCOW-23 failure class already fixed in
production code but never fixed in this test file. On a real Windows host the win32 branch prefers
`APPDATA` over a bare homedir override, so the test silently resolves to the real config dir.
Content was overwritten, nothing deleted. **Security de-escalation:** the `litellm.env` the reviewer
flagged as possibly holding a live key contained `NVIDIA_NIM_API_KEY=nvapi-old-install` — a
hardcoded fixture from that same test file (confirmed by grep), present both before and after,
which also proves this bug had already fired at least once in an earlier wave. It was never a real
secret. The worker did not modify that test file (AC#5 forbids touching pre-existing tests) and did
not re-run `npm test` on either remote host afterward.

## Wave-16 review verdict (opus, pass 2): request_changes — confirmed AC #2, #4, #5

Reviewer re-verified independently rather than inheriting pass 1's conclusions, and corroborated
the fix worker's remote evidence FIRST-HAND rather than on trust.

**AC#2 CONFIRMED.** Every load-bearing citation re-checked in this worktree's own node_modules:
`grep -rn "SetLnkAUMI" node_modules/app-builder-lib/` hits ONLY
`templates/nsis/include/installer.nsh` (lines 200, 209, 225, 232, 240) — nothing for portable;
`APP_ID: appInfo.id` at `out/targets/nsis/NsisTarget.js:160`; `ToastActivator|CLSID` across the
nsis templates returns zero hits, so "no ToastActivatorCLSID for either target" is true. The gap
is named real, open and unmitigated at `electron-builder.yml:59-66` and
`src/main/appUserModelId.js:71-79`. Glossary quote gone.

**AC#4 CONFIRMED, first-hand.** Reviewer read the preserved capture over ssh (66 lines) and then
resolved the bus names live itself via `GetConnectionUnixProcessID`: `:1.33` -> 2373 =
`/usr/bin/gjs -m /usr/share/gnome-shell/org.gnome.Shell.Notifications`, `:1.24` -> 2198 =
`/usr/bin/gnome-shell --mode=ubuntu`. Every PID in the worker's claim checked out.

**AC#5 CONFIRMED.** Reviewer's own npm test: 485/485. `git diff --diff-filter=M` over `test/` is
empty — zero pre-existing test files modified.

**AC#1 NOT CONFIRMED (narrowly).** The implementation half is fully verified
(`src/main/index.js:20-22`, `src/main/appUserModelId.js:104`). Two wording problems block it:
(a) `src/main/appUserModelId.js:80-87` misquotes Electron's dev callout by dropping its argument —
the real recipe at v43.2.0 is `app.setAppUserModelId(process.execPath)`, so the branch's rendering
("This function is the second half only") is false, since the branch deliberately supplies the
appId instead. **This is a verbatim recurrence of pass 1's B1 class, introduced BY THE FIX PASS,
in the same file, in text written to close the related non-blocking finding.**
(b) The reviewer found live on winvm that the dev configuration that actually worked required a
pin AND an explicit AUMID stamp: `%APPDATA%\...\Start Menu\Programs\Electron.lnk` (target
`...\node_modules\electron\dist\electron.exe`) carries
`System.AppUserModel.ID = com.evolvconsulting.claudeconduit`. Control reads
(`File Explorer.lnk` -> `Microsoft.Windows.Explorer`, `OneDrive.lnk` -> `Microsoft.SkyDrive.Desktop`)
show these are explicitly stamped, so a bare "Pin to Start" does NOT yield the appId. That
prerequisite is documented nowhere in the branch — a developer following the committed comment
would not reproduce the working setup.

**AC#3 NOT CONFIRMED.** Judged on its own terms (the user's AC#4 dispensation was explicitly not
extended to it): the branch does not demonstrate a VISIBLE toast in either configuration, and says
so itself at `electron-builder.yml:88-96`. What IS established is AUMID correctness plus OS
acceptance, and the reviewer corroborated that independently: the winvm registry key
`HKCU\...\Notifications\Settings\com.evolvconsulting.claudeconduit` still exists, and its
`LastNotificationAddedTime` (`REG_QWORD 0x1dd262e944317ea` = 134305545388759018) matches the
worker's reported value digit for digit, decoding to 2026-08-07T05:35:38Z. Reviewer deliberately
did NOT rebuild winvm: pixel proof was already established unobtainable in that VM, and no rebuild
converts "accepted" into "visible".

**Findings.** BLOCKING: `src/main/appUserModelId.js:80-87` (the misquote above). NON-BLOCKING:
`test/main/app-user-model-id.test.js:109`'s drift regex `/^appId:\s*(\S+)\s*$/m` captures the
quotes on a legitimately quoted YAML value — reviewer proved it by quoting the value and watching
the test fail; it fails SAFE (never a false pass), so it is a false-alarm risk only. NIT (host
hygiene, not the branch): winvm cleanup left `Electron.lnk` pinned to a now-deleted path plus the
notification registry key.

**Scope: CLEAN.** README/DESIGN still have zero notification mentions (NCOW-58 unpre-empted).
Reviewer ran the esprima token-stream diff on `tray.js` ITSELF: 901 tokens both sides, streams
byte-identical — so NCOW-59's tray.js code surface is untouched. electron-builder.yml is
comment-only. No drive-bys. No relative git refs anywhere in committed text.

**Pass-1 findings status.** B1 genuinely fixed (full Squirrel sentence, exactly doc lines 107-109).
B2 genuinely fixed in both places; reviewer verified `GetRawAppUserModelID()` is exactly
`application_info_win.cc:55-70` and `kAppUserModelIDFormat[] = L"electron.app.$1"` is line 24.
B3 genuinely fixed. B4 genuinely fixed. Dev-recipe non-blocking PARTIALLY fixed (now mentioned but
mis-stated — the blocking finding). tray.js recap non-blocking genuinely fixed. Nit fixed.

**Failure-class check.** (1) Instance-vs-claim: **FAIL** — old claims swept clean, but the fix pass
introduced a NEW false claim of the same class (appears once, not restated). (2) Bogus guard: PASS.
(3) Fabricated specifics: PASS, strongly — reviewer independently reproduced the registry timestamp
exactly, both Electron source citations at the named tag and line ranges, all three node_modules
citations, and successfully executed the `System.AppUserModel.ID` COM read. (4) False
counterfactual: **PASS — it was OBSERVED, not inferred**; `git show 7448bc2:electron-builder.yml`
records the original pass observing `electron.app.Claude Conduit` live. (5) Relative git refs: PASS.

**Test verification (reviewer's own), 8 experiments each with restore.** Baseline new file 9/9;
revert fn to `return false` -> 2 fail; restore the `win32 && !isPackaged` gate -> 1 fail; delete
the index.js call site -> 2 fail; drift the yml appId -> 1 fail; drift the constant -> 1 fail;
**delete the appId line entirely (vacuity probe) -> 2 fail** (so the drift guard is not vacuous);
quote the yml value -> 1 fail (the fails-safe false alarm above). Novelty: `grep -rn "appId" test/`
hits only the new file. Worktree confirmed restored, `git status --porcelain` empty, HEAD
`6779c3c00c1c6f5add4c7285c6123f2c92e2611a`.

**Incident adjudicated: REAL, and genuinely PRE-EXISTING.** Mechanism confirmed statically —
`src/engine/paths.js:59-62`'s win32 branch is `opts.appData ?? process.env.APPDATA ?? path.join(homedir, ...)`,
so a homedir-only override loses to `%APPDATA%`, which is always set on Windows.
`test/main/engine-context-config-regen.test.js:90` calls `paths.resolveConfigDir({homedir: homeDir})`
with no `appData`, then `generateAll()` writes config.yaml/litellm.env/run.js/manifest.json into the
REAL config dir; line 256 does the same and overwrites the real manifest.json. **De-escalation
confirmed:** `nvidiaApiKey: 'nvapi-old-install'` is a hardcoded fixture at that file's line 100
(also `configGen.test.js:534`) — no live key was ever written. **Not introduced here:** the file is
byte-identical to the wave base and last changed in `e79d8ff`. **One correction to the worker's
account:** `createEngineContext()` DOES thread the overrides correctly via `engine-context.js`'s
`resolveWindowsTestOverrides()`; the bug is solely the test's own two direct `resolveConfigDir`
calls. Recommended follow-up scope is narrow: thread `paths.resolveWindowsAppDataOverrides(homeDir)`
into both call sites (lines 90, 256); the reviewer's sweep found NO other offenders suite-wide, and
it suggests a cheap suite-wide guard since CLAUDE.md documents this class as recurring.
<!-- SECTION:NOTES:END -->
