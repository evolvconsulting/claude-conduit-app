---
id: NCOW-51
title: >-
  Document that the encrypted NVIDIA key survives a purge uninstall, and correct
  DESIGN.md 9.4's '(keys included)' claim
status: To Do
assignee: []
created_date: '2026-08-05 17:04'
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
