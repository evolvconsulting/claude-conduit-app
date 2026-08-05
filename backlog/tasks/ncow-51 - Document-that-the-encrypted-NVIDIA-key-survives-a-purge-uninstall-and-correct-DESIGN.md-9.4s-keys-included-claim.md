---
id: NCOW-51
title: >-
  Document that the encrypted NVIDIA key survives a purge uninstall, and correct
  DESIGN.md 9.4's '(keys included)' claim
status: In Progress
assignee: []
created_date: '2026-08-05 17:04'
updated_date: '2026-08-05 17:53'
labels:
  - documentation
dependencies: []
ordinal: 64000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found by the wave-8 integration review of NCOW-47. <userData>/nim-key.enc is the canonical store for the user's NVIDIA API key, and src/engine/uninstall.js never touches it — the ONLY caller of secretStore.clear() in all of src/ is apiKey.clear (src/main/engine-context.js:295). A purge uninstall deletes the DERIVED copy of the key in litellm.env (written by src/engine/configGen.js:376, inside the config directory) and leaves the encrypted original on disk. So DESIGN.md:597-598 (section 9.4 step 4) — '--purge: delete ~/.config/claude-conduit/ entirely (keys included)' — now reads as a promise the shipped app does not keep. Correspondingly, README.md's 'Where things live' table (README.md:266-273) omits nim-key.enc entirely, even though that same table goes to the trouble of documenting that the ~227MiB ~/.pm2/daemon-interpreter/ copy survives an uninstall. A user who purges specifically in order to remove their credential is not told it is still on disk. This is pre-existing behaviour, not something NCOW-47 changed — but NCOW-47's merged comments (src/main/ipc.js:115-129 and src/main/mutex.js:69-76) now formally describe that file as lock-guarded shared state alongside the config directory, which makes the config-dir-purged / key-file-retained asymmetry conspicuous and this the natural moment to resolve it. Deliberately NOT settled by this task as filed: whether the right answer is documentation only, or an additional opt-in. CLAUDE.md's standing pattern is that destructive extras are individually confirmed opt-ins and never side effects — 'Uninstall never touches Claude Desktop as a side effect; that is a separate, individually confirmed opt-in in the Uninstall view' — so an 'also forget my saved API key' checkbox would follow existing precedent rather than invent anything. That is a product decision for whoever picks this up to make and record, not a defect in this description. Note also that the encrypted key file's location is itself already documented as a migration decision in README (NCOW-12 moved it under the claude-conduit userData directory), so any doc change here should be consistent with that section rather than duplicating it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 DESIGN.md section 9.4's '(keys included)' claim is corrected so it accurately describes what a purge does and does not delete — specifically that litellm.env's derived copy goes and <userData>/nim-key.enc remains
- [ ] #2 README.md's 'Where things live' table lists the encrypted key file and states explicitly whether an uninstall removes it, matching the level of detail that table already gives ~/.pm2/daemon-interpreter/
- [ ] #3 The claim is verified against real code before being written, not assumed: the single secretStore.clear() call site and uninstall.js's actual delete set are both checked and the finding recorded
- [ ] #4 An explicit, recorded decision is made on whether to add an opt-in 'also forget my saved API key' step to the Uninstall view — either implemented as a separately confirmed opt-in following the Claude Desktop precedent, or deliberately deferred with the reasoning stated
- [ ] #5 If any behaviour change is made, a test covers it; if the task lands as documentation only, that is stated as the decision rather than left implicit
- [ ] #6 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read NCOW-51 in full, incorporating the orchestrator's dispatch-time correction that the '(keys included)' claim is at DESIGN.md:604, not the cited 597-598, plus the two further purge claims at DESIGN.md:765/784 the task text omits.
2. Establish an npm test baseline before any edit.
3. Verify AC#3's factual premise against real code rather than assuming it: grep every secretStore.clear() call site, read secretStore.js and src/engine/uninstall.js in full, read the relevant engine-context.js/ipc.js regions.
4. Correct DESIGN.md 9.4 step 4 to state accurately what --purge does and does not delete; evaluate the two secondary claims and decide explicitly what each needs.
5. Add the missing nim-key.enc row to README.md's 'Where things live' table, consistent with (not duplicating) the existing NCOW-12 migration section, plus a caveat under 'Uninstalling'.
6. Decide and record AC#4 (implement the opt-in vs. defer it) with reasoning.
7. Re-run npm test, commit, push.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Wave 9 worker evidence (recorded by the campaign orchestrator; independent review pending)

