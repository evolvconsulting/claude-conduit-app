---
id: NCOW-24
title: Bootstrapped pm2 daemon outlives the app and holds its own binary
status: In Progress
assignee: []
created_date: '2026-08-02 21:06'
updated_date: '2026-08-04 09:20'
labels:
  - pm2
  - windows
  - release
dependencies: []
priority: high
type: bug
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during NCOW-22's wave-6 review (2026-08-02), verified live on macOS (packaged) and Windows, and deliberately left out of NCOW-22's scope.

Since NCOW-22, when no pm2 daemon exists this app bootstraps one itself by spawning pm2's own lib/Daemon.js via ELECTRON_RUN_AS_NODE. That daemon is detached and long-lived by design (pm2's model), but it runs THIS APP'S OWN BINARY as its interpreter, and it outlives the app indefinitely:

- macOS, verified from a real packaged artifact: after quitting the app, the daemon reparented to pid 1 and lsof still showed it holding .../Claude Conduit.app/Contents/Frameworks/Electron Framework.framework/.../Electron Framework.
- Windows, verified: Win32_Process showed the daemon as electron.exe ...\\node_modules\\pm2\\lib\\Daemon.js.

Two consequences, neither yet tested:

1. NCOW-4 established 'closing the window hides it; quitting stops the proxy'. That is still true of the proxy, but it no longer implies no app-sized process is left running — one persists indefinitely, including after the app is uninstalled. This is a user-visible surprise (an Electron-weight process attributed to this app, still running long after 'quitting' it) and arguably a promise the README/DESIGN.md no longer keeps.

2. On Windows a running image is locked. This plausibly interferes with NCOW-10's auto-update path and with NSIS uninstall, both of which must replace or remove Claude Conduit.exe. The installer would have to kill the daemon to proceed — which would silently orphan litellm on port 4000, since stopping the supervisor is not the same as stopping what it supervises. Note NCOW-22 was itself discovered during NCOW-10.3's auto-update verification, so this is the same intersection that has already produced one real defect.

Relevant constraint: CLAUDE.md forbids 'pm2 kill' from this app, because pm2 runs against the shared default PM2_HOME (~/.pm2) and killing the daemon would stop every unrelated app the user supervises. Any fix must respect that — stopping OUR app only, never the shared daemon.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The behavior is characterized on Windows: determine empirically whether a running bootstrapped daemon actually blocks (a) an electron-updater/NSIS update that replaces Claude Conduit.exe and (b) an NSIS uninstall, rather than assuming either way
- [ ] #2 If it does block them, the update/uninstall path handles it without ever killing a daemon this app did not start, and without silently orphaning a running litellm on port 4000
- [ ] #3 The user-facing promise is made accurate: either the app no longer leaves an app-sized process running after quit/uninstall, or README/DESIGN.md and any in-app wording are corrected to state what actually persists and why
- [ ] #4 Whatever is decided is verified live on Windows against a real packaged build (the platform where the image-locking risk exists), not by code reading
- [ ] #5 CLAUDE.md's no-pm2-kill constraint is respected by the fix, and any new nuance is documented there
- [ ] #6 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Empirically characterize AC#1 on Windows via winvm before assuming the bootstrapped daemon blocks update/uninstall: reproduce the exact daemon-holds-own-binary spawn shape (ELECTRON_RUN_AS_NODE keep-alive against the installed exe) without touching the pre-existing shared pm2 daemon, and observe real copy/del/NSIS-silent-reinstall/NSIS-silent-uninstall behavior against it.
2. Based on empirical findings, decide the AC#3 judgment call (relocate the daemon's interpreter vs. document-only) rather than presupposing the answer.
3. Implement the fix, add regression tests, verify live on Windows against a real rebuilt packaged artifact, update documentation (README/DESIGN/CLAUDE.md/About dialog) to state accurately what persists and why, commit, push.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Worker implementation complete (branch fix/NCOW-24-daemon-outlives-app, commits e5a3fe5 + 67a5434, pushed).

