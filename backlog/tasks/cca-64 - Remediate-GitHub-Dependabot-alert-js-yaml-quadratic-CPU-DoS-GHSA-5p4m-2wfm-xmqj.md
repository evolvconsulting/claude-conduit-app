---
id: CCA-64
title: >-
  Remediate GitHub Dependabot alert: js-yaml quadratic-CPU DoS
  (GHSA-5p4m-2wfm-xmqj)
status: Done
assignee: []
created_date: '2026-08-17 00:10'
updated_date: '2026-08-17 04:06'
labels:
  - security
  - dependencies
dependencies: []
references:
  - 'https://github.com/evolvconsulting/claude-conduit-app/security/dependabot/1'
  - 'https://github.com/advisories/GHSA-5p4m-2wfm-xmqj'
priority: high
ordinal: 82000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Dependabot flagged a high-severity (CVSS 7.5) advisory on the transitive js-yaml@4.3.0 dependency (>=4.0.0 <4.3.1, fixed in 4.3.1): resolveYamlOmap() does an O(n) indexOf scan per entry inside its dedupe loop, making !!omap resolution in yaml.load() quadratic in input size and able to block the Node event loop for seconds on a modestly sized malicious YAML document. js-yaml is pulled in transitively via electron-builder, electron-updater, and pm2 (all deduped to the same 4.3.0), not imported directly by app code, so the fix is a version bump rather than a code change. Resolve or explicitly dismiss the alert so the repo's Dependabot page is clean.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 js-yaml resolves to >=4.3.1 everywhere in package-lock.json (via update, override, or upstream dependency bump)
- [x] #2 npm test and npm run build (or equivalent) still pass after the bump
- [ ] #3 GitHub security alert https://github.com/evolvconsulting/claude-conduit-app/security/dependabot/1 shows fixed, or is dismissed with a documented reason if a fix genuinely isn't available yet
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Verify current js-yaml resolution across the tree (npm ls js-yaml) -- confirm 4.3.0 via
   electron-builder (app-builder-lib/builder-util/dmg-builder), electron-updater, and pm2.
2. Add a package.json `overrides` entry pinning js-yaml to ^4.3.1 (pm2@7.0.3 pins js-yaml at an
   exact, non-caret 4.3.0 in its own package.json, so a plain `npm update` cannot fix this --
   an override is required).
3. Regenerate package-lock.json via npm install; verify every resolution is now >=4.3.1.
4. Diff the real js-yaml 4.3.0 vs 4.3.1 tarballs to confirm the fix is scoped to
   resolveYamlOmap()'s O(n) array+indexOf dedupe -> O(1) hash-map dedupe, no exported API change.
5. Run npm test (baseline vs bumped) and npm run pack (dependency-scan confirms 4.3.1 ships).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Wave-18 implementation evidence (worker, branch `fix/CCA-64-js-yaml-dos`, commit `9e98bb1`,
branched from `52a7f7e`)

Recorded by the orchestrator from the worker's structured return. NOT yet independently reviewed.

**Root cause re-derived, not trusted from the advisory.** `npm ls js-yaml` on dev @ 52a7f7e: 4.3.0
via app-builder-lib/builder-util/dmg-builder (all deduped under electron-builder), electron-updater
directly, and pm2 (deduped). `pm2@7.0.3`'s own package.json pins js-yaml at an EXACT (non-caret)
4.3.0, confirming a plain `npm update` could not have fixed this -- the `overrides` mechanism was
required. Diffed the real 4.3.0 vs 4.3.1 tarballs directly: the entire functional diff is scoped to
`lib/type/omap.js`'s `resolveYamlOmap()` -- an O(n) array+`indexOf` dedupe loop replaced with an O(1)
hash-map dedupe (`objectKeys = []` -> `{}`, `indexOf`/`push` -> `hasOwnProperty`/`defineProperty`).
No exported API change, safe patch bump for all three consumers.

**AC#1**: `package.json` gains `overrides: { "js-yaml": "^4.3.1" }`; `package-lock.json` regenerated.
`npm ls js-yaml` post-bump: all five paths resolve to 4.3.1. Independently reproduced via a clean
`npm ci` from the committed lockfile alone (no reliance on stale `node_modules` state) -- 4.3.1
everywhere. `npm audit`: 2 high severity -> 0.

**AC#2**: `npm test` 522/522 both pre- and post-bump (identical count, zero regressions -- verified
via `git stash` to temporarily revert and reinstall the baseline). `npm run pack`
(`electron-builder --dir`, no signing credentials needed) completed successfully; its own
dependency-scan log explicitly lists `js-yaml@4.3.1` in the packaged tree, confirming the bumped
version is what actually ships.

**AC#3**: not actionable from a worktree (no GitHub API/UI access attempted, per this task's own
scope boundary) -- the Dependabot alert should clear automatically once this merges to `dev` and
GitHub re-scans the updated lockfile.