Branch `fix/NCOW-51-document-key-survives-purge` @ `e871cf7`, based on dev @ `84bb0d0`. One commit, 3 files, +32/-4.

**AC#1 / AC#3 (verify, then correct).** Read `src/engine/secretStore.js` in full. `grep -rn 'secretStore\.clear\|secretStore\.js' src/` returned exactly ONE call site: `src/main/engine-context.js:295`, inside the `apiKey.clear` handler — confirming the task's premise. Read `src/engine/uninstall.js` in full; its real delete set is (a) `removeClaudeCodeSettings()` against the settings file's `env_keys_set`, (b) `pm2Control.remove()` (the `litellm-nim` pm2 app), (c) only under `opts.purge`, `fs.rmSync(opts.configDir)`. It never references secretStore or nim-key.enc at all. secretStore.js's own header states the file is deliberately OUTSIDE the config dir. DESIGN.md:604 corrected accordingly.

**Secondary claims — decided explicitly rather than silently skipped.** The worker judged DESIGN.md's AC#5 line (~769 post-edit) and the T9 manual-test row (~788 post-edit) to be literally accurate as scoped — the first promises only 'no trace under the config directory', the second describes the unrelated *proxy* master key — so it declined to rewrite them as false, and instead added a parenthetical cross-reference to 9.4 on each so 'no trace' cannot be misread as 'no trace of the API key anywhere'.

**AC#2.** New row in README.md's 'Where things live' table, placed after the `~/.pm2/daemon-interpreter/` row and matching its level of detail: nim-key.enc's location, and that it survives every uninstall including --purge, citing uninstall.js's real delete set. Cross-references rather than duplicates the existing NCOW-12 migration table. Also added a paragraph under '## Uninstalling' stating the same fact and pointing at the existing Clear Key button as the workaround. Premise independently confirmed: `grep -n nim-key README.md` returned nothing pre-change.

**AC#4 — DECISION: DEFER the opt-in.** Recorded in the commit message and in a new 16-line comment block in `src/engine/uninstall.js` (no functional change). Worker's stated reasoning: implementing it would touch `uninstall()` and the `uninstall:run` IPC path, the same handler its concurrently-dispatched wave-mate NCOW-48 is restructuring, so landing a second structural change there now raises integration risk without closing an information gap that documentation plus the existing Clear Key button does not already close. **Orchestrator flag for review: this reasoning is substantially an orchestration/timing argument, not the product argument AC#4 asks for. The reviewer was explicitly directed to test whether the deferral stands on product merit independent of wave timing.**

**AC#5.** Landed as documentation-only; stated as the explicit decision in the commit message and the uninstall.js comment. No test added, on the reading that AC#5 requires one only if behaviour changes.

**AC#6 / quality gate.** `npm test` 416/416 pass baseline (observed before any edit) and 416/416 pass after (observed post-commit). `CLAUDE.md:51` and `README.md:330` deliberately untouched per wave-9 test-count ownership — verified by the worker via git diff and sed on both exact lines.

**files_touched**: DESIGN.md, README.md, src/engine/uninstall.js (comment only).

**Worker's own open question**: if NCOW-48 lands its bounded-timeout work, the deferred opt-in becomes safe to pick up as a fresh follow-up against a stable handler.

## Wave 9 review pass 1 — REQUEST_CHANGES (independent opus review; recorded by the orchestrator)

**Confirmed AC: #1, #5, #6. Not confirmed: #2, #3, #4.**

**F1 BLOCKING — the new README text tells the user to press a button that does not exist.** README.md:391 said 'clear it from the Setup view's **Clear Key** button before uninstalling.' There is no Clear Key button anywhere in the app and there never has been. Reviewer's evidence: the complete set of `window.nimProxy.apiKey.*` calls in `src/renderer/` is `validateAndSave` (setup-view.js:157) and `getMasked` (app.js:41) — `apiKey.clear` has ZERO renderer callers; `renderApiKeyStep` (setup-view.js:115-148) renders exactly two buttons, 'Validate & Save' and 'Continue'; no dynamic dispatch exists (`grep -rn 'nimProxy\['` → no hits); `git log -S 'Clear Key' --all -- src/renderer/` → no commits, ever.

**F2 BLOCKING — README.md:272's mechanism clause is false.** It asserted secretStore.clear()'s 'only caller in the whole app is the Clear Key button (Setup view → apiKey.clear)'. The only caller is the `apiKey.clear` IPC *handler*, which no UI invokes. The true fact is materially MORE severe than the row claims: nothing in the shipped app deletes nim-key.enc.

