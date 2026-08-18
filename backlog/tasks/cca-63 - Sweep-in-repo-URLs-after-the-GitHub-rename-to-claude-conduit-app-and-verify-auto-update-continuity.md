---
id: CCA-63
title: >-
  Sweep in-repo URLs after the GitHub rename to claude-conduit-app and verify
  auto-update continuity
status: Done
assignee: []
created_date: '2026-08-07 18:09'
updated_date: '2026-08-18 14:29'
labels: []
dependencies: []
priority: high
ordinal: 76000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The GitHub repo was renamed evolvconsulting/claude-conduit -> evolvconsulting/claude-conduit-app on 2026-08-07 (part of the three-repo split recorded in claude-conduit-docs: app / gateway / docs). GitHub serves redirects from the old name and the local git remote is already updated, but in-repo references still say claude-conduit: REPO_URL, package.json repository/publish config, README, CLAUDE.md, DESIGN.md where applicable. Existing installed builds reach releases through the redirect — that continuity must be verified live, not assumed, per the CCA-10.3 precedent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No in-repo URL or slug still points at evolvconsulting/claude-conduit except deliberate historical references
- [x] #2 An existing packaged install (built before the rename) still detects and applies an update published after the rename, verified live
- [x] #3 A fresh packaged build publishes and auto-updates against the renamed repo, verified live
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Grep the whole repo for evolvconsulting/claude-conduit as a literal, excluding the correct
   new -app slug, to find every stale URL/slug.
2. Fix all live, current-state pointers: package.json (homepage, repository.url), README.md's
   Releases link, src/main/menu.js's REPO_URL, src/renderer/components/about-dialog.js's
   REPO_URL, src/main/autoUpdate.js's DEFAULT_REPO, docs/auto-update.md, docs/distribution.md,
   .github/release-notes-template.md, test/engine/updateCheck.test.js's literal.
3. Bump package.json/package-lock.json version 0.1.1 -> 0.1.2 via npm version patch
   --no-git-tag-version (no tag created).
4. Run npm run pack (electron-builder --dir, no --publish) to prove packaging still works at
   the bumped version.
5. Do NOT create/push a tag, do NOT run gh release create, do NOT attempt AC#2/#3's live
   verification -- those are gated to the orchestrator per the user-confirmed rule.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
IMPLEMENTED (worker, wave 19). AC#1 fully done; AC#2/#3 deliberately left unattempted (gated to
orchestrator, per user-confirmed rule).

npm test: 562/562 both after the URL sweep commit and after the version-bump commit (one
transient electron-binary-install race on this fresh worktree's very first run, self-resolved
on immediate retry with no code change -- environment flake, not a regression).

npm run pack: succeeded at version 0.1.2, dist/mac-arm64/Claude Conduit.app built, ad-hoc
signed (codesign -v exit 0), Info.plist CFBundleShortVersionString=0.1.2 confirmed.

git tag --list: only v0.1.0/v0.1.1 -- confirms no tag was created (release workflow only
triggers on a v*.*.* tag push, so this was never at risk of an accidental publish).

Judgment calls (documented per instructions):
- CLAUDE.md left untouched: its one hit (line 16) is inside an already-accurate historical
  narrative attributing the OLD slug to the CCA-12 rename; rewriting it would misstate which
  task did what. DESIGN.md confirmed zero hits.
- No CHANGELOG entry added: no CHANGELOG file/convention exists in this repo -- release notes
  are written into the GitHub Release body at publish time from .github/release-notes-template.md.
  Flagged rather than inventing a new convention unilaterally; a CHANGELOG.md would be a
  separate scope decision.
