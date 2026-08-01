---
id: NCOW-12
title: Rebrand to Claude Conduit and rename the repo to claude-conduit
status: In Progress
assignee: []
created_date: '2026-07-31 21:50'
updated_date: '2026-08-01 18:12'
labels: []
dependencies: []
priority: high
type: task
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rename the product from "NIM Proxy Manager" to "Claude Conduit", and the repository from nvidia-nim-proxy (GitHub remote evolvconsulting/nvidia-cowork) to claude-conduit.

SEQUENCING: this should land BEFORE NCOW-9 (publish and install story) and NCOW-10 (auto-update). Renaming after publishing means broken download links, a moved repo URL, a changed appId, and an update feed that no longer matches installed builds. It is also a natural fit alongside NCOW-14, which drops the NVIDIA-specific framing from the product itself.

The rename reaches further than strings. At minimum it touches: package.json name and productName; electron-builder appId (com.evolvconsulting.nimproxymanager), productName, dmg title, and the Linux desktopName and StartupWMClass; the app icon and the icon source; the REPO_URL constant shared by the menu, the About dialog and the IPC external-URL allowlist; the macOS dev-bundle rename script; the tray tooltip and menu labels; README, DESIGN.md and CLAUDE.md; and the generated licenses.json.

It also touches things with USER DATA behind them, which need a migration decision rather than a find and replace: the config directory (~/.config/claude-nim-proxy and the Windows equivalent), the pm2 app name (litellm-nim), the Electron userData directory (which is derived from productName and holds the encrypted API key), and the dedicated entry this app writes into Claude Desktop configLibrary. Decide for each whether to migrate an existing install, leave it on the old path, or require a reinstall, and say so in the README.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Product name reads Claude Conduit everywhere the user can see it: window title, macOS menu bar, dock and taskbar, tray tooltip, About dialog, installer and desktop entry
- [ ] #2 The repository is renamed to claude-conduit and every hardcoded URL in the app, tests and docs points at the new location
- [ ] #3 electron-builder appId, productName, dmg title and Linux desktop identifiers are updated, and a packaged build carries them
- [ ] #4 A documented decision covers each piece of persisted state (config directory, pm2 app name, Electron userData holding the encrypted key, Claude Desktop entry): migrate, leave, or reinstall
- [ ] #5 Whatever migration is chosen is implemented and verified against a real pre-rename install, including that the stored API key is still readable afterwards
- [ ] #6 No occurrence of the old product name or repo slug remains in src, tests, docs or build config except where deliberately retained for migration
- [ ] #7 README documents what existing users must do, if anything
- [ ] #8 `npm test` passes and a packaged build launches under the new identity
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
AC#1/#3 (identity): package.json name/productName -> claude-conduit/Claude Conduit; electron-builder appId -> com.evolvconsulting.claudeconduit, productName, dmg title, Linux StartupWMClass -> claude-conduit; menu/tray/About/window-title/sidebar updated; licenses.json regenerated (embeds productName).

AC#2 (repo slug/URLs): REPO_URL in menu.js/about-dialog.js -> https://github.com/evolvconsulting/claude-conduit (same org, per locked decision; actual gh repo rename left undone, out of scope).

AC#4/#5 (persisted-state decisions, each implemented + verified via fixtures only, never real machine state):
- Config dir (~/.config/claude-nim-proxy -> claude-conduit): migrate, unprompted. New configDirMigration.js renames on startup and rewrites absolute paths baked into run.js/ecosystem.config.cjs.
- pm2 app name (litellm-nim): leave -- internal identifier, not user-visible; NCOW-14 is the more natural rename point.
- Electron userData / encrypted key: migrate via best-effort non-destructive copy. macOS safeStorage keys its Keychain entry to app_name + " Safe Storage", so the copied blob is expected to fail to decrypt on macOS post-rename (Windows DPAPI should keep working). Safe because secretStore.load() already treats decrypt failure as "no key stored," never a crash. Documented honestly in README.
- Claude Desktop entry: migrate display name only, riding the existing consent-gated applyGatewayConfig() write (no new consent surface); entries were already reused by id regardless of name.

AC#6: swept the worktree; remaining old-name/slug occurrences outside backlog/archive are deliberate migration-context references (LEGACY_* constants, upgrade-doc prose, DESIGN.md historical banner).

AC#7: README gets an "Upgrading from NIM Proxy Manager" section, one row per persisted-state item.

AC#8: npm run pack succeeded; static Info.plist check (CFBundleName/CFBundleDisplayName = Claude Conduit, CFBundleIdentifier = com.evolvconsulting.claudeconduit); live packaged-build launch under NIM_PROXY_TEST_HOME confirmed document.title == "Claude Conduit" over CDP, then killed. Self-caught gap: Electron's own internal --user-data-dir (Chromium cache) isn't covered by NIM_PROXY_TEST_HOME -- fixed the one path with real sensitivity (the app's own nim-key.enc write, via resolveUserDataPaths()) and documented the remaining Electron-internal-cache limitation in CLAUDE.md as accepted.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
npm test: 175/175 pass (baseline was 161; +14 new tests: configDirMigration, userDataMigration, claudeDesktopConfig entry-rename, paths).