**F3 BLOCKING — the same false mechanism was repeated in production source.** src/engine/uninstall.js:15-17 ('secretStore.clear()'s one existing caller is the Setup view's Clear Key button') and :24-25 ('the interim workaround (Clear Key, then uninstall)'). This is precisely the failure class NCOW-47's AC#4 was rejected twice for — a comment naming a mechanism is a testable claim, and this one was wrong in the confident direction.

**F4 BLOCKING — AC#4's recorded reasoning is unsound on two independent counts.** (a) It is a wave-timing argument, as the orchestrator suspected: the load-bearing sentence is that NCOW-48 is restructuring the same handler 'in the same wave'. **That premise is also factually false — NCOW-48's branch (ea38690) does not touch src/engine/uninstall.js at all** (it touches pm2Control.js, its two test files, CLAUDE.md and README.md). The claimed collision does not exist. The commit body meanwhile concedes the opt-in 'would follow' CLAUDE.md's precedent and 'is a legitimate follow-up' — an argument FOR it, with only expired timing offered against. (b) The product justification rests on 'the existing Clear Key button' closing the information gap; there is no such button, and with no workaround the app has NO user-accessible way to remove a stored credential, which strengthens the case for the opt-in rather than excusing its absence. The reviewer would not block on the *decision* to defer — it blocks on the *record*.

**F6 MAJOR — comment scope.** Placement in uninstall.js is fine and has direct precedent (the NCOW-24 block at :47-63 records exactly this kind of deferral beside the code), but :19-24's content is wave state, which is both already false and meaningless next quarter. The NCOW-24 block by contrast records a durable technical reason.

**F7/F8/F9 MINOR.** (F7) README's new text uses the CLI spelling `--purge` in a GUI README with no flags; the UI radio (uninstall-view.js:24) and README's own Uninstalling section say 'Purge' — DESIGN.md's `--purge` is correct because that is the CLI spec, README's is not. (F8) the new row cites only `~/.config/claude-conduit/` where the table's own first row gives both that and `%APPDATA%\claude-conduit\`. (F9) 'Survives **every** uninstall' rests on electron-builder's `deleteAppDataOnUninstall` defaulting to false, which is not set anywhere (electron-builder.yml is silent) — true today, silently falsifiable later.

**AC#5's documentation-only claim CONFIRMED by proof, not inspection.** esprima token-stream comparison (`tokenize(src,{comment:false})`): dev 188 tokens, HEAD 188 tokens, JSON.stringify of both streams identical by full string comparison. Independently corroborated by excising comments at their esprima range offsets and whitespace-normalizing — both reduce to the identical 769-character string. Full AST comparison was attempted and is unavailable: the vendored esprima (ES2017-era) cannot parse `opts.manifest?.cli_configured` (throws equally on both files) and acorn is absent from node_modules. **Worth carrying forward as a limit on this campaign's established technique.**

**npm test**: reviewer's own run 416/416 pass, 0 fail, 0 cancelled.

**Merge safety verified non-destructively rather than argued**: `git merge-tree --write-tree --messages e871cf7 ea38690` exits 0, tree 425b414, reports only 'Auto-merging README.md' — no conflict, either merge order safe. Overlap risk LOW, lower than the dispatch brief assumed.

**F5 MAJOR, pre-existing, explicitly NOT this branch's fault — flagged for separate filing.** `apikey:clear` is a live IPC channel (ipc-channels.js:44) with a handler, a mutex alias (ipc.js:158) and three tests (ipc-mutex.test.js:1055/1095/1227), but no UI caller at all. Two consequences: (a) the app has no user-accessible way to delete a stored credential, making AC#4's opt-in a real product gap rather than a nice-to-have; (b) NCOW-47's stated reproducing case — 'clicking Clear Key while a config:generate is in flight', still asserted at src/main/ipc.js:121 — is not reachable in the shipped UI, so that comment overstates it (the lock remains defensible as defence-in-depth).

## Wave 9 fix pass 1 (post-review-pass-1) — recorded by the orchestrator; re-review pending

New commit `516a9a6` on top of `e871cf7` (not amended). Touched README.md and src/engine/uninstall.js only — DESIGN.md left as pass 1 landed it, since AC#1 was already confirmed.

