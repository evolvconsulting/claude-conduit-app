---
id: NCOW-25
title: 'Linux release publishes x86_64 only, untestable on available arm64 hardware'
status: To Do
assignee: []
created_date: '2026-08-02 21:07'
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