AC#1/#4 (live Windows characterization): built a real dist:win NSIS installer/uninstaller natively on winvm. Reproduced the exact daemon-holds-own-binary spawn shape directly (ELECTRON_RUN_AS_NODE keep-alive holding the installed exe, byte-for-byte the same spawn shape spawnDaemon() uses) rather than fighting winvm's pre-existing shared pm2 daemon (which occupies pm2's hardcoded win32 named pipe regardless of PM2_HOME) -- the shared daemon (pid 8832) was never touched. With that process holding the exe: copy over it fails ('used by another process'), del fails ('Access is denied'), a real silent NSIS reinstall (/S) exits 0 but LastWriteTime never changes (silent no-op reporting success), and a real silent NSIS uninstall (/currentuser /S) exits 0, deletes every other file, deregisters the HKCU uninstall registry entry entirely -- but leaves the 225MB locked exe behind, still running, with no UI path to find it. Confirmed macOS was never functionally blocked (POSIX allows replacing a running executable's file), consistent with the original report.

Fix: resolveDaemonInterpreter() in src/engine/pm2Control.js copies the interpreter plus icudtl.dat/snapshot_blob.bin/v8_context_snapshot.bin (empirically required -- a bare exe copy alone crashed with 'Invalid file descriptor to ICU data received') into <pm2Home>/daemon-interpreter/ on win32/linux; spawnDaemon() hands the daemon that copy instead of the installed binary. Falls back to execPath unchanged on any copy failure. Skipped on darwin (unverified bundle layout, and macOS was never the blocked platform). Never kills anything -- the no-pm2-kill constraint is untouched.

Post-fix live re-verification on a rebuilt winvm artifact: with the keep-alive process running from the relocated copy, the original installed exe could be freely overwritten, and a full silent uninstall removed everything (directory gone entirely) while the still-running process was unaffected throughout. Shared daemon pid 8832 confirmed unchanged (dump.pm2) before and after.

AC#3 judgment call: the daemon still outlives the app (unavoidable given the no-pm2-kill constraint) and is still app-sized (a copy of Electron, not a lightweight helper) -- documentation route taken (README.md, DESIGN.md sec 7.4, CLAUDE.md, About dialog's 'Things to know') stating accurately what persists and why, rather than falsely implying the process is gone.

AC#6: 8 new tests in test/engine/pm2Control.test.js (copy / skip-redundant / re-copy-on-size-change / darwin-noop / failure-fallback for resolveDaemonInterpreter, plus 2 spawnDaemon integration tests). npm test: 290/290 locally (macOS) and on real Windows (18 pm2Control-relevant tests pass; 1 pre-existing unrelated failure caused by winvm's shared daemon occupying an un-guarded probe in that one test -- pre-existing gap, not introduced by this change, not present on a clean CI runner).

Files touched: src/engine/pm2Control.js, test/engine/pm2Control.test.js, README.md, DESIGN.md, CLAUDE.md, src/renderer/components/about-dialog.js.

Review pass 1 (opus): request_changes. Independently confirmed AC#2/#4/#6 live; AC#1/#3/#5 NOT confirmed -- reviewer found the recorded Windows characterization does not reproduce and multiple blocking/high defects in the fix itself.

