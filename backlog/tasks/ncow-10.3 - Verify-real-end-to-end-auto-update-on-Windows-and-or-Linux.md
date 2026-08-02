---
id: NCOW-10.3
title: Verify real end-to-end auto-update on Windows and/or Linux
status: In Progress
assignee: []
created_date: '2026-08-02 01:08'
updated_date: '2026-08-02 04:37'
labels: []
dependencies:
  - NCOW-10.1
  - NCOW-10.2
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
1. Publish v0.1.0 (current package.json version, tag matches, no bump needed) against dev HEAD, watch CI, confirm published.
2. Install v0.1.0 on winvm (Windows VM via ~/.scripts/winvm.sh), complete first-run setup with real NIM API key so the LiteLLM proxy actually runs.
3. Bump package.json to 0.1.1 on the task branch, tag, push, watch CI, confirm v0.1.1 published.
4. Fully quit and relaunch the installed v0.1.0 app on winvm so a fresh startup update-check fires; observe detect/download/install of v0.1.1 (driving the installed app's UI via CDP over an SSH-tunneled --remote-debugging-port, matching this project's own documented local CDP-driving pattern).
5. Confirm the relaunched app reports v0.1.1 and the LiteLLM proxy is running again post-relaunch (AC#3).
6. Capture evidence throughout; clean up all VM-side scaffolding; push branch for review.
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
<!-- SECTION:NOTES:END -->