**F1 fixed.** README's Uninstalling section no longer names a Clear Key button. Replaced with the honest remedy: no in-app way exists; delete `nim-key.enc` by hand, with real per-platform userData paths (`~/Library/Application Support/Claude Conduit/` macOS, `~/.config/Claude Conduit/` Linux, `%APPDATA%\Claude Conduit\` Windows). Paths derived from `src/engine/paths.js:136-147` (resolveElectronAppDataDir: win32→APPDATA, darwin→Library/Application Support, else→.config) plus productName 'Claude Conduit' (package.json:3, electron-builder.yml:9), corroborated by userDataMigration.js:6-8's '<appData>/<productName>' comment.

**F2 fixed.** The table row's mechanism clause now reads that secretStore.clear()'s only caller anywhere is the `apiKey.clear` IPC handler, that no shipped UI invokes it, and therefore that nothing in the app deletes nim-key.enc — the stronger, true statement.

**F3 fixed.** Both false sentences in src/engine/uninstall.js rewritten to the same true mechanism, pointing at README's Uninstalling section for the per-platform path.

**F4 fixed / AC#4 re-grounded on durable product reasoning.** The opt-in is now recorded as warranted on its merits — it mirrors the Claude Desktop opt-in precedent and CLAUDE.md's standing 'destructive extras are individually confirmed opt-ins, never side effects' rule, and today there is no in-app remedy at all — and deferred because THIS task is scoped to documentation while the opt-in needs its own confirmation-dialog UX plus test coverage. All NCOW-48/wave-timing language removed from source. The worker verified the false premise before deleting it: `git diff --stat 84bb0d0 ea38690` lists only CLAUDE.md, README.md, src/engine/pm2Control.js and the two test files — uninstall.js is absent. No follow-up task ID was invented.

