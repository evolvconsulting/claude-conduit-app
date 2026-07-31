---
id: NCOW-10
title: Add an auto-update mechanism for shipped builds
status: To Do
assignee: []
created_date: '2026-07-31 20:38'
updated_date: '2026-07-31 21:56'
labels: []
dependencies:
  - NCOW-9
  - NCOW-12
priority: high
type: spike
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Once the app is published, users need a way to receive updates without manually re-downloading. Decide on and implement the update mechanism.

The standard Electron answer is `electron-updater` (electron-builder ecosystem, already in use here) backed by GitHub Releases as the update feed, with `latest.yml` / `latest-mac.yml` / `latest-linux.yml` published alongside the artifacts. Evaluate that against the constraints of this app before committing:

- macOS auto-update via Squirrel.Mac requires a validly signed app; this project uses ad-hoc signing (`identity: "-"`), which may block macOS auto-update entirely and force a notify-and-download-manually fallback there.
- Windows NSIS auto-update generally works unsigned but triggers SmartScreen on the downloaded installer.
- Linux AppImage supports electron-updater; deb/rpm do not.
- The app supervises a pm2 proxy that outlives it — the update flow must define what happens to the running proxy across a restart.
- A CI workflow is needed to build and publish releases with the update metadata files.

Deliver a decision plus a working update path on whichever platforms support it, and a clear in-app fallback (notify the user, link to the release) where it does not.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Update mechanism chosen and documented, including per-platform support and known limitations
- [ ] #2 In-app update check exists and tells the user when a newer version is available
- [ ] #3 Platforms where silent/auto update is possible actually download and install a newer version end to end
- [ ] #4 Platforms where it is not possible fall back to notifying the user with a link to the release, rather than failing silently
- [ ] #5 Behaviour of the running LiteLLM proxy across an app update/restart is defined and implemented
- [ ] #6 A CI release workflow publishes artifacts plus the update metadata files to GitHub Releases
- [ ] #7 Update check failures (offline, rate-limited, no release) degrade gracefully and never block app startup
- [ ] #8 Verified by installing an older version and updating to a newer one on at least one platform
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
User decision (2026-07-31): the app WILL be code-signed before release (Developer ID on macOS, and signing on Windows), so plan for a fully signed Squirrel.Mac auto-update path rather than a macOS notify-only fallback. Signing is not yet in place, so implementation may land ahead of the certificates.

Context added 2026-07-31: now also depends on NCOW-12 (rebrand), because an update feed keyed to the old appId cannot serve renamed builds to already-installed clients. Also note electron-builder is already emitting latest.yml / latest-mac.yml / latest-linux.yml into dist/ without extra configuration, so the metadata half of the feed exists; what is missing is publishing and the in-app checker.
<!-- SECTION:NOTES:END -->