**Environment note, not a code issue**: a lazy Electron-binary-download race (two test files
concurrently triggering `require('electron')`'s first-run download into the same directory) caused
a transient flake mid-investigation, unrelated to js-yaml -- resolved by warming the binary once
serially before testing.

Files touched: `package.json`, `package-lock.json` only. No source code changes, as expected for a
dependency-version bump.

## Wave-18 review pass 1 verdict — APPROVE (reviewer, Opus, in the branch's own worktree)

Reviewed `9e98bb1`. Every load-bearing claim independently re-derived, not trusted:
- **pm2@7.0.3 pins js-yaml at an exact `4.3.0`** confirmed via the authoritative registry manifest
  (`npm view pm2@7.0.3 dependencies.js-yaml` -> `'4.3.0'`); the other 4 consumers use `^4.1.0` --
  the override mechanism was genuinely required, not just convenient.
- Post-bump: all 5 resolution paths at 4.3.1, exactly one copy in `node_modules`, confirmed via a
  clean `npm ci --ignore-scripts` from the committed lockfile alone (0 vulnerabilities).
- Diff scope: sha256'd every file in both the 4.3.0 and 4.3.1 tarballs -- among `lib/` sources ONLY
  `lib/type/omap.js` differs; `loader.js`/`dumper.js`/all schemas/`index.js` byte-identical.
- **Adversarially probed the "no behavioral change" claim** (the reviewer's own initiative, beyond
  what was asked): ran 10 omap edge cases against both versions -- `__proto__`, `hasOwnProperty`,
  `constructor`, int-vs-string keys, non-scalar keys -- output identical in all 10. Safe because
  `pairKey` always comes from a `for...in` loop (always a string) and the fix uses
  `Object.defineProperty` (dodges the `__proto__` setter trap) + `_hasOwnProperty.call` (dodges
  inherited-property false positives).
- `npm audit`: 2 high (CVSS 7.5) -> 0. `npm test`: 522/522, run twice.
- Packaging verified MORE deeply than the worker's own claim: extracted the real `app.asar` via the
  asar node API directly -- packaged `js-yaml/package.json` version is 4.3.1, packaged `omap.js` is
  sha256-byte-identical to the pristine 4.3.1 tarball, the vulnerable `objectKeys.indexOf` pattern is
  absent from the shipped artifact.
- Electron's own downloader dependencies (`@electron/get`, `@electron-internal/extract-zip`,
  `@types/node`) confirmed to NOT include js-yaml -- the mid-session install flake could not have been
  caused by this bump.
- AC#3 (Dependabot UI) correctly treated as not independently verifiable from a worktree; the
  underlying condition (clean audit) is satisfied.

**Findings, all non-blocking**: (a) should-fix/process, not code -- confirm the Dependabot alert
actually clears on `dev` post-merge; (b) nit -- commit message says the diff is "scoped to
lib/type/omap.js", technically imprecise since rebuilt `dist/` bundles and the package.json version
line also differ as artifacts of that same change; (c) nit -- two pre-existing comments elsewhere
still say js-yaml is "not a declared" dependency, still technically true (an override isn't a
declaration) but worth a glance if anyone's confused later.

**Two things flagged worth protecting from future well-meaning edits**: `^4.3.1` must NOT be
tightened to `>=4.3.1` -- js-yaml 5.3.0 is `latest` (4.x is the `v4-legacy` dist-tag), so an unbounded
`>=` would float to 5.x and break the other `^4.1.0` consumers. And `npm audit fix --force` was
correctly avoided -- it would have downgraded pm2 to 5.3.1, a breaking change.

**Disclosure, resolved cleanly**: a mid-review `asar extract-file` mistake briefly overwrote the
worktree's `package.json` and dropped a stray `omap.js` (after the pack run, so packaging results
unaffected); both restored via `git checkout`, orchestrator independently confirmed `git status`
clean and HEAD still `9e98bb1` before merging.

npm test (reviewer's own run): 522/522.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Pinned js-yaml to >=4.3.1 via a package.json overrides entry (pm2@7.0.3 pins js-yaml at an exact 4.3.0, so a plain npm update could not fix this). Closes GHSA-5p4m-2wfm-xmqj, a quadratic-CPU DoS in resolveYamlOmap()'s dedupe loop.

Approved on the first review pass (opus): every load-bearing claim independently re-derived, including a byte-level diff of the real 4.3.0 vs 4.3.1 tarballs (confirms the fix is scoped to the omap dedupe, no other behavioral change) and an adversarial 10-case prototype-key probe (identical output both versions). npm audit: 2 high (CVSS 7.5) -> 0. npm test: 522/522, unchanged (dependency-version bump only, zero source changes). Packaging verified by extracting the real app.asar directly: js-yaml 4.3.1 genuinely ships in the built artifact.

Merged as PR #68 (806f5ce).

AC#3 (the GitHub Dependabot alert itself showing fixed) is left unchecked: that's an external GitHub-side rescan of the updated lockfile, not independently verifiable from a worktree or checkable at merge time. The underlying condition -- a clean `npm audit` on the merged lockfile -- is satisfied; the alert is expected to clear automatically on GitHub's next scan.
<!-- SECTION:FINAL_SUMMARY:END -->
