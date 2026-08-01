---
id: NCOW-9
title: Decide and document the GitHub install story for end users
status: In Progress
assignee: []
created_date: '2026-07-31 20:38'
updated_date: '2026-08-01 22:13'
labels: []
dependencies:
  - NCOW-12
priority: high
type: spike
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The repo will be published on GitHub. We need a decided, documented answer to "how does a user install this?" before publishing.

`npm run dist` already produces macOS, Windows and Linux artifacts. Open question: are published GitHub Release binaries the primary install path, and is a single curl-pipe `.sh` install script (as the user suggested) worth offering alongside them for macOS/Linux — or does it just add an unsigned-script trust problem on top of already-unsigned binaries?

Evaluate the options and pick one, accounting for: macOS ad-hoc signing means Gatekeeper will warn (no notarisation, no Developer ID) and users need an explicit bypass step; Windows SmartScreen will warn on an unsigned installer; Linux has AppImage/deb/rpm choices. Also cover what an install script would actually need to do beyond downloading (it must not need to install Python/LiteLLM — the app handles prerequisites itself).

Output should be a decision plus user-facing install instructions in the README, and a follow-up task if a script or CI release workflow is needed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Primary install path is chosen and written down with its rationale
- [ ] #2 Decision recorded on whether a shell install script is offered, with the reasoning either way
- [ ] #3 README has copy-paste install instructions for macOS, Windows and Linux
- [ ] #4 Gatekeeper and SmartScreen warnings are documented with the exact steps a user must take to get past them
- [ ] #5 Verified by installing from the chosen path on at least one clean target and launching the app successfully
- [ ] #6 Follow-up implementation tasks created for any release automation or script the decision requires
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Investigated real signing/packaging state rather than trusting the task's
prior note (which claimed latest*.yml already existed and assumed eventual
signing). Made two product decisions with written rationale (below), rewrote
README's Install section with per-platform copy-paste instructions and exact
Gatekeeper/SmartScreen bypass steps, and added a new docs/distribution.md
covering the full rationale, rejected alternatives, a verified signing-state
table, two real packaging bugs found+fixed, a release checklist (including
an asset-naming footgun for future CI), and an explicit verified/unverified
breakdown for AC#5. Verified via actually building npm run dist for all
three platforms and testing the macOS artifact's Gatekeeper-blocked ->
launch path under an isolated NIM_PROXY_TEST_HOME fake home (never touching
real machine state). Did not create any follow-up Backlog tasks -- listed
recommendations for orchestrator/user approval instead.

