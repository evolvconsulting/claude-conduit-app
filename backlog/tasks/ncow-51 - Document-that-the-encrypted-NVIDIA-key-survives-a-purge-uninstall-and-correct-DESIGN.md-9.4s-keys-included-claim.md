---
id: NCOW-51
title: >-
  Document that the encrypted NVIDIA key survives a purge uninstall, and correct
  DESIGN.md 9.4's '(keys included)' claim
status: In Progress
assignee: []
created_date: '2026-08-05 17:04'
updated_date: '2026-08-05 17:33'
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
<!-- SECTION:NOTES:END -->
