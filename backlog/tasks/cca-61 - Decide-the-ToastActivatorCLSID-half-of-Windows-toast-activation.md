---
id: CCA-61
title: Decide the ToastActivatorCLSID half of Windows toast activation
status: Done
assignee: []
created_date: '2026-08-07 13:00'
updated_date: '2026-08-17 04:34'
labels: []
dependencies:
  - CCA-57
priority: medium
type: task
ordinal: 74000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
CCA-57 matched the app's runtime AppUserModelID to the AUMID electron-builder's NSIS installer stamps on the Start Menu shortcut. That closed one half of Electron's own two-part Windows notification requirement — `docs/tutorial/notifications.md` (v43.2.0) states Windows notifications need a Start Menu shortcut carrying an AppUserModelID **and a corresponding ToastActivatorCLSID**. The second half is untouched, and the wave-16 integration review found the current code comment presents it as if no remedy exists.

**What the review established, each citation verified independently by two reviewers:**

- `app.setToastActivatorCLSID(id)` exists — Electron v43.2.0 `docs/api/app.md:1148-1159`. The current comments never mention it.
- That entry documents the default: if the method is never called, **a random CLSID is generated once per run**. So the runtime CLSID can never match anything stamped on a shortcut — this is not a case where the default happens to work.
- electron-builder writes no ToastActivatorCLSID for either Windows target: `grep -rn "ToastActivator\|CLSID" node_modules/app-builder-lib/templates/nsis/` returns zero hits.
- `app.md:1159` carries the timing guidance "This method should be called early (before showing notifications)" — note this belongs to `setToastActivatorCLSID`, NOT to `setAppUserModelId`. A wave-16 comment mis-transplanted that sentence onto the AUMID call and had to be corrected; if this task implements the CLSID call, the guidance genuinely does apply to it.

**The decision to make** is deliberate, not mechanical: set a fixed CLSID (and decide where it lives and whether electron-builder can be made to stamp a matching one), or accept the gap and document it accurately. Either resolution is fine — what is not fine is the current state, where the gap is described as though nothing could be done about it.