- Confirmed electron-builder.yml has no explicit GitHub owner/repo config (infers from
  package.json's repository field, now fixed).

Files touched: package.json, package-lock.json, README.md, src/main/menu.js,
src/renderer/components/about-dialog.js, src/main/autoUpdate.js,
test/engine/updateCheck.test.js, docs/auto-update.md, docs/distribution.md,
.github/release-notes-template.md.

Commits on feat/CCA-63-repo-rename-sweep (pushed): 9f0196a (URL sweep), ef4616d (version bump).

REVIEW PASS 1 (opus): REQUEST_CHANGES. Confirmed AC indices so far: [1] (AC#2/#3 correctly
unattempted, orchestrator-gated, not faulted).

npm test personally observed: 562/562, clean, no flake on this run.

BLOCKING F1: scripts/generate-licenses.js:144 derives licenses.json's app.version from
package.json's version. The worker bumped package.json 0.1.1 -> 0.1.2 but never re-ran
`npm run licenses`, so licenses.json still says 0.1.1. Three independent confirmations by the
reviewer: (1) user-visible -- Help > Licenses would show "Claude Conduit 0.1.1" while
About/Info.plist say 0.1.2. (2) proven inside the actual npm-run-pack artifact -- app.asar
literally contains version 0.1.1. (3) breaks CCA-65's own new drift guard the moment both
branches merge -- reviewer ran CCA-65's appVersionMismatch() against this branch's files and
it fails, reproducing the exact recurrence class CCA-65 was filed to catch.

Fix required: run `npm run licenses`, confirm the diff is version-only (js-yaml etc. already
correct), commit.

Non-blocking (not gating): F2 (CLAUDE.md's line-16 paragraph reads stale in isolation, though
technically correct history -- lines 33-43 already correct it, optional polish), F3 (DESIGN.md
line 7 has a bare stale claim but is covered by that doc's own "not current source of truth"
disclaimer -- optional touch-up). Also a process note: CLAUDE.md/README only document
`npm run licenses` as needed after dependency changes, never version bumps, despite the
generator deriving app.version from package.json -- possible follow-up-task material for the
docs gap itself, not this task's scope.

Everything else verified clean: AC#1 repo-wide grep confirmed zero stale live hits; AC#2/#3
gate compliance clean (only pre-existing tags, no accidental publish trigger); version bump
otherwise consistent; menu.js comment verified accurate against git history; test change not
weakened; npm run pack reproduced independently; scope exactly the 10 files; zero overlap with
CCA-14.5/CCA-65 at the file level (F1 is a semantic collision with CCA-65, not a file one).

FIX PASS 1 (worker): addressed blocking F1. Ran npm run licenses; diff to
src/assets/licenses.json confirmed version-only (1 insertion/1 deletion, app.version
0.1.1 -> 0.1.2, js-yaml entry and everything else untouched). npm test 562/562 before and
after. Also applied F2/F3 as one-line safe wording tweaks (own judgment call, checked no test
parses DESIGN.md/CLAUDE.md content before doing so): CLAUDE.md's CCA-12 paragraph and
DESIGN.md's header disclaimer both now note the repo was renamed a second time to
claude-conduit-app rather than stating the first rename as a present-tense end state.

Commit on feat/CCA-63-repo-rename-sweep (pushed): 9883553.

REVIEW PASS 2 (opus): APPROVE. Confirmed AC indices: [1] (AC#2/#3 remain unconfirmed by
design -- gated to orchestrator, not faulted).

npm test personally observed: 562/562, exit 0.

F1 fix independently verified as genuine, not cosmetic: re-ran npm run licenses itself,
output byte-identical (SHA-256 match) to the committed file -- the committed licenses.json is
the generator's real output, not hand-edited. git show --numstat confirms exactly 1
insertion/1 deletion (version string only). Cross-checked CCA-65's own drift-guard functions
(read-only, CCA-65 worktree untouched) against CCA-63's tracked files: appVersionMismatch =
null, entryVersionMismatches = 0/91 -- CCA-63 will pass CCA-65's guard on merge.

AC#1 re-confirmed in full: git grep repo-wide for the old slug pattern returns zero live
hits; every github.com/evolvconsulting URL now points at claude-conduit-app; remaining bare
"claude-conduit" strings are all legitimate (npm package name, config-dir constant/migration
prefixes which must not change, deliberate historical prose). electron-builder.yml has no
explicit publish block (infers from package.json); release.yml uses ${{ github.repository }}
(dynamic, rename-proof).

AC#2/#3 gate compliance intact: only v0.1.0/v0.1.1 tags exist locally and on remote, no
v0.1.2 tag, nothing published.

F2/F3 wording tweaks independently assessed as accurate and safe (read full surrounding
paragraphs in both files, cross-checked against git log).

Non-blocking only (3 minor items, not gating): DESIGN.md's "CCA-63" attribution reads
slightly like CCA-63 performed the rename rather than swept it (defensible per DESIGN.md's
own citation convention); 2 remaining bare "claude-conduit" mentions are historical/observed
content within AC#1's carve-out; CLAUDE.md has mild tense-mixing in one paragraph, not wrong.

Scope clean: exactly CLAUDE.md/DESIGN.md/licenses.json touched by the fix commit.

CCA-63 is now APPROVE, ready for the merge queue once the rest of wave 19 settles.

ATTEMPTED THE ACTUAL RELEASE (2026-08-17, user-approved): pushed tag v0.1.2, triggering
.github/workflows/release.yml. Result: FAILED. The prepare job succeeded (tag/version match
confirmed, draft release pre-created cleanly, no race). Of the 4 platform build jobs, only
macOS passed its own `npm test` and completed its build+publish step (assets landed on the
still-DRAFT release). Windows, Linux x64, and Linux arm64 all failed at the "Run tests" step
-- TWO DIFFERENT pre-existing bugs, neither touched by wave 19 or any task in this campaign:

1. Linux (both x64 and arm64): test/engine/pm2Control.test.js:914 ("spawnDaemon: a rejecting
   attempt does not leak the daemon it spawned") failed with "Missing expected rejection" --
   the test writes a bogus non-socket file at the daemon's rpc socket path and expects
   spawnDaemon() to reject on every attempt; on real Linux CI runners it apparently did not
   reject as expected. Root cause not fully diagnosed -- needs investigation.

2. Windows: test/main/ipc-mutex.test.js:956 ("index.js: passes engine-context's own mutexes
   into registerIpcHandlers") failed with "must pass those same mutexes to registerIpcHandlers"
   -- this is a static-source regex test reading index.js's raw text and matching a
   newline-sensitive pattern (\n\s*mutexes,\n\s*\}\);). Likely broken by CRLF line-ending
   conversion on Windows git checkout, though not yet confirmed by direct inspection of the
   actual failing text.

Since finalize needs ALL 4 build jobs to succeed, the release never un-drafted -- nothing was
ever published or visible via electron-updater's /releases/latest feed. The incomplete draft
(macOS assets only) was deleted immediately after to leave a clean slate; v0.1.1 is Latest
again, unchanged.

SIGNIFICANT FINDING: this appears to be the first time this campaign's release workflow has
actually run npm test on real Windows/Linux CI runners -- every prior test-count claim in this
campaign's history (562/562, 583/583, etc.) was only ever verified on macOS (locally, and by
every worker/reviewer subagent, which all ran on this same machine). Two platform-specific
bugs surfaced immediately on first real cross-platform CI run.