BLOCKING findings:
1. The fix breaks pm2 daemon bootstrap on Linux (a shipped platform, x64+arm64): Electron's Linux binary needs libffmpeg.so (DT_NEEDED, RPATH=$ORIGIN) which is not in DAEMON_INTERPRETER_COMPANION_FILES, so the relocated copy cannot exec at all (ld.so failure before any code runs). Live A/B on a debian:12 container confirmed exit 127 without libffmpeg.so, exit 0 with it added. Worse: needsCopy only checks exe existence+size, so a broken copy is never repaired/retried -- every future cold-bootstrap on a daemon-less Linux machine fails permanently (the exact case NCOW-22 fixed). Fix: add libffmpeg.so to the companion-files list (confirmed sufficient + correct) or gate the whole relocation path to win32 only until Linux is separately verified live.
2. The recorded characterization that 'an NSIS update is blocked' does not reproduce -- reviewer ran a real NSIS silent upgrade (0.1.1->0.1.2) against a genuinely locked exe and it SUCCEEDED (NSIS renames the running image aside into %TEMP%\ns*.tmp\old-install\ and queues a delete via PendingFileRenameOperations; Windows permits renaming a running image). The worker's supporting evidence (same-version reinstall, LastWriteTime unchanged) was confounded -- reviewer ran the missing control (unlocked, zero processes, same-version reinstall) and got the identical unchanged-mtime result, since NSIS preserves archive timestamps regardless of locking. The UNINSTALL half IS real and reproduced (exit 0, registry deregistered, all other files deleted, locked 225MB exe left running with no pointer back to it) -- but it is also intermittent, since a preceding upgrade may already have moved the original exe aside. Corrected characterization: update -- NOT blocked; uninstall -- blocked, intermittently. This wrong claim is currently asserted as verified fact in pm2Control.js's doc comment, DESIGN.md sec 7.4, CLAUDE.md, README.md, about-dialog.js, and both commit messages -- all need correcting to the update-not-blocked / uninstall-intermittently-blocked framing before AC#1/AC#3 can be checked off.
3. needsCopy has no integrity check beyond exe size -- a partially-copied companion file (crash mid-copy, disk full, AV quarantine) is reused forever with no self-heal. Live-verified: removing icudtl.dat from an already-created copy dir does not trigger a re-copy on the next call, and launching the broken copy dies instantly (ICU data error, exitCode -2147483645). Recommend fixing in the same pass as finding 1 (same predicate).

Non-blocking, documented for the fix pass to address or explicitly defer:
4. (MEDIUM) ~227MiB is copied into the user's SHARED ~/.pm2 (227,649,168 bytes measured) and survives uninstall entirely undocumented -- neither NSIS nor src/engine/uninstall.js removes it; not listed in README's 'Where things live' table. A hard link was considered and rejected (would share the delete-disposition/inode, not free the original path on either OS) so the disk cost is inherent -- but should be documented and ideally cleaned up on uninstall if reachable.
5. (LOW, informational) The size-based staleness check never fires for this app's real upgrades -- 0.1.1 and 0.1.2 exes are both exactly 225,667,072 bytes (code lives in app.asar, not the exe) with different hashes; live-verified the copy stays stale-but-functionally-equivalent across a real upgrade. Benign today (same Electron version = still a valid interpreter) but worth a comment noting the size check is not a real staleness guarantee.
6. (LOW) README wording: one garbled sentence, and one sentence that inverts the logic of why pm2 kill is dangerous (presents shared blast radius as a reason it's SAFE to run, backwards).
7. (LOW) Two tests hard-code a Linux assumption that doesn't hold in reality (bare copy 'copies cleanly' on Linux; the real-spawn test uses plain node, not the actual Electron binary, so the suite structurally can't catch finding 1).
8. (out of scope, no action) Windows ARM64 NSIS build was independently observed to install incompletely (exit 0, but Claude Conduit.exe and arm64 DLLs absent) -- reproduced twice, not Defender/disk-space related, unrelated to this diff, possibly worth its own future task.

Scope/conventions: clean -- 6 relevant files, no drive-bys, commits match dev's real convention, no other CLAUDE.md hard constraint violated (no pm2 kill anywhere, about-dialog.js change is a single GOTCHAS string, windows.js/backgroundThrottling/sandbox/asarUnpack/files allowlist all untouched). AC#3 judgment call (document persistence rather than eliminate it) was independently evaluated as the right ROUTE on the merits -- alternatives (bundling a second plain node runtime, depending on a user-installed node, not bootstrapping at all) are all worse; the CONTENT of the docs needs correcting (findings 2+4), not the approach. Shared pm2 daemons on both this Mac and winvm (pid 8832) confirmed completely untouched throughout the review.

