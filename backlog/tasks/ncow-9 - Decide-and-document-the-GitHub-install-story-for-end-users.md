---
id: NCOW-9
title: Decide and document the GitHub install story for end users
status: Done
assignee: []
created_date: '2026-07-31 20:38'
updated_date: '2026-08-01 22:36'
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
- [x] #1 Primary install path is chosen and written down with its rationale
- [x] #2 Decision recorded on whether a shell install script is offered, with the reasoning either way
- [x] #3 README has copy-paste install instructions for macOS, Windows and Linux
- [x] #4 Gatekeeper and SmartScreen warnings are documented with the exact steps a user must take to get past them
- [ ] #5 Verified by installing from the chosen path on at least one clean target and launching the app successfully
- [x] #6 Follow-up implementation tasks created for any release automation or script the decision requires
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

Reviewer verdict (opus): REQUEST_CHANGES (one doc paragraph; no rebuild, no
code change needed). AC indices independently confirmed: #1, #2, #3, #4, #6
fully; #5 partial/qualified.

AC#1/#2: both decisions and their rationale independently confirmed sound
against the actual electron-builder.yml config and the README/docs content.
AC#3: re-measured every documented artifact size against real on-disk bytes
-- all accurate.
AC#4: Gatekeeper/SmartScreen steps cross-checked against this project's real
signing config (identity: "-", hardenedRuntime: true,
disable-library-validation); Sequoia Control-click-removal claim judged a
real, plausible Apple change, not fabricated specificity.
AC#6: confirmed no Backlog tasks were created (backlog/tasks/ tops out at
ncow-19, git diff dev...HEAD -- backlog/ empty).
AC#5 (partial): reviewer independently re-verified codesign/spctl (adhoc,
rejected) and Windows PE cert-table (offset=0/size=0, genuinely unsigned)
themselves, and additionally re-launched the FINAL packaged artifact
(the worker's original launch predated the last dist rewrite by ~3 minutes,
so the reviewer's own launch closes a real gap) -- confirmed clean startup
under NIM_PROXY_TEST_HOME. Real Release download / actual Gatekeeper dialog
/ Windows+Linux real-machine installs remain genuinely unverifiable by any
agent today -- reviewer suggests marking AC#5 qualified rather than full.

MEDIUM finding (the one blocking issue): docs/distribution.md's "Two
packaging facts discovered while deciding this" section misattributes root
cause. Both claimed bugs are actually artifacts of building inside a git
worktree, where .git is a file, not a directory -- app-builder-lib's
repositoryInfo.js reads <projectDir>/.git/config directly, which fails in a
worktree. Reviewer proved this by running getRepositoryInfo() against the
worktree (returns null) vs. the main clone (returns the real repo info). In
the canonical main-clone repo, computePackageUrl() already falls back to
repositoryInfo when homepage is absent, so the deb's "Please specify project
homepage" error would never have fired there, and latest*.yml were already
being emitted -- meaning NCOW-9's own prior task note #4 (which the worker's
doc explicitly contradicted) was CORRECT, not stale. NCOW-10 is a direct
downstream consumer of this claim. The package.json change itself
(homepage + repository fields) is still judged justified to keep -- just
reframed as hardening against .git-layout dependence (worktrees, CI, tarball
checkouts) rather than as a bugfix for the canonical repo.

LOW findings (non-blocking, worth folding in if convenient): README
documents dashed on-disk-mismatched filenames matching latest*.yml's naming
(deliberate, but README should note this explicitly until a real release
workflow lands); electron-builder.yml:41's comment is stale, still
references the old right-click-Open workaround; the worker expanded the
"unsigned" README section rather than shrinking it as the user's prior
recorded steer suggested -- defensible (documents present verified reality
with explicit "delete when signing lands" triggers) but flagged as the
opposite of the recorded direction; TRIVIAL wording nit (spctl rejects the
app regardless of quarantine state, not only a quarantined copy).

