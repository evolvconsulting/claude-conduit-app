---
id: NCOW-25
title: 'Linux release publishes x86_64 only, untestable on available arm64 hardware'
status: Done
assignee: []
created_date: '2026-08-02 21:07'
updated_date: '2026-08-03 12:36'
labels:
  - release
  - linux
  - ci
dependencies: []
priority: medium
type: enhancement
ordinal: 38000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced while selecting a Linux host for NCOW-22's cold-bootstrap verification (wave 6, 2026-08-02).

.github/workflows/release.yml builds the Linux artifact on ubuntu-latest, which is x86_64, and electron-builder.yml's linux target does not request arm64. So every published Linux AppImage is x86_64 only.

Every Linux machine available to this project's maintainer is aarch64 (verified on the tailnet: linuxvm, spark, rpi5, jetson, remote — all aarch64). The practical consequence is that the shipped Linux artifact cannot be run, smoke-tested, or verified on any machine the maintainer owns. NCOW-22's Linux verification had to be done from a source checkout built on the host, which means the PACKAGED Linux path has never been exercised at all — the packaged cold-bootstrap was only ever confirmed on macOS.

This is a real gap in the release matrix rather than a cosmetic one: NCOW-10.2 established CI publishing for three platforms, and NCOW-10.3 verified real end-to-end auto-update on Windows, but the Linux artifact has no verification story on the hardware that exists here.

Two reasonable resolutions, and choosing between them is part of this task: add a linux-arm64 target to the release matrix (electron-builder can cross-build or a native arm64 runner can be used), or consciously decide Linux arm64 is out of scope and document that the Linux artifact is x86_64-only and unverified on arm64. Do not silently leave it ambiguous.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A decision is made and recorded: either Linux arm64 is a supported published target, or it is explicitly out of scope with the reasoning documented in docs/distribution.md
- [x] #2 If supported: the release workflow publishes a working linux-arm64 artifact alongside x86_64, and the update metadata (latest-linux.yml) correctly serves arm64 clients
- [ ] #3 If supported: the published arm64 artifact is installed and launched on a real aarch64 Linux machine, and the packaged cold-bootstrap path (start/stop/restart the proxy) is verified there — closing the gap that the packaged Linux path has never been exercised
- [ ] #4 If out of scope: docs/distribution.md and the README state plainly that Linux builds are x86_64-only, so an arm64 user is not left to discover it by failure
- [x] #5 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
AC#1 decision: Linux arm64 becomes a supported published target, built on a native
GitHub-hosted arm64 runner (ubuntu-24.04-arm, GA and free for public repos since 2025-08 -
this repo is public) rather than cross-compiling. Verified pm2 (the only asarUnpack'ed
dependency) has zero native/node-gyp addons anywhere in its tree, so nothing needs an
arch-specific rebuild beyond Electron's own prebuilt binary, which electron-builder already
fetches per-arch like any other target. electron-builder.yml's linux targets gain
arch: [x64, arm64]; release.yml gains a 4th matrix job on the native arm64 runner; the
existing x64 job restricted via new dist:linux:x64/dist:linux:arm64 npm scripts (discovered
that --linux --arm64 does NOT restrict the build once arch: is already an array in config -
only the target:arch CLI suffix form does). docs/distribution.md and README.md updated with
the decision record and per-arch build/download info. Incidentally fixed a pre-existing
package-lock.json/package.json version drift (0.1.0 vs 0.1.1) as its own separate commit,
needed for a clean npm install/npm test in the worktree.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Wave 9 implementation complete, pushed to feat/NCOW-25-linux-arm64-release (4 commits:
44f5ad7 lockfile sync, 5bee25d packaging config, c54bb8e CI matrix, 087627a docs).
Independently verified by the orchestrator: branch/commits exist on origin, diff vs dev is
exactly the 6 expected files (electron-builder.yml, package.json, package-lock.json,
.github/workflows/release.yml, docs/distribution.md, README.md) - no sibling-task files
(paths.js, engine-context.js, pm2Control.js) touched.

