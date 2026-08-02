---
id: NCOW-10.3
title: Verify real end-to-end auto-update on Windows and/or Linux
status: In Progress
assignee: []
created_date: '2026-08-02 01:08'
updated_date: '2026-08-02 14:51'
labels: []
dependencies:
  - NCOW-20
parent_task_id: NCOW-10
priority: high
type: task
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
With the in-app checker + proxy-restart handling (NCOW-10.1) and the CI release workflow (NCOW-10.2) in place, prove the auto-update path actually works end to end: install an older built version of the app, publish a newer real (unsigned) GitHub Release via the CI workflow from NCOW-10.2, and confirm the older install detects, downloads, and installs the update automatically on at least one of Windows or Linux (neither platform requires signing for electron-updater to function — see NCOW-10.1). Also confirm the LiteLLM proxy behaves as defined across the update/restart.

This step publishes a real, unsigned GitHub Release of this app on evolvconsulting/claude-conduit. That is an explicit, already-confirmed choice by the user at this campaign rounds init (see doc-4, Backlog campaign tracker) — proceed without re-asking, but narrate the release-publish step clearly since it is externally visible.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On a platform where silent/auto-update is possible (Windows and/or Linux), an installed older version actually downloads and installs a newer version end-to-end, observed live rather than inferred from code
- [ ] #2 Verified by installing an older built version and updating it to a newer one on at least one platform, with evidence captured (steps taken, before/after version numbers, logs)
- [ ] #3 The LiteLLM proxys defined restart behavior (from NCOW-10.1) is confirmed to hold across a real update
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Retry plan (wave 5, after the privacy blocker was resolved and NCOW-20's Windows litellm bugs were fixed): 1. Check current state on winvm (v0.1.0 still installed? config intact?). 2. Fully quit and relaunch the installed v0.1.0 app so a fresh startup update-check fires against the now-public repo. 3. Drive the app live via CDP (--remote-debugging-port tunneled over SSH) to observe the update flow and trigger install. 4. Confirm relaunched app reports v0.1.1. 5. Get litellm actually running on Windows (now possible with NCOW-20 merged) and confirm the proxy survives/restarts across the real update (AC#3). 6. Capture evidence, clean up VM scaffolding, no new releases to publish (v0.1.0/v0.1.1 already exist).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
WORKER RESULT: status=blocked (on AC#1/#2's core success path), branch feat/NCOW-10.3-e2e-auto-update-verification pushed @ 64ed0fe (version bump 0.1.0->0.1.1 only, npm test 220/220 both before and after).

COMPLETED: v0.1.0 tagged against dev@a9d9692, published via CI run 30730946316 (Claude-Conduit-Setup-0.1.0.exe + latest.yml + SHA256SUMS). Installed on winvm via gh release download + silent NSIS install (/S), first-run setup completed live via CDP (--remote-debugging-port tunneled over SSH) using the real NIM key from .env -- 102 models returned, config saved. v0.1.1 tagged against branch commit 64ed0fe, published via CI run 30732005426 (Claude-Conduit-Setup-0.1.1.exe, latest.yml confirmed pointing at 0.1.1). Fully quit and relaunched the installed v0.1.0 app (fresh process, confirmed via new CDP target + StartTime) so a real fresh startup check fired against the now-published v0.1.1.

CRITICAL FINDING -- AC#1/#2 cannot pass as currently built: electron-updater's default GitHubProvider polls the PUBLIC unauthenticated feed https://github.com/evolvconsulting/claude-conduit/releases.atom. This repo is PRIVATE, so that endpoint 404s -- confirmed directly (curl -> 404 vs authenticated gh api -> 200) AND live inside the real installed app (startup check returned {state:'error', message:'404 ... authentication token...'}). Root cause traced in node_modules/electron-updater/out/providerFactory.js: PrivateGitHubProvider (authenticated) is only selected when app-update.yml's baked-in githubOptions.private === true, which requires publish:{provider:github, private:true} in electron-builder.yml -- absent today. This is a static build-time choice, not fixable by an env var at launch. The auto-update feature cannot work for ANY real user while the repo stays private. The graceful-degradation design from NCOW-10.1 held correctly under this real failure: well-formed {state:'error'} broadcast, no crash, banner correctly stayed hidden.

TWO INDEPENDENT REAL WINDOWS BUGS found while trying to get litellm running for AC#3 (unrelated to the privacy blocker):
1. src/engine/platform.js's resolveCliCommand() unconditionally appends .cmd for win32; pip-installed litellm/uv/pipx ship as .exe entry-point stubs on Windows, never .cmd -- so checkLitellmOnPath()/detectInstaller() can NEVER find a real Windows litellm install.
2. Even with a .cmd present, configGen.js's generated run.js calls spawn(litellmAbsPath, args, {stdio:'inherit'}) with no shell:true -- modern Node (Electron 43, post CVE-2024-27980 hardening) throws spawn EINVAL for any direct .cmd/.bat spawn without shell:true. Litellm currently can NEVER start on Windows via this app, from these two compounding bugs alone.
3. Additional robustness gap noted (not blocking, informational): pm2Control.ensureConnected() memoizes its pm2.connect() promise with no timeout/retry -- a hung first connect permanently wedges every future proxy:* IPC call with no recovery short of restarting the app.

Cleanup: all VM-side scratch (scheduled tasks, litellm.cmd shim, rust/cargo toolchain, ncow103 folder, orphaned pm2 entry, SSH tunnels) removed. Claude Conduit v0.1.0 remains installed on winvm (fine to leave per instructions) but not running. Both v0.1.0 and v0.1.1 GitHub Releases remain published permanently, as pre-authorized.

BLOCKERS requiring a human decision (not something the worker could resolve unilaterally):
1. Repo-privacy vs electron-updater's public feed -- needs a real choice: make evolvconsulting/claude-conduit public, or add publish:{provider:github,private:true} to electron-builder.yml plus a strategy for distributing a read-only GH token to installed clients.
2. The two Windows litellm-launch bugs block AC#3 independent of the update mechanism -- candidate for a follow-up task.

REVIEW (opus): escalate, disposition human_needed. All load-bearing claims independently re-derived (not just re-read): gh repo view confirms isPrivate=true; releases.atom and the unauthenticated releases/latest API both 404 while authenticated gh calls succeed; electron-updater's providerFactory.js verbatim confirms the GH_TOKEN/GITHUB_TOKEN env fallback is gated behind githubOptions.private===true, unreachable any other way; electron-builder.yml has no publish: block; reviewer additionally traced that electron-builder's publish inference (app-builder-lib's PublishManager) never auto-detects repo privacy from package.json's repository field, closing the one link the worker hadn't documented. Confirmed this blocker is PLATFORM-INDEPENDENT: Linux/AppImage would hit the identical 404, so no allowed platform can pass AC#1/#2 as currently built. Both Windows bugs re-confirmed by direct code trace (platform.js/prereqs.js/configGen.js), with one addition: checkPython() is broken identically to the litellm/installer checks (three broken checks, not two). Graceful-degradation behavior confirmed by code (autoUpdate.js's error handler + catch both emit {state:'error'}), with strong corroboration the worker's live 404 observation was genuine (the exact error string only appears in builder-util-runtime's httpExecutor.js, not guessable). CI runs 30730946316 (v0.1.0) and 30732005426 (v0.1.1) both independently confirmed green across all jobs; v0.1.1's latest.yml confirmed correct. New minor finding: package-lock.json still reads 0.1.0 (version + packages[""].version) despite package.json's 0.1.1 -- npm ci tolerated it for this release but it's real drift worth a follow-up one-liner. Version-bump diff (single commit 64ed0fe, package.json only): approve -- correctly scoped, 220/220 tests independently re-run clean, safe and necessary to merge now regardless of the escalation (dev's package.json must track the highest permanently-published version or the next real tag risks colliding via release.yml's own tag-must-match-package.json guard). Full reviewer recommendation: this needs a genuine human product decision (make the repo public, which requires zero code change since releases/latest.yml are already correctly shaped; or add publish:{provider:github,private:true} plus a real strategy for distributing a read-only token to installed clients, which has no clean answer since any shipped token is extractable) -- not something an agent should decide unilaterally. Recommends the two Windows litellm-launch bugs become a follow-up task independent of the privacy decision, since they block AC#3 regardless of how the update mechanism gets resolved.

RESOLUTION (2026-08-02): user decided to make evolvconsulting/claude-conduit public (rather than the private+token-distribution path) and confirmed executing it now. Repo flipped via gh repo edit --visibility public --accept-visibility-change-consequences; verified gh repo view now reports isPrivate=false/visibility=PUBLIC. Confirmed the actual blocker is resolved: both https://github.com/evolvconsulting/claude-conduit/releases.atom and https://api.github.com/repos/evolvconsulting/claude-conduit/releases/latest now return 200 (previously 404). electron-updater's default GitHubProvider should now be able to reach the feed for real. NCOW-10.3's real live re-verification (does the already-installed v0.1.0 app on winvm now actually detect/download/install v0.1.1) has NOT yet been re-attempted this session -- pending a decision on whether to redispatch a wave for it now or in a future session. Separately, user approved filing NCOW-20 for the two Windows litellm-launch bugs found along the way (created, not yet started).

WAVE 5 WORKER RESULT (retry): status=blocked (on AC#3 only), no repo files changed, working tree clean, npm test 235/235 unchanged, nothing to push.

AC#1 & AC#2: FULLY VERIFIED, PASSED THIS TIME. Confirmed repo public (isPrivate:false) and feed resolves (200, was 404). Fully quit and relaunched the installed v0.1.0 app on winvm (worked around SSH landing in Session 0, which can't spawn into the interactive desktop, via a scheduled-task trick -- same technique the prior wave used). Drove it live via CDP (--remote-debugging-port=9222 tunneled over SSH, Runtime.evaluate against window.nimProxy.*): fresh startup check detected v0.1.1 and auto-downloaded it ({state:"downloaded", latestVersion:"0.1.1"}), reproduced on two independent fresh launches. Triggered window.nimProxy.update.install() -- this launches the real (non-silent, --updated --force-run) NSIS installer, so had to script through the wizard (SetForegroundWindow + BM_CLICK on the default-button dialog, via a scheduled-task-launched PowerShell helper, since plain SSH can't see/click windows in the interactive session either). CONFIRMED END TO END: installer completed, app auto-relaunched, file version 0.1.1.0, and the app's own window.nimProxy.app.getVersion() IPC call returns "0.1.1" live. Before/after 0.1.0 -> 0.1.1, fully observed live, not inferred from code or logs.

AC#3: partially demonstrated, blocked on a NEWLY DISCOVERED real bug, distinct from anything NCOW-20 fixed. Getting litellm running on Windows at all required real environment work: win_arm64 has no prebuilt wheels for several of litellm's native deps (cryptography/tiktoken/fastuuid/granian) and no MSVC link.exe on this VM for a Rust-toolchain build; worked around via a side-by-side x64 Python 3.11 (runs under Windows-on-ARM emulation, has prebuilt win_amd64 wheels) -- litellm[proxy]==1.94.1 installed cleanly. Also fixed a Windows console-encoding crash in litellm's own startup banner (UnicodeEncodeError under cp1252) via PYTHONUTF8=1. Hand-edited the VM's generated manifest.json/run.js (not repo files) to point litellm_path at the real litellm.exe directly (NCOW-20's fixes are irrelevant once the resolved path is a genuine .exe, not a .cmd shim -- consistent with NCOW-20's own scope). Verified via direct `node run.js` invocation (mirrors pm2's own child-process call) that the proxy serves real traffic ("I'm alive!", HTTP 200) BOTH BEFORE AND AFTER the real update, using the same untouched config -- so the underlying proxy-restart mechanism (stop poller -> stop proxy -> shutdown latch -> quitAndInstall, from NCOW-10.1) is sound.

HOWEVER: the app's own live proxy CONTROL is separately broken on Windows, independent of anything this campaign has touched so far. window.nimProxy.proxy.getStatus() (and by extension start/stop/restart) hangs indefinitely -- reproduced 4 times (90s, 45s timeouts), across both a stale and a completely fresh PM2_HOME, and on BOTH v0.1.0 and v0.1.1 (so not introduced by the update itself). No pm2 daemon process ever spawns. Traced into pm2's own Client.js: pingDaemon()'s reconnect/error handlers never fire, and launchDaemon() spawns process.execPath (the Electron binary itself, not plain Node) as the daemon interpreter -- a plausible root cause given pm2 was never designed to run embedded inside Electron this way. This is DISTINCT from NCOW-20's two already-fixed bugs and from the previously-flagged pm2Control.ensureConnected() "no timeout" robustness gap (this is a permanent deadlock, not slowness -- no timeout would even help). Because of this, AC#3 could only be demonstrated via the manual node run.js workaround above, not via the app's real pm2-orchestrated start/stop-across-update flow, which is what the AC actually asks for.

Cleanup: all VM-side scaffolding removed (scheduled tasks, helper scripts, sanity logs); PM2_HOME restored to its pre-session state. Left in place (legitimate, reusable for a future attempt): Claude Conduit v0.1.1 now installed, litellm 1.94.1 + x64 Python installed, corrected litellm_path in the generated config.

WORKER RECOMMENDATION: file a follow-up task (same pattern as NCOW-20/21) for the pm2-in-Electron connect hang -- it blocks ALL proxy control on Windows, not just this verification, and is a significant, previously-unknown production defect.
<!-- SECTION:NOTES:END -->