npm run pack succeeded. Static Info.plist check (zero-execution): CFBundleName/CFBundleDisplayName = Claude Conduit, CFBundleIdentifier = com.evolvconsulting.claudeconduit.

Live packaged-build launch, careful: ran the packaged binary directly with NIM_PROXY_TEST_HOME set and --remote-debugging-port, queried document.title over CDP -> "Claude Conduit", confirmed empty #setup route (fresh install under fake home), killed immediately.

Self-caught issue during that check: Electron sets its own internal --user-data-dir (Chromium session/cache) from the real per-OS default before app code runs -- NIM_PROXY_TEST_HOME did not cover this pre-existing gap. First launch created a real ~/Library/Application Support/Claude Conduit/ (Chromium housekeeping only, no key file, confirmed) -- killed, deleted that folder, then fixed the path that actually matters: index.js's new resolveUserDataPaths() now redirects the file this app itself writes (nim-key.enc) under NIM_PROXY_TEST_HOME. Electron's own internal cache dir still isn't redirectable short of app.setPath() before ready -- documented as a known, accepted limit in CLAUDE.md.

At no point was this machine's real ~/.config/claude-nim-proxy, real pm2 litellm-nim, real ~/Library/Application Support/NIM Proxy Manager (never even read), or real Claude Desktop config touched.

Honest AC#5 gap: "verified against a real pre-rename install" is not literally satisfied by design, per the campaign's safety constraint -- worker believes it cannot be without a human running one real supervised pass. What was verified instead: the copy mechanism itself (fixtures), the decrypt-failure-is-graceful path (pre-existing behavior, now documented), and Electron's actual sourced behavior explaining why macOS won't carry the key over. Flagged explicitly rather than overclaiming.

Flags for human/reviewer judgment:
1. AC#5's "real pre-rename install" wording -- worker believes this needs one human-supervised real pass before the strictest reading of AC#5 is satisfied.
2. Worker self-corrected a process mistake: initially edited CLAUDE.md in the main repo path by copy-paste error, caught via git status, reverted with git checkout --, confirmed byte-identical, redid the edit in the worktree. Orchestrator independently verified: main repo's CLAUDE.md is clean, no diff.
3. Icon not redesigned (still NVIDIA green + evolv terracotta) -- only doc comments updated; worker's read is that a real icon redesign belongs to NCOW-14 (drops NVIDIA framing), not this rename.
4. Did not touch .claude/skills/backlog-handover/SKILL.md's references to litellm-nim/NIM_PROXY_TEST_HOME/feat/nim-proxy-manager -- treated as campaign infra/historical, not product source/docs.

Orchestrator verification before review dispatch: confirmed branch feat/NCOW-12-rebrand-claude-conduit (4 commits on 398ab91) is pushed to origin; confirmed orchestrator's own main dev checkout has zero diff on CLAUDE.md (flag #2 above is real and already resolved).

Opus review, pass 1: request_changes (narrow). Confirmed AC indices: 1, 2, 3, 4, 6, 7, 8 (independently re-verified each -- ran npm test itself, 175/175; read the diff; read the packaged Info.plist directly; reproduced the migration-path claims by reading the actual code, not trusting summaries). AC#5 explicitly PARTIAL, not rounded to pass or fail: migration logic implemented correctly and fixture-verified (10 new tests, idempotent, non-destructive, EXDEV fallback -- all spot-checked and held), but "verified against a real pre-rename install" is genuinely not satisfied, by design. Reviewer's judgment: this is the CORRECT call, not an escalation -- deferring the one-way destructive real-data pass to a human-supervised step is the right autonomous-agent behavior, not a gap. Recommended NOT to route to human_needed; recommended merging once the defect below is fixed, with AC#5 recorded as "implemented + fixture-verified, real-machine leg outstanding."

Safety verification: CONFIRMED, no doubt. Reviewer independently read-only-checked this machine's real ~/.config/claude-nim-proxy (intact, all files Jul-31-dated), real nim-key.enc (untouched, Jul-31 mtime), confirmed no ~/Library/Application Support/Claude Conduit/ residue, confirmed no litellm-nim pm2 app exists, confirmed Claude Desktop's real _meta.json still reads "NIM Proxy Manager" (untouched, consent-gated). Nothing in this diff or the worker's activity touched real user data.

