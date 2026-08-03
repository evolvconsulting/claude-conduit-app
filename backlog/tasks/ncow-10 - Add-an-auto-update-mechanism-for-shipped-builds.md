---
id: NCOW-10
title: Add an auto-update mechanism for shipped builds
status: Done
assignee: []
created_date: '2026-07-31 20:38'
updated_date: '2026-08-03 01:00'
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
- [x] #1 Update mechanism chosen and documented, including per-platform support and known limitations
- [x] #2 In-app update check exists and tells the user when a newer version is available
- [x] #3 Platforms where silent/auto update is possible actually download and install a newer version end to end
- [x] #4 Platforms where it is not possible fall back to notifying the user with a link to the release, rather than failing silently
- [x] #5 Behaviour of the running LiteLLM proxy across an app update/restart is defined and implemented
- [x] #6 A CI release workflow publishes artifacts plus the update metadata files to GitHub Releases
- [x] #7 Update check failures (offline, rate-limited, no release) degrade gracefully and never block app startup
- [x] #8 Verified by installing an older version and updating to a newer one on at least one platform
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
User decision (2026-07-31): the app WILL be code-signed before release (Developer ID on macOS, and signing on Windows), so plan for a fully signed Squirrel.Mac auto-update path rather than a macOS notify-only fallback. Signing is not yet in place, so implementation may land ahead of the certificates.

Context added 2026-07-31: now also depends on NCOW-12 (rebrand), because an update feed keyed to the old appId cannot serve renamed builds to already-installed clients. Also note electron-builder is already emitting latest.yml / latest-mac.yml / latest-linux.yml into dist/ without extra configuration, so the metadata half of the feed exists; what is missing is publishing and the in-app checker.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Epic complete: all 8 acceptance criteria are satisfied by its three subtasks, each independently reviewed and each verified against fresh observed output rather than code reading.

AC mapping: #1 (mechanism chosen and documented, per-platform support and limitations) and #2 (in-app update check) -> NCOW-10.1, which integrated electron-updater against the GitHub Releases feed and documented the decision in the new docs/auto-update.md. #4 (platforms where silent update is impossible notify instead of failing silently) -> NCOW-10.1's macOS notify-only path. #5 (proxy behavior across an update is defined and implemented) -> NCOW-10.1 for the implementation (stopStatusPoller -> stopProxyForShutdown -> markShuttingDown -> quitAndInstall, reusing the single existing stop-proxy call site), and NCOW-10.3's AC#3 for live confirmation that it actually holds across a real update. #6 (CI release workflow publishing artifacts plus update metadata) -> NCOW-10.2's .github/workflows/release.yml, verified against a real smoke-test tag which surfaced and fixed 6 real bugs including a genuine Windows production defect. #7 (update-check failures degrade gracefully and never block startup) -> NCOW-10.1, and proven under a real unplanned failure during wave 3, when the private-repo 404 produced a well-formed error state with no crash and the banner correctly hidden. #3 and #8 (an installed older version really downloads and installs a newer one, verified by doing it) -> NCOW-10.3's AC#1/#2, observed live on a real Windows VM with a byte-exact sha512 match against the published release.

Real, permanent GitHub Releases v0.1.0 and v0.1.1 exist and remain published, per the campaign's explicit authorization.

Caveats deliberately recorded rather than glossed. macOS is notify-only pending real signing certificates: that is the documented, intended answer for AC#1/#4 today, not a gap, but macOS silent auto-update is genuinely unproven and will need revisiting when certs exist. End-to-end auto-update has only ever been exercised on Windows; the published Linux artifact is x86_64 while all available Linux hardware is aarch64, so it has never been run at all (tracked as NCOW-25). The AC#5 runtime verification was done with a pre-existing shared pm2 daemon and wave 5's hand-corrected launcher config, so it validates the app's pm2 orchestration rather than the cold-bootstrap path or config generation on Windows; NCOW-22's cold-bootstrap fix is on dev but not in any published build. Three defects discovered while proving this epic out are tracked separately: NCOW-20 (merged), NCOW-22 (merged), and NCOW-24.
<!-- SECTION:FINAL_SUMMARY:END -->
