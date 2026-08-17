---
id: CCA-63
title: >-
  Sweep in-repo URLs after the GitHub rename to claude-conduit-app and verify
  auto-update continuity
status: In Progress
assignee: []
created_date: '2026-08-07 18:09'
updated_date: '2026-08-17 15:04'
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
- [ ] #1 No in-repo URL or slug still points at evolvconsulting/claude-conduit except deliberate historical references
- [ ] #2 An existing packaged install (built before the rename) still detects and applies an update published after the rename, verified live
- [ ] #3 A fresh packaged build publishes and auto-updates against the renamed repo, verified live
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
<!-- SECTION:NOTES:END -->