Risk note for the human pass later: migrateLegacyConfigDir runs unprompted at startup before anything else touches configDir, and the packaged binary honors --dev purely via process.argv -- so dist/mac-arm64/Claude Conduit.app launched WITHOUT --dev + NIM_PROXY_TEST_HOME will immediately rename the real config dir and copy the real key. Correct end-user behavior, but that .app in the worktree is live ammunition on this machine until the eventual real-machine verification pass is run deliberately.

Defects found (all LOW/TRIVIAL, none structural):
1. LOW -- duplicate Claude Desktop entry when manifest.json lacks desktop_config_entry_id. Empirically reproduced: findOrCreateEntryByName searches for "Claude Conduit" only, misses a legacy-named entry, creates a second one instead of reusing it. Reachable via purge-uninstall (destroys manifest) + declining the Claude Desktop opt-in, then reinstall + Apply. Fix: ~4 lines, fall back to a LEGACY_ENTRY_NAME lookup before creating.
2. LOW (same fix) -- README claim "upgrading never creates a duplicate" is false given defect 1; needs correcting alongside the code fix.
3. TRIVIAL -- .gitignore:7 has a stale "claude-nim-proxy" comment unrelated to migration.
4. TRIVIAL -- README:199 says the repo was "nvidia-nim-proxy"; the actual remote slug is nvidia-cowork.

Independent technical verification: confirmed secretStore.load()'s decrypt-failure handling is pre-existing/unchanged (diff to secretStore.js is comment-only); confirmed configDirMigration.js really rewrites the 5 absolute-path occurrences configGen.js bakes into this machine's real run.js/ecosystem.config.cjs; confirmed the Claude Desktop entry really is reused by id (not name) in applyGatewayConfig, and the name mutation is persisted via writeMeta.

Dispatching a fresh worker fix pass for defects 1-4 into the same worktree; capped at 2 retries per campaign policy before this would auto-escalate.

Fix pass 1 (worker) addressed all 4 review-pass-1 findings:

Defect 1 (LOW, duplicate Claude Desktop entry): findOrCreateEntryByName in src/engine/claudeDesktopConfig.js gained an optional legacyName param; applyGatewayConfig now passes LEGACY_ENTRY_NAME through on the non-id path so a missing manifest.json falls back to a legacy-name lookup instead of creating a duplicate. Display-name touch-up now runs on both the id-reuse path and the legacy-name-fallback path. New test in test/engine/claudeDesktopConfig.test.js reproduces the reviewer's exact repro (no manifest option, only a legacy-named entry present) and asserts entryId reused, no duplicate (entries.length === 1), name updated, config content updated.

Defect 2 (LOW, false README claim): corrected to describe both the id-based path and the legacy-name fallback rather than overclaiming "never creates a duplicate."

Defect 3 (TRIVIAL, .gitignore): stale "claude-nim-proxy" comment updated to "claude-conduit".

Defect 4 (TRIVIAL, wrong old repo slug in README): corrected "nvidia-nim-proxy" to the actual remote slug "nvidia-cowork" (confirmed via git remote -v in the worktree).

npm test: 176/176 pass (175 + 1 new), run twice (before and after both commits).

Commits: f775fb8 (engine fix + test), 0e19d45 (docs). Pushed to origin/feat/NCOW-12-rebrand-claude-conduit @ 0e19d45. Orchestrator independently confirmed the push and a clean worktree.

Dispatching review pass 2 (opus) into the same worktree -- second and final review pass under the campaign's 2-retry cap.

Opus review, pass 2 (final): APPROVE. Confirmed AC indices: 1, 2, 3, 4, 6, 7, 8 -- re-ran npm test independently (176/176), and specifically mutation-tested Defect 1's fix by reverting claudeDesktopConfig.js to the pre-fix version and re-running the new test, which failed as expected (proves the test is non-vacuous and pins the exact regression). Ran an independent 5-scenario repro script beyond the worker's own test: (a) valid id reuses by id, (b) no id + legacy entry present alongside an unrelated entry reuses/renames only the legacy one without touching the unrelated entry's config, (b2) repeated Apply with still-no-id converges rather than duplicating, (c) no id + no legacy + no new-named entry creates exactly one fresh entry, (d) revertToDefault's 3-arg call leaves legacyName undefined so the fallback cannot hijack the Anthropic-default path. All 4 original defects (2 LOW, 2 TRIVIAL) independently confirmed fixed. Diff for the fix pass touches exactly 4 files (.gitignore, README.md, claudeDesktopConfig.js, its test) -- no drive-bys. AC#5 remains PARTIAL as before (correct, not an escalation).

One new TRIVIAL defect, self-introduced by the fix pass: the new test bumped the suite from 175 to 176, but CLAUDE.md:50 and README.md:221 still document "175 tests." Reviewer's explicit recommendation: apply this one-line-each fix at merge time, does NOT warrant a third review pass.

Final recommendation: ready to merge once the 175->176 doc bump is applied.
<!-- SECTION:NOTES:END -->