AC#2/#3 remain NOT satisfied -- the release did not successfully build, let alone get
published or live-verified. CCA-63 stays In Progress. The v0.1.2 git tag remains pushed
(accurate -- package.json really is 0.1.2) but a future successful release at this version
will need either these two bugs fixed and the tag moved, or a bump to v0.1.3 -- decision
deferred, proposed as follow-up tasks to the user rather than fixed ad hoc mid-release.

LIVE RE-ATTEMPT SUCCEEDED (2026-08-18, orchestrator-driven, user-approved): bumped
package.json/package-lock.json/licenses.json 0.1.2 -> 0.1.3 (branch
feature/CCA-63-release-v0.1.3, PR #80, merged to dev/main @ 283a5c4), then pushed
tag v0.1.3. release.yml run 32143709009: ALL 4 platform build jobs succeeded
(macos-latest, ubuntu-latest, ubuntu-24.04-arm, windows-latest) plus
prepare/finalize -- the FIRST fully green cross-platform run in this campaign's
history (prior v0.1.2 attempt failed Windows+Linux, now fixed by CCA-67/CCA-68).
v0.1.3 published live, not draft, Latest: https://github.com/evolvconsulting/claude-conduit-app/releases/tag/v0.1.3

AC#2 VERIFIED LIVE (detect + apply, real network, real binaries, no mocks):
winvm/linuxvm (this campaign's precedent VMs from CCA-10.3) were offline; user
powered linuxvm back on mid-session. Built a genuine pre-rename Linux arm64
AppImage locally from the v0.1.1 tag (git worktree, `npx electron-builder --linux
AppImage:arm64`) -- its baked app-update.yml confirmed owner=evolvconsulting
repo=claude-conduit (the OLD slug, byte-verified). Copied to linuxvm, launched
under xvfb-run with --remote-debugging-port, drove via CDP (native Node
WebSocket, Runtime.evaluate against window.nimProxy). BEFORE: getVersion() ->
"0.1.1". App's own startup check (autoDownload=true) auto-fired against the OLD
repo, hit GitHub's real rename redirect (evolvconsulting/claude-conduit ->
claude-conduit-app), found v0.1.3, differential-downloaded it for real (2%
delta, real byte ranges over real HTTPS, logged redirects visible in the app's
own log). Triggered window.nimProxy.update.install() over CDP: proxy-stop
degraded gracefully after 15s timeout (expected -- no litellm configured on
this throwaway VM, exactly CCA-10.1's documented degrade-on-hang design),
quitAndInstall executed the newly-downloaded AppImage. AFTER (relaunched
process, fresh CDP target): getVersion() -> "0.1.3". Confirmed byte-identical
(sha256) to the officially published release asset.

AC#3 VERIFIED LIVE (fresh build, renamed repo, no redirect needed): downloaded
the actual published v0.1.3 arm64 AppImage fresh (never touched by the update
flow above) directly from the GitHub release onto linuxvm; its baked
app-update.yml confirmed owner=evolvconsulting repo=claude-conduit-app (the
NEW slug, byte-verified, no redirect involved). Wiped ~/.config/"Claude
Conduit" first to force a genuine first-run state ("Generated new staging user
ID" confirmed in its own log). Launched under xvfb-run, its own real startup
check against the live feed correctly resolved: "Update for version 0.1.3 is
not available (latest version: 0.1.3, downgrade is disallowed)" -- proving the
auto-update wiring (not just the detection heuristic) works end-to-end for a
build natively configured for the renamed repo. getVersion() via CDP -> "0.1.3".

winvm was not needed -- Linux alone gave a full, real, unmocked detect+download
+install+relaunch cycle without the NSIS-wizard-clicking complexity CCA-10.3
needed on Windows. All scratch (2 AppImages transferred + 1 downloaded, 3 log
files, 2 helper scripts, updater cache, app config dir) removed from linuxvm
after verification; confirmed clean (`ps aux`/`ls` both empty of campaign
artifacts). Local git worktree for the v0.1.1 build removed. SSH tunnels closed.

Both v0.1.1 and v0.1.3 GitHub Releases remain published permanently (matches
CCA-10.3's precedent of never deleting a real published release).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Swept all in-repo URLs to the renamed claude-conduit-app slug (AC#1, PR #73,
prior session). This session completed the remaining live-release verification:
bumped to v0.1.3 (PR #80), pushed the tag, and watched release.yml succeed on
all 4 platforms for the first time in this campaign's history (prior v0.1.2
attempt failed Windows+Linux; CCA-67/CCA-68 fixed those since). v0.1.3 is
published and Latest.

AC#2 verified live: a genuine pre-rename Linux arm64 build (built from the
v0.1.1 tag, app-update.yml confirmed pointing at the OLD repo slug) auto-
detected v0.1.3 through GitHub's real rename redirect, differential-downloaded
it, and installed it -- confirmed via CDP-driven getVersion() going from 0.1.1
to 0.1.3 on the relaunched process.

AC#3 verified live: the actual published v0.1.3 build, run fresh (wiped config,
new staging ID), correctly resolved its own update check against the renamed
repo with no redirect needed (app-update.yml points natively at
claude-conduit-app) -- "not available, latest version 0.1.3" with no errors.

Both verifications ran on linuxvm (powered on mid-session by the user after
winvm/linuxvm were found offline) via xvfb + CDP, using real network calls to
the live GitHub API/CDN, not mocks. All scratch cleaned up afterward. CCA-63 is
fully done -- all 3 ACs verified live.
<!-- SECTION:FINAL_SUMMARY:END -->