**Relationship to what shipped.** No user-visible regression is known; this is a completeness gap in a path whose visible behavior could never be confirmed anyway (pixel-level toast capture proved unobtainable on winvm, which is why CCA-57's AC#1/#3 were amended to an acceptance-plus-AUMID-correctness standard). Treat "does fixing the CLSID actually change observed behavior" as an open question this task may answer, not an assumption.

Primary files: `src/main/appUserModelId.js`, `src/main/index.js`, `electron-builder.yml`, `test/main/app-user-model-id.test.js`, and possibly `src/main/tray.js`'s gap enumeration comment. Note the tray.js overlap with queued sibling CCA-59, and that CCA-58 (docs) should reflect whichever way this resolves.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A decision is recorded — set a fixed ToastActivatorCLSID, or accept the gap — with the Electron doc citation (app.md:1148-1159 at the pinned Electron version) supporting it
- [ ] #2 If implemented: app.setToastActivatorCLSID() is called before any notification is shown, per app.md:1159's own timing guidance, and a drift guard covers the CLSID value if it is duplicated anywhere (mirroring the existing appId drift guard)
- [x] #3 If deferred: electron-builder.yml's comment names app.setToastActivatorCLSID AND the random-per-run default explicitly, so no future reader concludes the gap is unaddressable
- [x] #4 The claim that electron-builder writes no ToastActivatorCLSID for either Windows target is re-verified against the then-current app-builder-lib, not carried forward on trust
- [x] #5 All pre-existing tests continue to pass unmodified and npm test passes
- [x] #6 The two surviving appId drift-guard bypasses recorded in this task's notes are closed: a quoted key (`  "appId": com.DRIFT`) and an anchored scalar (`appId: &wid com.DRIFT`) inside the `win:` block are both DETECTED by the guard, each proven by making the mutation and observing the guard fail
- [x] #7 The WIN_BLOCK sanity assert in test/main/app-user-model-id.test.js makes its own comment exactly true: an empty-string WIN_BLOCK fails loudly rather than skipping silently (e.g. `assert.ok(WIN_BLOCK, ...)` or a `.trim() !== ''` check), proven by simulating an empty return with a real drift present and observing a failure
- [x] #8 Every guard change above is proven non-vacuous BY EXPERIMENT, not by reading: for each, state the exact mutation applied, that the guard failed with it and passes without it, and confirm the guard was not already catching it before the change
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read appUserModelId.js and its test file to understand the existing appId drift-guard mechanism
   exactly before touching anything.
2. Re-verify (not trust) the Electron setToastActivatorCLSID API and default behavior against this
   repo's actual installed Electron version (43.2.0) via the real docs/api/app.md at that tag.
3. Re-verify electron-builder's actual NSIS/WinShell plugin surface for CLSID-stamping support against
   the installed app-builder-lib 26.15.3 -- repo-wide grep, not just templates/nsis/.
4. Decide fix-vs-accept based on findings: app-builder-lib 26.15.3 stamps no CLSID onto either
   Windows target's shortcut at creation time, but Electron's own shell.writeShortcutLink CAN update a
   CLSID on an already-installed shortcut at runtime, independent of app-builder-lib -- so this is not
   a "no remedy exists" case. Decision: accept the gap anyway, on cost/benefit grounds -- the full
   remedy would also need locating the shortcut path and almost certainly registering a COM server
   (undocumented whether Electron does this automatically), disproportionate for an app with no
   activation handler today, combined with this campaign's own established cost of Windows-VM
   verification. (Corrected 2026-08-17: the first two review passes caught this exact plan clause
   overstating "no remedy exists" when a reachable-but-disproportionate remedy actually exists --
   fixed in the code comments across 3 sites; this plan text is corrected to match, not to rewrite
   history.)
5. Correct electron-builder.yml's win: block comment and tray.js's gap-enumeration comment to name the
   real API and default behavior, and the real cost/benefit reasoning for accepting the gap anyway.
6. Close AC#6 (two drift-guard bypasses) and AC#7 (WIN_BLOCK sanity assert) as independent hardening
   on the EXISTING appId guard mechanism, each proven by experiment against scratch-mutated copies.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Note from the wave-16 cleanup review (2026-08-07) — two latent findings that share this task's file

Both were judged follow-up rather than merge blockers, and this task is their natural home because it
already touches `test/main/app-user-model-id.test.js`. Recorded here rather than added as acceptance
criteria unilaterally.

1. **Two residual silent bypasses in the `win.appId` drift guard.** After two rounds of hardening, the
   reviewer invented eight further adversarial mutations; six are caught (CRLF, trailing whitespace on
   `win:`, tab-indented `appId`, single-quoted drift value with trailing comment, flow mapping
   `win: { appId: ... }`, and both of the originally-demonstrated comment bypasses). **Two survive
   silently:** a quoted key (`  "appId": com.DRIFT`) and an anchored scalar
   (`appId: &wid com.DRIFT`). The reviewer characterized both against the real parser — `yaml.load()`
   returns `win.appId === "com.DRIFT"` for each, so electron-builder WOULD honor them. Neither styling
   appears anywhere in `electron-builder.yml` today and `win.appId` does not exist in the repo at all,
   which is why this is latent rather than urgent.
2. **A one-word overstatement in the guard's own comment**, `test/main/app-user-model-id.test.js`
   (near the `WIN_BLOCK` sanity assert). The comment says the assert makes a future regression that
   "empties" WIN_BLOCK fail loudly, but the assert is `WIN_BLOCK !== null` — an empty-string WIN_BLOCK
   still skips silently, proved by simulating `return ''` with a real drift present (9/0 green).
   Not reachable via a YAML edit today. `assert.ok(WIN_BLOCK, ...)` or a `.trim() !== ''` check would
   make the sentence exactly true.

Also worth carrying into this task: the timing guidance "This method should be called early (before
showing notifications)" at `app.md:1159` belongs to `setToastActivatorCLSID` — i.e. to THIS task's API,
not to `setAppUserModelId`. A wave-16 comment mis-transplanted that sentence onto the AUMID call and
had to be corrected; if this task implements the CLSID call, the guidance genuinely does apply.