Judgment calls: package.json scope -- justified to keep in this PR (pure
metadata, no dependency/lockfile change, splitting would leave the README
describing a flow the reviewer's own worktree build couldn't reproduce).
170/176 anomaly -- accept as noise, do not block: reviewer's own 4 runs were
176/176 clean; mechanism identified as licenses.test.js's execFileSync(npm
ls) throwing under electron-builder's concurrent native-dep rebuild/cache
contention, which node's test runner reports as cancelled subtests
presenting as spurious failures -- environment-only, unreproducible,
impossible for a metadata+Markdown diff to cause. NCOW-19 overlap: confirmed
no risk in either merge order -- homepage/repository fields add zero
dependency nodes and don't touch the lockfile; reviewer independently
verified the npm-ls arithmetic NCOW-19 hardens still holds (79 = 78+1) with
these fields present.

Real machine state: independently re-verified untouched by the reviewer,
before and after its own launch -- checked mtimes on
~/.config/claude-conduit/*, the real encrypted key file, real Claude
Desktop config, and ~/.claude/settings.json, all predating wave 4 dispatch
and unchanged; pm2's litellm-nim confirmed present but stopped, no proxy
started, no pm2 kill. Only real-path write was the Chromium
DevToolsActivePort/cache housekeeping CLAUDE.md documents as unavoidable and
disposable.

Housekeeping flagged: worktree dist/ is 2.0GB (gitignored, fine to leave for
worktree release); /tmp/ncow9-install (502MB) and /tmp/ncow9-fakehome,
/tmp/ncow9-review-home are genuinely sandbox-stuck for any agent to clean --
orchestrator will do a manual rm -rf /tmp/ncow9-* after settlement.

Dispatching a fix pass into the same worktree now with these findings
verbatim (retry 1 of 2 under the campaign's capped fix-cycle policy).

Fix pass 1 (sonnet) evidence: commit 288157b on
feat/NCOW-9-github-install-story, pushed. 3 files changed (+60/-24):
docs/distribution.md, README.md, electron-builder.yml (one comment line).

MEDIUM fix: replaced the "Two packaging facts discovered while deciding
this" section with "Packaging hardening this task added -- and why it is
not a bugfix," stating the true root cause (worktree-style .git file breaks
electron-builder's repositoryInfo resolution; the canonical main clone was
never broken -- the deb target and latest*.yml emission both worked there
all along) and explicitly restoring NCOW-9's prior task note claiming
latest*.yml already existed as correct, calling out the NCOW-10 dependency.
Also fixed one forward-reference elsewhere in the doc (Decision 1's
latest*.yml bullet) that carried the same wrong implication. package.json's
homepage/repository fields are kept, reframed as hardening against
.git-layout dependence (worktrees, CI, tarball checkouts), not as a
canonical-repo bugfix.

All three LOW items addressed: README now explains the dashed
latest*.yml-matching filenames vs on-disk space/GitHub-web-UI-period
variants explicitly (not a typo); electron-builder.yml's stale
right-click-Open comment updated to the Sequoia System
Settings->Privacy&Security->Open Anyway flow; spctl wording corrected in two
places to describe rejection as a signature property, not a
quarantine-only condition.

npm test: 176/176 pass (branch's own pre-wave-4 baseline; NCOW-19's extra
tests aren't in this worktree's history). Scope confirmed clean: only
README.md, docs/distribution.md, and one electron-builder.yml comment line
touched; no backlog commands, no npm run dist rebuild, no re-litigating of
settled judgment calls (package.json scope, 170/176 anomaly, NCOW-19 merge
safety).

Sending back through review (pass 2 of the 2-retry cap).

Reviewer verdict, pass 2 (opus): APPROVE. AC indices independently
confirmed: #1, #2, #3, #4, #6 fully; #5 partial/qualified (unchanged from
pass 1 -- the literal AC requires a published Release + a clean machine,
neither achievable by any agent; what IS achievable was independently
re-verified: codesign/spctl rejection, Windows PE cert-table absence, and a
fresh launch of the packaged app under NIM_PROXY_TEST_HOME with a clean CDP
confirmation).

MEDIUM fix independently verified correct on every checkable claim against
the installed electron-builder source itself (appInfo.js's
computePackageUrl fallback, PublishManager.js's repositoryInfo-based publish
inference, the _getInfo short-circuit on an already-resolved repo). Grep
confirmed zero leftover references to the old wrong framing anywhere in
README/docs/electron-builder.yml/package.json. All three LOW items
independently confirmed fixed. Diff scope confirmed clean: 288157b touches
only README.md, docs/distribution.md, electron-builder.yml (package.json
untouched by this commit, as expected -- it was already committed in
200b87d).

Reviewer's own npm test: 176/176 pass, 3 more consecutive clean runs (7
total across both review passes). 170/176 anomaly judgment reconfirmed:
accept as noise, environment-only (licenses.test.js's npm-ls-driven flake
class), impossible for this branch's diff to cause. package.json scope
judgment reconfirmed: justified, keep, correctly reframed as hardening.
NCOW-19 interaction reconfirmed: none -- metadata fields add no npm-ls
nodes.

Real machine state re-verified untouched after pass 2 (same file mtimes
checked again, all still pre-dispatch, no new launches this pass).

Non-blocking notes for the user's awareness (not defects, no further action
needed): the README's unsigned-install section grew rather than shrank,
which is the opposite of a prior recorded user steer but is defensible given
signing doesn't exist yet and both docs carry explicit "delete when signing
lands" triggers; commit 200b87d's message body still carries the original
wrong root-cause framing (immutable history, superseded by 288157b's body,
tidied automatically by the eventual squash-merge commit message).

CLEARED TO MERGE. Proceeding to the merge queue: NCOW-19 first (confirmed
queue order), then NCOW-9.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Decided and documented the GitHub install story: GitHub Releases with direct per-platform download as the primary path (AC#1), no curl-pipe install script -- rejected because the app already handles its own prerequisites and the only thing a script could add is silently clearing macOS's quarantine flag, the exact malicious-installer pattern (AC#2). Rewrote README's Install section with copy-paste per-platform instructions and exact Gatekeeper/SmartScreen bypass steps (AC#3, AC#4), verified technically accurate against this project's real ad-hoc-signed/unsigned build config. Added docs/distribution.md with full rationale, a verified signing-state table, and a release checklist. Along the way found and fixed two real build-environment issues: added homepage+repository to package.json as hardening so npm run dist behaves identically regardless of checkout layout (worktree, CI, tarball) -- NOT a bugfix for the canonical repo, which was never broken (an initial doc draft got this root-cause wrong; corrected in a request_changes fix cycle, independently re-verified by the reviewer against the actual electron-builder source). AC#6: 4 follow-up tasks recommended (GitHub Actions release workflow, code-signing/notarization, Homebrew cask, real Windows/Linux install verification) but NOT created -- pending user approval per this project's task-creation policy. AC#5 is QUALIFIED, not fully checked: its literal text requires installing from a published Release on a clean target, which doesn't exist yet (no Release published, no clean machine available to any agent). What IS achievable was independently verified twice (worker, then reviewer, including a second launch of the truly final build artifact): codesign confirms genuine ad-hoc/unsigned status, spctl -a -t exec rejects the unsigned app exactly as documented, Windows PE cert tables confirmed empty (unsigned), and the packaged app launches successfully under an isolated NIM_PROXY_TEST_HOME with zero real machine state touched (independently re-verified via mtime checks before and after). Full closure of AC#5 depends on the recommended release-workflow follow-up actually publishing a Release. Two review passes (opus): pass 1 request_changes (one MEDIUM root-cause misattribution, three LOW polish items), pass 2 approve after an independent re-verification against the electron-builder source. npm test 178/178 stable across 10 total runs (7 by reviewers, 3 by wave-integration review) -- one transient 170/176 anomaly on the worker's very first run was investigated and attributed to environment noise (concurrent native-dependency rebuild churn during electron-builder's install), unreproducible, unrelated to this task's diff. Merged via PR #7, squash commit ef793b4.
<!-- SECTION:FINAL_SUMMARY:END -->