Live verification on linuxvm (real aarch64 Ubuntu 26.04), worker-reported pending independent
reviewer re-verification: npm run dist:linux:arm64 built NATIVELY (no cross-compilation) a
real Claude Conduit-0.1.1-arm64.AppImage (confirmed via file(1): ELF 64-bit LSB executable,
ARM aarch64) and a matching .deb, plus a correct latest-linux-arm64.yml. Extracted and
launched the real packaged binary, drove it over CDP through the real IPC surface:
prereqs check, real NVIDIA key validation against the live API, real model catalog fetch,
and real config generation all succeeded.

IMPORTANT - AC#3 is only PARTIALLY met: proxy.start() itself failed from what the worker
characterizes as a separate, pre-existing, architecture-independent defect, not an arm64
problem - pm2's default interpreter ("node") for the MANAGED app (litellm-nim, not the pm2
daemon itself) has no equivalent of pm2Control.js's already-established
process.execPath + ELECTRON_RUN_AS_NODE workaround (used for bootstrapping the DAEMON since
NCOW-22), so it can MODULE_NOT_FOUND on pm2's own ProcessContainerFork.js. The worker
believes this is universal (would affect a packaged Windows/macOS build identically) and
previously unnoticed because no prior wave had exercised a genuinely fresh packaged Linux
install before (NCOW-22's Linux verification used a source checkout; its macOS verification
used a packaged artifact but on a machine where this may not have manifested the same way -
not yet independently confirmed). This needs independent reviewer verification before the
orchestrator decides disposition (fix in-scope vs. document + propose a follow-up task to
the user) - explicitly NOT yet actioned, since new-task creation requires user approval
between waves per this campaign's rules.

npm test: 244/244 passing before and after all changes (worker's report, pending reviewer
re-verification). ac_status self-reported: {"1": true, "2": true, "3": "partial - see above",
"4": "n/a (arm64 was chosen as supported)", "5": true}.

Wave 9 review (opus): ESCALATE (human_needed). AC1/2/5 independently confirmed (arm64 runner GA
verified against GitHub's own changelog, pm2's dependency tree independently walked - all 74
packages, zero native/node-gyp addons anywhere; both arch-narrowing build scripts empirically
verified to produce arch-pure output with no cross-arch leakage; latest-linux.yml/
latest-linux-arm64.yml producer/consumer sides both verified correct; npm test 244/244 re-run by
reviewer). AC#4 n/a (arm64 was supported, not descoped).

AC#3 only PARTIALLY met, and the reviewer's independent investigation found the underlying cause
is far more severe than the worker characterized: **packaged proxy.start() fails on EVERY
platform and architecture this app ships**, not just Linux/arm64. Root cause re-derived from real
source (not speculation): configGen.js's generated ecosystem.config.cjs omits an interpreter for
the managed litellm-nim app, so pm2 defaults to resolving argv against an app.asar-internal path
to its own ProcessContainerFork.js, which a PATH-resolved system Node cannot read (no asar
support) - MODULE_NOT_FOUND, crash loop, HEALTH_CHECK_TIMEOUT. pm2Control.js's spawnDaemon()
already solves this exact class of problem for the DAEMON itself (process.execPath +
ELECTRON_RUN_AS_NODE, established by NCOW-22) but nothing equivalent exists for the managed app.
Reviewer independently REPRODUCED this live on TWO real packaged artifacts (packaged macOS via npm
run pack, and the new packaged Linux arm64 build) - byte-for-byte the same error on both. Confirmed
why NCOW-22 never caught it: every one of its start/stop/restart verifications on all 3 platforms
was a SOURCE run; its only packaged-artifact test exercised daemon bootstrap + getStatus(), which
never forks the managed app - so no wave has ever actually called proxy.start() from a packaged
artifact, on any platform, ever. This means the entire NCOW-10 auto-update epic's "verified real
proxy restart across the update" claim, and every currently-published release (v0.1.0, v0.1.1),
have never actually been proven to start litellm from a real packaged install.

