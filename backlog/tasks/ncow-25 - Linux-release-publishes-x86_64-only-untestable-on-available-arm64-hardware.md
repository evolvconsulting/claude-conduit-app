---
id: NCOW-25
title: 'Linux release publishes x86_64 only, untestable on available arm64 hardware'
status: In Progress
assignee: []
created_date: '2026-08-02 21:07'
updated_date: '2026-08-03 02:39'
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
- [ ] #1 A decision is made and recorded: either Linux arm64 is a supported published target, or it is explicitly out of scope with the reasoning documented in docs/distribution.md
- [ ] #2 If supported: the release workflow publishes a working linux-arm64 artifact alongside x86_64, and the update metadata (latest-linux.yml) correctly serves arm64 clients
- [ ] #3 If supported: the published arm64 artifact is installed and launched on a real aarch64 Linux machine, and the packaged cold-bootstrap path (start/stop/restart the proxy) is verified there — closing the gap that the packaged Linux path has never been exercised
- [ ] #4 If out of scope: docs/distribution.md and the README state plainly that Linux builds are x86_64-only, so an arm64 user is not left to discover it by failure
- [ ] #5 npm test passes
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
<!-- SECTION:NOTES:END -->