## Scope amendment at wave-17 dispatch (2026-08-07) — user-approved via AskUserQuestion

AC#6, #7 and #8 added, promoting the three latent findings recorded in the note above from "recorded,
not required" to acceptance criteria. The user was offered all three / comment-overstatement-only /
leave-as-notes, and chose all three.

Rationale given: this task already touches `test/main/app-user-model-id.test.js`, so it is the natural
home; this campaign has been bitten repeatedly by guards that silently no-op (this specific guard was
hardened TWICE in wave 16 and still had two holes afterward); and this task is expected to be solo in
its wave, so the added scope costs no parallelism.

AC#8 is deliberately a process criterion, not a code one: wave 16's recurring failure was guard claims
verified by reading rather than by experiment. Reading the guard and concluding it now covers a case is
NOT evidence for AC#6 or AC#7 — apply the mutation, observe the failure.

## Wave-18 implementation evidence (worker, branch `feat/CCA-61-toast-activator-clsid`,
commits `c391627` + `38fdf77`, branched from `52a7f7e`)

Recorded by the orchestrator from the worker's structured return. NOT yet independently reviewed.

**Decision: ACCEPT THE GAP, document it accurately** (not "set a fixed CLSID") -- both re-verification
halves confirmed this is the right call, not a default choice:
- Electron 43.2.0 (this repo's actual pinned version): fetched the real `docs/api/app.md` at GitHub
  tag `v43.2.0` directly. Lines 1148-1159 confirm the task's original citation was accurate --
  `setToastActivatorCLSID(id)` exists; unset, "a random CLSID is generated once per run and exposed
  via `app.toastActivatorCLSID`"; the "call early" timing guidance belongs to THIS method, not
  `setAppUserModelId`.
- app-builder-lib 26.15.3 (installed): re-grepped `ToastActivator|CLSID` across the ENTIRE package
  (not just `templates/nsis/` as the original task filing did) -- zero hits repo-wide. The WinShell
  NSIS plugin's actual exposed surface is `SetLnkAUMI`/`UninstShortcut`/`UninstAppUserModelId` only --
  no shortcut-side CLSID-stamping call exists at all.
- **Decisive finding**: since nothing in the installed electron-builder can stamp a CLSID onto the
  shortcut, calling `setToastActivatorCLSID(fixedGuid)` at runtime would produce a value with nothing
  on the shortcut side to correlate it to -- exactly as functionally inert as today's random-per-run
  default, just deterministically inert instead of randomly inert. Implementing it would LOOK
  resolved in review while changing nothing observable.

**AC#6 closed and proven by experiment** against scratch-mutated copies of `electron-builder.yml`
(never the committed file), under real `node --test` runs: quoted key (`  "appId": com.DRIFT`) --
pre-fix regex 9/9 green (bypass confirmed), post-fix regex fails with
`actual: 'com.evolvconsulting.claudeconduit', expected: 'com.DRIFT'` (caught). Anchored scalar
(`appId: &wid com.DRIFT`) -- same pre-fix bypass confirmed, same post-fix catch confirmed. New regex
also confirmed to have NO false positive against the real, unmutated file (9/9, full suite 522/522).

**AC#7 closed and proven by experiment**: forced `WIN_BLOCK = ''` in a scratch variant with a real
drift present -- old assert (`WIN_BLOCK !== null`) passed 9/9 green (bypass); new assert
(`WIN_BLOCK && WIN_BLOCK.trim() !== ''`) threw immediately (caught), matching what the guard's own
comment always claimed it did.

**npm test**: 522/522, delta 0 from baseline. AC#5 (pre-existing tests unmodified) satisfied -- only
the module-level regex/assert HELPERS that feed the existing tests were hardened, no existing
assertion's own text changed.

Files touched: `test/main/app-user-model-id.test.js` (AC#6/#7 hardening, plus a stale `NCOW-61`
forward-reference corrected now that this task's decision is known), `electron-builder.yml` (win:
block comment now names `setToastActivatorCLSID`, its default, and the re-verified gap),
`src/main/tray.js` (gap-enumeration extended from three items to four, naming the same API/default/
gap instead of omitting it as before). Untouched, per the accept-and-document decision:
`src/main/appUserModelId.js`, `src/main/index.js` (no runtime call added).

## Wave-18 review pass 1 verdict — REQUEST_CHANGES (reviewer, Opus, in the branch's own worktree)

Reviewed `c391627`+`38fdf77`. AC#3-#8 all independently confirmed with the reviewer's own
reproductions (citation verified verbatim against the real `docs/api/app.md` at Electron tag v43.2.0,
line numbers exact; AC#4 re-verified via a full DLL string-table dump of `WinShell.dll` itself, not
just a grep, confirming zero CLSID-stamping capability; AC#6/#7's bypasses and catches both
reproduced directly, plus the reviewer's own 16-style stress test found no NEW blind spot in the
hardened regex; AC#5 confirmed -- exactly 3 non-comment lines changed, all mandated by AC#6/#7; own
npm test: 522/522).

### BLOCKING-1 — the core decision's recorded justification contains a false absolute

`src/main/tray.js`'s new comment says CCA-61 "found no remedy currently reachable" because
app-builder-lib 26.15.3 has no CLSID-stamping support. **That's false as stated**: Electron ITSELF can
stamp/update the CLSID on an existing shortcut at runtime, independent of app-builder-lib --
`shell.writeShortcutLink(path, 'update', {toastActivatorClsid})` (confirmed against the real
`docs/api/shell.md` and `docs/api/structures/shortcut-details.md` at v43.2.0, corroborated in the
installed `electron.d.ts`). The colon in the sentence presents the app-builder-lib fact as proof of
the broader "no remedy reachable" claim, but it doesn't follow -- no app-builder-lib support is
required for the runtime side.

**Decision itself likely still correct, per the reviewer's own explicit assessment** -- the
underlying Windows contract (a stamped CLSID must correspond to a registered COM server) does make a
BARE fixed CLSID with nothing registered just as inert as today's random default, and the real full
remedy (shortcut discovery + probable COM server registration + Windows testing) is disproportionate
for an app that ships only informational toasts with no activation handler. **What must change is the
JUSTIFICATION, not necessarily the outcome**: say the remedy is reachable but disproportionate, not
unreachable. The reviewer explicitly flagged two things it could NOT verify either way and declined
to guess: whether Electron auto-registers the COM server when `setToastActivatorCLSID` is called
(undocumented), and whether the running-app toast-click path even needs the CLSID at all (the gap may
be scoped to Action-Center/app-not-running activation specifically) -- these bear on the write-up, not
on redoing the investigation.

### should-fix — citation narrower than what the cited doc actually says
Both new comments scope the CLSID requirement to "activation" specifically, but
`docs/tutorial/notifications.md` (the same file `tray.js` already quotes) states the AUMID+CLSID pair
is needed for "notifications on Windows" generally, not activation alone.

### nit — a residual regex blind spot, not introduced by this task
A YAML tag style (`appId: !!str com.DRIFT`) parses to the same drifted value but is caught by NEITHER
the old NOR the new regex (the anchor-skip pattern doesn't also skip tags). Outside AC#6's two named
styles; worth a follow-up, not blocking.

**Positive note from the reviewer**: the AC#6/#7 comment blocks are unusually honest -- they
explicitly say the PRIOR comment "overstated what that companion assertion actually did," exactly the
self-correction this campaign wants to see happen proactively rather than be caught by a later pass.

Fix pass 1 dispatched into the same worktree with the finding verbatim: reword the `tray.js` sentence
(and the parallel `electron-builder.yml` framing) to state a remedy IS reachable via
`shell.writeShortcutLink`'s `toastActivatorClsid`, with the gap accepted on cost/benefit grounds
rather than for lack of a path, plus the should-fix citation-scope correction.

## Wave-18 fix pass 1 (fresh worker, same worktree, commit `f5149a9`; rebased onto dev, branch head
now `f5149a9` on top of rebased `93adfe6`/`b80a5f9`, originally `38fdf77`/`c391627`)

Recorded by the orchestrator from the worker's structured return. NOT yet independently reviewed.

**Re-verified the core claim from primary sources, not the review prompt's say-so.** Read
`node_modules/electron/electron.d.ts` directly: confirmed `shell.writeShortcutLink(path, 'update',
{toastActivatorClsid})` and `ShortcutDetails.toastActivatorClsid` both exist. Fetched the real
Electron docs at the pinned tag (v43.2.0) directly from GitHub: `docs/api/shell.md`'s `update`
operation ("Updates specified properties only on an existing shortcut"), `shortcut-details.md`'s
`toastActivatorClsid` field description, and -- for the should-fix finding --
`docs/tutorial/notifications.md`'s general (not activation-scoped) framing of the AUMID+CLSID
requirement, confirming that finding was real. Kept `app.md`'s own activation-specific framing for
`setToastActivatorCLSID` itself (that citation IS scoped to activation in the source doc), while
broadening the OVERALL citation to the more general notifications.md statement. Re-confirmed
app-builder-lib is still 26.15.3 with zero CLSID/ToastActivator hits after a fresh `npm ci`.

**`tray.js`** gap-enumeration item 4 reworded: from "found no remedy currently reachable... app-
builder-lib has no support" to naming `shell.writeShortcutLink`'s `toastActivatorClsid` as a reachable,
Electron-native RUNTIME remedy independent of app-builder-lib, broadened citation, and explicit that
pixel-level display was never confirmed either way (open question, not resolved).

**`electron-builder.yml`**'s `win:` block "Consequence" bullet rewritten: states the runtime remedy IS
reachable, then gives the real cost/benefit reasoning for accepting the gap anyway -- (a) locate the
real shortcut path at runtime, (b) call `writeShortcutLink`, (c) almost certainly register a COM
server for the CLSID (explicitly flagged as UNVERIFIED either way -- also noted Electron's own docs
say even ITS OWN interactive notifications need a separate module "to help with registering the
required COM components," suggestive but not proof), (d) cites this campaign's own established cost
of Windows-VM testing (pixel-level toast verification unobtainable on the available VM, per CCA-57's
history). Concludes the gap is accepted on disproportionate-cost grounds given today's app has no
activation handler at all -- not because no path exists.

**npm test**: 522/522 pre-rebase (matching pre-rebase baseline); rebased onto origin/dev (13 commits
ahead, clean, zero conflicts); `npm ci` to resync node_modules with dev's own js-yaml lockfile bump;
542/542 post-rebase, run twice for stability (the +20 is other merged branches' tests, not this
comment-only change).

Files touched: `src/main/tray.js`, `electron-builder.yml` only. No `setToastActivatorCLSID`/
`writeShortcutLink` call added; `appUserModelId.js`/`index.js`/the AC#6-7 drift-guard tests untouched.

Review pass 2 dispatched next, into the same worktree, against `f5149a9`.

## Wave-18 review pass 2 verdict — REQUEST_CHANGES, one narrow finding (reviewer, Opus, in the
branch's own worktree)

Reviewed `f5149a9`. AC#1/#3/#4/#5/#6/#7/#8 all independently re-confirmed with fresh reproduction
(fetched all 4 Electron doc citations directly from github.com/electron/electron at tag v43.2.0 and
matched verbatim; re-grepped app-builder-lib fresh -- zero CLSID hits across 659 files; reproduced
both AC#6 bypasses and the AC#7 empty-string bypass end to end against scratch-mutated copies, never
the real files). Confirmed pass 1's should-fix (citation scope) is genuinely closed, and confirmed no
NEW overstatement was introduced in the opposite direction while fixing the old one.

### BLOCKING (narrow) — the fix reached 2 of 3 sites carrying the refuted rationale

`tray.js` and `electron-builder.yml` are genuinely fixed. But
`test/main/app-user-model-id.test.js:96-102` (introduced alongside the AC#6/#7 hardening, untouched
by fix pass 1) still states the EXACT reasoning pass 1 blocked on: "...the installed app-builder-lib
(26.15.3) has no way to stamp a matching ToastActivatorCLSID... so a fixed runtime value would be
exactly as functionally inert..." -- framing app-builder-lib's limitation as THE reason the gap was
accepted, which both corrected files now explicitly disclaim ("not because no path exists" /
"not because no remedy exists"). The recorded decision's basis is now inconsistent across the three
sites -- and this is the comment a maintainer reads when the drift guard actually fires. The clause
does defer to `electron-builder.yml` "for the full reasoning", and the literal claim (a bare fixed
value alone is inert) is true -- so this is narrow, not a re-litigation of the decision itself. Fix is
one clause.

### Confirmed clean
Scope: exactly the 3 files across the whole branch, nothing else. Zero `HEAD`/`HEAD~N`/`HEAD^`/`@{}`
references anywhere. The one unsourced premise in the new text ("Windows' contract requires a
registered COM activator") sits under an explicit "almost certainly" hedge, not blocking, but noted as
the one assertion without a citation behind it.

npm test (reviewer's own run): 542/542.

**Rebase needed before merge** (informational, reviewer flagged, not itself a review finding): dev has
moved 4 commits since this branch's last rebase (CCA-14.4 merged as PR #70) -- no file overlap
expected, should be clean, but will raise the test count.

Fix pass 2 dispatched into the same worktree with the finding verbatim.

## Wave-18 fix pass 2 (fresh worker, same worktree, commit `d204d5d`; rebased onto dev, branch head
now `d204d5d`, prior tip `f5149a9`)

Recorded by the orchestrator from the worker's structured return. NOT yet independently reviewed.

Rebased cleanly onto `origin/dev` (picked up CCA-14.4's merge, PR #70) -- no conflicts. Reworded the
third and final site carrying the refuted rationale: `test/main/app-user-model-id.test.js:96-102`
previously said "...the installed app-builder-lib (26.15.3) has no way to stamp a matching
ToastActivatorCLSID... so a fixed runtime value would be exactly as functionally inert as today's
random-per-run default." Now reads: "...chose to accept the gap on cost/benefit grounds, not because
no remedy exists: Electron's own `shell.writeShortcutLink(path, 'update', {toastActivatorClsid})` can
stamp a CLSID onto an already-installed shortcut at runtime, independent of app-builder-lib (26.15.3,
which stamps none onto either Windows target's shortcut at creation time). See electron-builder.yml's
`win:` block comment for the full reasoning and citations." -- consistent with `tray.js`'s and
`electron-builder.yml`'s already-corrected framing, still deferring to the yml for full reasoning as
the reviewer wanted preserved. `git diff` confirms only these 7 lines changed; nothing else in the
file (the AC#6/#7 drift-guard logic, assertions, or any other comment) touched.

**npm test**: 562/562 (up from 542, consistent with CCA-14.4's new tests landing via the rebase).

Files touched: `test/main/app-user-model-id.test.js` only.

Review pass 3 dispatched next, into the same worktree, against `d204d5d`. Per this campaign's fix-cycle
cap (2 retries, 3 total review passes), this is the LAST review pass before an automatic escalation
would apply if it comes back request_changes again.

## Wave-18 review pass 3 verdict — APPROVE (reviewer, Opus, in the branch's own worktree; final pass
under this campaign's fix-cycle cap)

Reviewed `d204d5d`. The recurring claim-broader-than-mechanism defect is genuinely closed across all
three sites, with fresh independent evidence: re-fetched all 4 Electron doc citations from the real
v43.2.0 docs and verbatim-matched them again; re-grepped app-builder-lib 26.15.3 fresh (zero CLSID
hits); reproduced all three guard behaviors (AC#6 x2, AC#7) end to end against scratch copies, never
the real files; confirmed AC#6/#7's actual logic is byte-identical to what pass 2 already approved
(comment-stripped md5 match) -- only the one comment clause changed this pass. Swept the ENTIRE branch
(all 4 commits, every tracked file) for any FOURTH site carrying the old "no remedy"/"functionally
inert" framing -- found none; the only remaining hits are the corrected wording itself. Confirmed no
new overstatement was introduced in the opposite direction (the corrected text claims only a
mechanical capability, still explicitly defers COM-registration certainty as unverified). No further
rebase needed (`origin/dev`'s only new commit since this branch's base touches solely this task's own
backlog file, which the branch itself never touches).

npm test (reviewer's own run): 562/562.

**Two non-blocking items flagged for the orchestrator, outside this branch's own scope:**
1. `README.md:296-301` still cites the narrower `templates/nsis/`-only grep the yml has since
   superseded with a repo-wide one, and says "CCA-61 is open to decide it" -- will go stale the moment
   this merges. Not part of this task's own AC#3 (which only requires the yml comment), but worth a
   follow-up sweep.
2. **This task's own Backlog "Implementation Plan" field (recorded by the orchestrator via `--plan`,
   not something the worker can edit) still reads, in the orchestrator's own voice: "a runtime-set
   fixed CLSID would be exactly as functionally inert as today's random default -- rules out the 'fix'
   path."** That is the exact refuted wording, now contradicted by this task's own later notes and the
   merged code. To be corrected at settlement (final-summary), not a branch defect.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Decision: accept the ToastActivatorCLSID gap, document it accurately (AC#2's "if implemented" path was not taken; N/A, left unchecked). Re-verified against the actually-installed app-builder-lib (26.15.3, repo-wide grep, zero CLSID-stamping support) and the real Electron docs at the pinned tag (v43.2.0) rather than carrying either claim forward on trust. Also closed two latent bypasses in the existing appId drift guard (a quoted-key style and an anchored-scalar style) and hardened the WIN_BLOCK sanity assert to fail loudly on an empty string rather than skip silently, both proven non-vacuous by experiment.

3 review passes, 2 fix cycles -- all on the same underlying defect class, not new issues each time. The decision itself (accept the gap) was correct from the first pass. What took three passes was the WRITTEN JUSTIFICATION: the first draft said app-builder-lib's limitation meant "no remedy exists," which is false -- Electron's own shell.writeShortcutLink can update a CLSID on an already-installed shortcut at runtime, independent of app-builder-lib. The real, more nuanced reason to accept the gap anyway is cost/benefit (COM-registration uncertainty, no activation handler exists in this app today, this campaign's own established cost of Windows-VM testing) -- not "no path exists." This had to be corrected in three separate places one at a time (tray.js, electron-builder.yml, then a test-file comment fix pass 1 missed), with review pass 3 sweeping the whole branch afterward and confirming no fourth site remained and no new overstatement was introduced in the opposite direction.

npm test: 562/562 (unchanged -- comment/test-hardening only, zero production behavior change). Merged as PR #71 (a7fadae).

Two follow-ups noted, not fixed here: README.md's own CLSID section will go stale on this merge (still cites the narrower templates/nsis/-only grep the yml has since superseded, and says "CCA-61 is open" -- candidate for the wave-18 integration review to catch). This task's own Implementation Plan text has been corrected directly (a stale clause carried the same refuted "no remedy exists" wording review pass 1 first caught in code).
<!-- SECTION:FINAL_SUMMARY:END -->