Fix pass 1 (worker, in response to review pass 1's request_changes) complete -- commit c0fd526 on fix/NCOW-24-daemon-outlives-app, pushed.

Finding 1 (Linux bootstrap broken) FIXED: added libffmpeg.so to DAEMON_INTERPRETER_COMPANION_FILES. Live-verified in a real x86_64 Ubuntu 22.04 Docker container against a genuine electron-v43.2.0-linux-x64 build: ldd confirmed libffmpeg.so unresolved pre-fix / resolved post-fix; actually executing the pre-fix companion set reproduced the exact reported exit-127 failure verbatim ('pm2 daemon process exited during bootstrap (code 127)'); the real pm2Control.js module then bootstrapped a genuine pm2 daemon end-to-end off the relocated copy post-fix (probeDaemonAlive() -> true).

Finding 2 (wrong Windows characterization) CORRECTED everywhere it appeared (pm2Control.js doc comment, DESIGN.md sec 7.4, CLAUDE.md, README.md, about-dialog.js) to: update -- NOT blocked (NSIS renames the locked image aside into %TEMP%\ns*.tmp\old-install\ and queues delete via PendingFileRenameOperations); uninstall -- blocked, intermittently (only when the exe hasn't already been relocated by a preceding upgrade). Re-verified live on winvm with real NSIS installers (0.1.1/0.1.2 built via npm run dist:win): locked-exe update succeeded exactly as the corrected doc now states; locked-exe uninstall on a fresh (never-updated) install left the 225,667,072-byte exe running with the Programs-and-Features entry deregistered, confirming the intermittent-block framing.

Finding 3 (no integrity check) FIXED: resolveDaemonInterpreter() now verifies every companion file exists at the destination (not just exe size) and stages the whole copy in a temp dir, atomically renamed into place only once every file succeeds. Live-verified on winvm's real filesystem: corruption-repair test (delete a companion file from a good copy -> next call restores it) and atomic-failure test (forced mid-copy failure -> falls back to execPath, prior good copy untouched, no leftover temp dir) both passed.

Finding 4 (227MiB undocumented persistence): documented in README's 'Where things live' table, DESIGN.md, CLAUDE.md. Cleanup from uninstall.js investigated and explicitly deferred with a code comment: uninstall.js cannot reliably determine whether the daemon currently at PM2_HOME is still using that exact copy as its running image, so deleting it there risks recreating the exact locked-file problem this fix solves, just relocated.

Finding 5 (staleness heuristic): one-line doc comment added noting the exe-size check is redundant-copy-avoidance, not true staleness detection.

Finding 6 (README wording): both the garbled pm2-ls sentence and the inverted pm2-kill-safety sentence fixed.

Finding 7 (test gaps): added a companion-file-list test using a realistic Linux fixture including libffmpeg.so, two new tests for the integrity/atomic-copy behavior, and a comment on the existing real-spawn test noting it structurally can't catch a finding-1-style regression (plain node, not genuine Electron), pointing at the new test that does.

Finding 8: no action (correctly out of scope).

npm test: 293/293. Shared pm2 daemons on both this Mac and winvm (pid 8832, dump.pm2 sha unchanged) confirmed untouched throughout. All winvm test artifacts (installed builds, verify dirs, old-install temp folder) cleaned up afterward.

Review pass 2 (opus): request_changes. Independently re-verified AC#1/#2/#4/#5/#6 (AC#3 withheld) with a DIFFERENT reproduction than pass 1/the fix worker (linux-arm64 instead of x64; genuine signed 0.1.0/0.1.1 release installers instead of dev-built ones; FileId/PendingFileRenameOperations tracking instead of LastWriteTime; a different companion file corrupted for the integrity test). All three of pass 1's blocking findings confirmed FIXED in the code:
- Finding 1 (Linux): confirmed live on linux-arm64 (a different shipped target than the fix worker's x64) -- old companion list exec fails exit 127 'libffmpeg.so...', new list runs a genuine pm2 daemon end-to-end (probeDaemonAlive() -> true, /proc/<pid>/exe pointing at the relocated copy).
- Finding 2 (Windows characterization): confirmed both halves independently -- update succeeds via rename-aside (same FileId relocated to %TEMP%\ns*.tmp\old-install\, new PendingFileRenameOperations entry, matches exactly), uninstall on a fresh install leaves the locked exe as the one file that survives (555->1) with the registry entry deregistered; intermittency confirmed (post-update, a subsequent uninstall removes everything).
- Finding 3 (integrity): confirmed on real win32 NTFS with a different corrupted file (v8_context_snapshot.bin) -- 5/5 repair cycles healed with zero temp leftovers; forced failure with a live holder falls back to execPath cleanly and heals next call once the holder exits.
- New tests confirmed NOT vacuous: reverting only the libffmpeg.so list entry fails test 23; running the new test file against the genuine pre-fix module fails tests 23/24/25.
npm test 293/293 independently re-run.

ONE narrow blocking finding remains (B1, documentation-only, AC#3): README's own bullets contradict each other -- one says the daemon-owned copy under ~/.pm2/daemon-interpreter/ 'cleans up like anything else' when 'running the uninstaller again (once nothing is using it)', while the very next bullet and the table both correctly say 'never deleted by an uninstall' / 'nothing removes it' (matching uninstall.js's own comment, which is accurate -- NSIS/uninstall.js never touches ~/.pm2 at all). Related: about-dialog.js's new GOTCHAS string says a fresh uninstall 'can still leave its locked binary behind until you run uninstall again' -- but the reviewer's own live run shows the uninstaller deletes itself as part of removing everything else, so 'run uninstall again' isn't reachable without a reinstall first. Two sentences to fix; the rest of AC#3's content (what persists, why, ~227MiB, corrected update/uninstall framing) was independently confirmed accurate.

Two LOW non-blocking findings recorded, no action required this pass: (N1) the integrity check is presence-only, not size/content-verified, so a truncated (not just missing) companion file is still accepted -- the atomic staging already eliminates this code's own ability to produce that state, so this is a residual, not a reproduced defect; (N2) on win32 a needed re-copy can't proceed while the existing copy is locked (rmSync fails), so it silently falls back to execPath for that one bootstrap attempt then self-heals later -- observed live, correctly self-limiting.

Shared pm2 daemons on both this Mac (pid 1479) and winvm (pid 8832) independently confirmed byte-identical/PID-identical before and after this review pass, same as pass 1.

Fix pass 2 (worker, in response to review pass 2's single B1 finding) complete -- commit a54d24a on fix/NCOW-24-daemon-outlives-app, pushed. Documentation-only, no code logic touched.

README.md's contradictory bullet ('running the uninstaller again ... cleans up like anything else') rewritten to 'which is never cleaned up by uninstalling, no matter how many times you run it' -- now consistent with the very next bullet and the table.

about-dialog.js's GOTCHAS string ('leave its locked binary behind until you run uninstall again') rewritten to state plainly that uninstall completes and deregisters cleanly, the daemon-owned copy under ~/.pm2/daemon-interpreter/ is what's left, with no in-app way to remove it -- drops the false 'run uninstall again' remedy the reviewer found unreachable.

DESIGN.md and CLAUDE.md checked for the same claim -- both already accurate, no changes needed.

npm test: 293/293, unchanged.

Review pass 3 (opus, FINAL -- retry budget was at its last allowed pass): approve. All 6 ACs independently confirmed: #3 (the one withheld in pass 2) verified directly this pass -- both contradicting sentences in README.md and about-dialog.js corrected and cross-checked consistent with DESIGN.md/CLAUDE.md/the uninstall.js comment, no new overclaim introduced; #1/#2/#4 confirmed by combining this pass's doc read with the prior two passes' already-independently-verified live evidence (not redundantly re-run); #5/#6 verified directly (grep confirms no pm2 kill in src/, npm test 293/293). Scope confirmed clean: fix pass 2's commit (a54d24a) touches exactly the 2 files/2 sentences disclosed, cumulative diff still the same 7 files as review pass 1. Three non-blocking observations recorded, none blocking: about-dialog.js's daemon-interpreter mention is technically win32/linux-only but correctly scoped by its own leading clause; README's bullets 2/3 are now redundant (both correctly say never-cleaned-up) rather than contradictory; CLAUDE.md's stale '178 tests' claim (real count now 293) is pre-existing drift from many earlier waves, not introduced here.
<!-- SECTION:NOTES:END -->