Reviewer also independently validated a fix recipe live (adding interpreter: process.execPath +
env: {ELECTRON_RUN_AS_NODE: '1'} to the generated ecosystem entry fixed packaged macOS start/stop/
restart end-to-end, including a real HTTP 200 completion through the running proxy) but explicitly
recommends escalate rather than a routine request_changes fix-pass, reasoning: severity vastly
exceeds this task's own MEDIUM framing (a release-blocking defect meaning no shipped build has
ever started the proxy is not a Linux-packaging enhancement's problem to silently absorb); Windows
is entirely untested for this specific failure; and there's a real open design question specific to
AppImage packaging (process.execPath is an ephemeral per-launch FUSE-mounted temp path, and pm2
persists the interpreter path into dump.pm2, so pm2 save/resurrect/autorestart-after-quit would
reference a dead path after the AppImage unmounts - entangles with NCOW-24's already-filed daemon-
persistence concerns). Reviewer's own lean: merge NCOW-25 now (its own scope is solid and
independently verified) and file the interpreter defect as its own new high-priority task, but
explicitly defers the final call to the user.

Minor findings, all addressed/acceptable: CI workflow unverified by a real tag-triggered Actions
run (mitigated: actionlint clean, and a deliberate bogus-runner-label control test proved the
linter genuinely validates runner names); artifact built on Ubuntu 26.04 rather than the exact
ubuntu-24.04-arm image (low risk, same config); README size table's cited baseline version vs
actual measured version is a harmless label mismatch; the worker's claimed "throwaway home
removed" was incomplete (a fake-home directory containing a real plaintext copy of the NVIDIA key
was left on linuxvm - reviewer deleted it and confirmed linuxvm is now clean); package-lock.json's
separately-committed version-sync fix judged benign and acceptable.

Orchestrator note: NOT yet actioned pending user decision - see next steps.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
AC#1 decision: Linux arm64 is now a supported published target, built on a native GitHub-hosted
arm64 runner (ubuntu-24.04-arm, GA/free for public repos, confirmed against GitHub's own
changelog) rather than cross-compiling - pm2, the only asarUnpack'ed dependency, has zero
native/node-gyp addons anywhere in its 74-package tree (independently walked by the reviewer).
electron-builder.yml/release.yml/docs updated accordingly. AC#2: a real, correctly-architected
arm64 AppImage + deb were built natively on real aarch64 hardware and update metadata
(latest-linux-arm64.yml) independently verified correct against electron-updater's own
arch-suffix consumer logic. AC#5: npm test 254/254 (post-rebase).

AC#3 is only PARTIALLY met and left honestly documented, not silently closed: the arm64 artifact
was installed and launched live on real aarch64 hardware, and prereqs/key-validation/model-catalog
/config-generation all verified through the real packaged IPC surface - but proxy.start() itself
failed from a separate, pre-existing, platform/architecture-INDEPENDENT defect (pm2's managed-app
interpreter can't read app.asar), independently reproduced by the reviewer on both packaged macOS
and packaged Linux. This is not a regression introduced by this task - it is the first time any
campaign wave exercised a genuinely packaged artifact's cold proxy-start at all. Filed as NCOW-27
(High priority) with the reviewer's full root cause and a validated fix recipe. User explicitly
decided (2026-08-03): merge NCOW-25 now with this gap documented rather than holding it, since
NCOW-27 is unrelated to arm64 specifically and blocks every platform equally. AC#4 not applicable
(arm64 was chosen supported, not the out-of-scope path).

Squash-merged PR #16 -> dev @ b06a05e.
<!-- SECTION:FINAL_SUMMARY:END -->