Decision AC#1: GitHub Releases with direct per-platform downloads (no
package manager, no install script) as the primary path -- artifacts already
exist from npm run dist, it's the layout electron-updater's GitHub provider
reads (unblocking NCOW-10), and package-manager distribution (Homebrew
cask/winget) is deferred until real code signing lands.
Decision AC#2: no curl-pipe-to-shell install script -- the app already
handles its own prerequisites, so a script would have nothing legitimate to
do beyond the one thing it must NOT do (silently clearing the Gatekeeper
quarantine flag on the user's behalf), doubles the trust surface on top of
already-unsigned binaries, and skips Windows (the platform where the real
friction is). Revisit as a Homebrew cask once signing exists.

Two real bugs found by actually building rather than assuming: (1) npm run
dist was failing outright at the .deb target ("Please specify project
homepage") -- fixed by adding "homepage" to package.json; the Linux install
path this repo documented could not have actually been shipped before this
fix. (2) No latest*.yml update metadata was being emitted at all, contrary
to a prior task note -- electron-builder only writes it once it can resolve
a publish target from the "repository" field, which was missing; adding it
makes npm run dist emit latest.yml/latest-mac.yml/latest-linux.yml, directly
unblocking NCOW-10. Also corrected two README inaccuracies: the old
Control-click-to-Open Gatekeeper bypass was removed by Apple in macOS 15
Sequoia (System Settings -> Privacy & Security -> Open Anyway is now the
only route); and confirmed via codesign/PE-header inspection that both the
macOS and Windows artifacts are genuinely unsigned today (ad-hoc only on
macOS, zero-size cert table on Windows), so the "will be signed eventually"
framing needed correcting to reflect present reality, not future intent.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Context added 2026-07-31:
1. Now DEPENDS ON NCOW-12 (rebrand). Publishing under the current name then renaming would break download links, the appId and any update feed, so the rename lands first.
2. npm run pack and npm run dist were broken at the schema-validation level (linux.desktopName was removed in electron-builder 26) and were fixed under NCOW-2. Packaging works again, verified by a real macOS build.
3. README already carries an Install section with per-platform Gatekeeper and SmartScreen workarounds and an artifact size table, written for the unsigned case. The user has since confirmed the app WILL be code-signed before release, so much of that section should shrink rather than be written from scratch.
4. dist/ already contains latest.yml, latest-mac.yml and latest-linux.yml - electron-builder emits update metadata by default, which NCOW-10 needs.

Worker evidence (implementation phase): branch feat/NCOW-9-github-install-
story, commits 200b87d (fix(build): add homepage and repository metadata so
dist produces a deb) and d564a1c (docs(install): decide the GitHub Release
install story and document it), pushed to origin. Files touched: package.json
(homepage + repository fields only -- no dependency/version changes),
README.md (Install section rewrite), docs/distribution.md (new).

AC#5 verified vs unverified, stated honestly by the worker:
VERIFIED (macOS 26.6, Apple Silicon): npm run dist built all three platforms
cleanly (six artifacts + three latest*.yml, exit 0). The .dmg mounts and
contains the app + /Applications symlink; codesign confirms
flags=0x10002(adhoc,runtime), universal x86_64/arm64, no team identifier, no
notarization -- matches the "genuinely unsigned" framing now in the docs. A
real com.apple.quarantine attribute applied to a copy was confirmed REJECTED
by spctl -a -t exec (reproducing the exact Gatekeeper block the README
addresses); clearing it with xattr -dr let the packaged app launch
successfully under NIM_PROXY_TEST_HOME=/tmp/ncow9-fakehome --dev, confirmed
over CDP (renderer loaded, window title "Claude Conduit"). Real
~/.config/claude-conduit, ~/.claude, and Claude Desktop config/key were
independently confirmed untouched (mtime unchanged).
NOT verified, and why: no GitHub Release is actually published yet, so a
real end-user download-and-install was not possible; the literal Gatekeeper
dialog / "Open Anyway" button was not screenshotted, only inferred from
Apple's documented Sequoia behavior change plus the verified spctl
rejection; Windows and Linux install flows are entirely unverified on real
machines (artifacts built and inspected only, no SmartScreen wording
observed); the packaged app was launched by running the inner Mach-O
directly, not through Finder/LaunchServices, so the actual Gatekeeper
*launch* path itself (as opposed to spctl's assessment of it) was not
exercised.

Recommended follow-up tasks for AC#6 (NOT created -- listed for orchestrator
to propose to the user):
1. Add a GitHub Actions release workflow (tag push -> build all platforms ->
   publish Release with artifacts, latest*.yml, blockmaps, SHA256SUMS) --
   worker flags a real footgun: asset names must be uploaded exactly as
   latest*.yml records them (dash-normalized), since GitHub's web UI
   rewrites spaces to periods and would silently break auto-update if done
   by hand. Prerequisite for NCOW-10 being trustworthy.
2. Code-sign and notarize release builds (Apple Developer ID + notarization,
   Windows Authenticode) -- would let most of the README's current
   Gatekeeper/SmartScreen workaround section be deleted.
3. Publish a Homebrew cask (and evaluate winget) -- depends on #2.
4. (Optional/low-priority) Verify Windows and Linux install flows on real
   target machines -- closes the one AC#5 gap achievable but not attempted
   this task.

Objective evidence: npm test 176/176, stable across four consecutive runs
including one immediately after a full dist build. Worker flagged one
honest anomaly for the record: a single first run right after
electron-builder's native-dependency install churn showed 170/176 with 2
failures; a deliberate reproduction attempt (npm run dist:linux then npm
test) did not reproduce it, and every run since has been 176/176. Worker
could not pin down a cause and states it does not believe its own changes
caused it -- flagging for reviewer attention, not asserting it's benign.

Next: dispatching opus review into the same worktree before merge, with
explicit instruction to scrutinize the package.json scope-boundary question
(homepage/repository additions, arguably outside "README.md only" but
justified as fixing two real blocking packaging bugs) and to investigate the
170/176 anomaly.
<!-- SECTION:NOTES:END -->