**F6 fixed** (same edit removed all wave-state content; `grep -n NCOW-48 README.md src/engine/uninstall.js` → empty). **F7 fixed** (GUI-facing text now says 'Purge', matching uninstall-view.js:24's radio label; DESIGN.md's `--purge` correctly left alone as the CLI spec). **F8 fixed** (row now gives both `~/.config/claude-conduit/` and `%APPDATA%\claude-conduit\`, matching README:268's first row). **F9 fixed by scoping, not by changing build config** (now 'Survives this app's own Uninstall flow, including Purge'; `deleteAppDataOnUninstall` confirmed unset).

**Negative checks the worker ran post-edit**: `grep -n 'Clear Key' README.md src/engine/uninstall.js`, `grep -n -- '--purge' README.md`, `grep -n 'NCOW-48' README.md src/engine/uninstall.js` — all empty. Also confirmed secretStore.js's `load()` catches ENOENT and returns null, so a hand-deleted key file degrades cleanly rather than crashing.

**Comment-only property preserved**: esprima token-stream comparison of `git show 84bb0d0:src/engine/uninstall.js` vs the post-fix file — 188 tokens each, JSON.stringify identical.

**npm test**: 416/416 pass, 0 fail.

## Wave 9 review pass 2 — APPROVE (same opus reviewer, resumed for the delta; recorded by the orchestrator)

**Verdict: approve. All 6 acceptance criteria independently confirmed (#1-#6). No unconfirmed criteria.**

### CORRECTION TO THIS TASK'S OWN EARLIER NOTES (reviewer finding F11, orchestrator action)

The worker-evidence note recorded above, before review, repeats the false claim the review removed from the code. **Both of the following statements in this task's earlier Implementation Notes are FALSE and are corrected here:**
- under AC#2, 'pointing at the existing Clear Key button as the workaround' — **there is no Clear Key button and there never has been**;
- under AC#4, 'documentation plus the existing Clear Key button' closing the information gap — **no such button exists, so nothing closed the gap**.

The true position, as now documented in README.md and src/engine/uninstall.js: `secretStore.clear()`'s only caller anywhere is the `apiKey.clear` IPC handler, no shipped UI invokes it, and therefore **nothing in the shipped app deletes nim-key.enc** — the only way to remove it is to delete the file by hand. Recorded explicitly so the next reader does not inherit the error this review removed from the code.

### F1's replacement claim — verified path by path, including EMPIRICALLY on this machine

The reviewer treated the new 'delete nim-key.enc by hand' instruction as a fresh claim of exactly the class it had just rejected. Resolution chain: `package.json` productName = 'Claude Conduit' (matching electron-builder.yml:9); **no `app.setName()` exists anywhere in src/main**, so `app.name` resolves to productName — electron.d.ts:1960-1967 (Electron 43.2.0, the version installed here) states productName 'will be preferred over `name` by Electron'; main/index.js:44 takes the real path straight from `app.getPath('userData')`; userDataMigration.js:6-9 independently records the same rule; paths.js:136-147 duplicates the appData convention.

**macOS EMPIRICALLY CONFIRMED, not merely derived**: a read-only probe of this machine found `/Users/jdnewhouse/Library/Application Support/Claude Conduit/nim-key.enc`, mode 0600, 83 bytes, alongside the Chromium housekeeping CLAUDE.md describes — exactly the path README now prints, from a real run. Windows `%APPDATA%\Claude Conduit\` and Linux `~/.config/Claude Conduit/` are correct per the resolution chain; not live-verifiable from macOS, not blocking.

**Blast radius is bounded by construction**: the instruction names a specific filename, so a user who lands in the wrong directory finds nothing to delete rather than deleting the wrong thing.

**Linux conflation check (specifically requested)**: the two directories are genuinely distinct and the text does not confuse them — config dir is `~/.config/claude-conduit/` (paths.js:61, lowercase-hyphenated), Linux userData is `~/.config/Claude Conduit/`. The paragraph opens 'It lives encrypted, outside the config directory entirely', which states the distinction.

### F2/F3/F7/F8/F9 all RESOLVED, each re-verified by negative grep
`grep -n 'Clear Key' README.md DESIGN.md src/engine/uninstall.js` → zero hits. `grep -n -- '--purge' README.md` → zero hits (DESIGN.md correctly retains it as the CLI spec, and is byte-unchanged since pass 1, consistent with AC#1 already being confirmed). Every mechanism claim in the new uninstall.js block is substantiated, including 'the only way to remove it is to delete the file by hand' — validateAndSave overwrites but never removes; userDataMigration.js copies and explicitly never deletes; nothing else writes that path.

### AC#4 judgment: SOUND now, on both counts previously rejected
The reasoning is re-grounded on product merit that does not expire, and **correctly treats the absent remedy as strengthening the case for the opt-in rather than excusing its absence — the exact inversion of pass 1's false premise.** The deferral rationale is now scope plus real implementation cost (confirmation-dialog UX + test coverage), both true indefinitely. Every trace of the NCOW-48/wave-timing argument is gone from the diff and the final file. No follow-up task ID was invented, which the reviewer judged the right call — a fabricated ID would be a fresh unverifiable claim.

### Comment-only property re-proven by the reviewer's own run
base `84bb0d0:src/engine/uninstall.js` vs the worktree file at `516a9a6`: esprima.tokenize({comment:false}) → 188 vs 188 tokens, streams identical by full JSON string comparison; corroborated by excising comments at their esprima range offsets and whitespace-normalizing, both reducing to the same 769-character string. **The +20/-0 is comment-only across the WHOLE branch, not merely the fix delta.** Full-AST comparison remains unavailable (vendored esprima cannot parse `opts.manifest?.cli_configured`, failing identically on both files; acorn absent from node_modules).

**npm test**: reviewer's own run at 516a9a6 — 416/416 pass, 0 fail, 0 cancelled.

**Merge safety re-verified non-destructively at the new tip**: `git merge-tree --write-tree --messages 516a9a6 ea38690` exits 0, tree 6a30206, only 'Auto-merging README.md' — no conflict, either order. The pass-1 semantic staleness is also gone now that the false NCOW-48 collision claim has been removed from the comment.

### Residual minors accepted, NOT blocking (carried to the wave integration review)
- **F10**: on Linux the userData and config dirs are siblings differing only by case/separator and now appear ~120 lines apart in the same README; one clarifying clause would remove the last ambiguity. Self-correcting today because the instruction names the file.
- **F12**: 'it will simply prompt you to re-enter the key next time it's needed' is slightly generous. The load-bearing half is exactly true (secretStore.js:56, ENOENT → null, so a missing file is indistinguishable from never-set), but with a manifest present the nav guard (app.js:32-36) does not force Setup — the user instead meets 'Set an NVIDIA API key first.' from catalog.fetch/config.generate (engine-context.js:303/321) and navigates there themselves. Actionable, just not literally a prompt.
- **F13**: Electron's Linux appData honors $XDG_CONFIG_HOME before ~/.config; both README and paths.js:146 write ~/.config flat. Internally consistent house style, noted rather than charged.
- **Reviewer's optional suggestion, worth carrying**: two cheap guard tests would pin the claims this branch now asserts — that src/engine/uninstall.js contains no `secretStore` reference, and that `apiKey.clear` has no renderer caller. **Either would have caught the pass-1 defect.**
<!-- SECTION:NOTES:END -->
