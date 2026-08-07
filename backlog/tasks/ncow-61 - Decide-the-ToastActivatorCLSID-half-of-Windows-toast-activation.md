---
id: NCOW-61
title: Decide the ToastActivatorCLSID half of Windows toast activation
status: To Do
assignee: []
created_date: '2026-08-07 13:00'
updated_date: '2026-08-07 13:43'
labels: []
dependencies:
  - NCOW-57
priority: medium
type: task
ordinal: 74000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-57 matched the app's runtime AppUserModelID to the AUMID electron-builder's NSIS installer stamps on the Start Menu shortcut. That closed one half of Electron's own two-part Windows notification requirement — `docs/tutorial/notifications.md` (v43.2.0) states Windows notifications need a Start Menu shortcut carrying an AppUserModelID **and a corresponding ToastActivatorCLSID**. The second half is untouched, and the wave-16 integration review found the current code comment presents it as if no remedy exists.

**What the review established, each citation verified independently by two reviewers:**

- `app.setToastActivatorCLSID(id)` exists — Electron v43.2.0 `docs/api/app.md:1148-1159`. The current comments never mention it.
- That entry documents the default: if the method is never called, **a random CLSID is generated once per run**. So the runtime CLSID can never match anything stamped on a shortcut — this is not a case where the default happens to work.
- electron-builder writes no ToastActivatorCLSID for either Windows target: `grep -rn "ToastActivator\|CLSID" node_modules/app-builder-lib/templates/nsis/` returns zero hits.
- `app.md:1159` carries the timing guidance "This method should be called early (before showing notifications)" — note this belongs to `setToastActivatorCLSID`, NOT to `setAppUserModelId`. A wave-16 comment mis-transplanted that sentence onto the AUMID call and had to be corrected; if this task implements the CLSID call, the guidance genuinely does apply to it.

**The decision to make** is deliberate, not mechanical: set a fixed CLSID (and decide where it lives and whether electron-builder can be made to stamp a matching one), or accept the gap and document it accurately. Either resolution is fine — what is not fine is the current state, where the gap is described as though nothing could be done about it.

**Relationship to what shipped.** No user-visible regression is known; this is a completeness gap in a path whose visible behavior could never be confirmed anyway (pixel-level toast capture proved unobtainable on winvm, which is why NCOW-57's AC#1/#3 were amended to an acceptance-plus-AUMID-correctness standard). Treat "does fixing the CLSID actually change observed behavior" as an open question this task may answer, not an assumption.

Primary files: `src/main/appUserModelId.js`, `src/main/index.js`, `electron-builder.yml`, `test/main/app-user-model-id.test.js`, and possibly `src/main/tray.js`'s gap enumeration comment. Note the tray.js overlap with queued sibling NCOW-59, and that NCOW-58 (docs) should reflect whichever way this resolves.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A decision is recorded — set a fixed ToastActivatorCLSID, or accept the gap — with the Electron doc citation (app.md:1148-1159 at the pinned Electron version) supporting it
- [ ] #2 If implemented: app.setToastActivatorCLSID() is called before any notification is shown, per app.md:1159's own timing guidance, and a drift guard covers the CLSID value if it is duplicated anywhere (mirroring the existing appId drift guard)
- [ ] #3 If deferred: electron-builder.yml's comment names app.setToastActivatorCLSID AND the random-per-run default explicitly, so no future reader concludes the gap is unaddressable
- [ ] #4 The claim that electron-builder writes no ToastActivatorCLSID for either Windows target is re-verified against the then-current app-builder-lib, not carried forward on trust
- [ ] #5 All pre-existing tests continue to pass unmodified and npm test passes
- [ ] #6 The two surviving appId drift-guard bypasses recorded in this task's notes are closed: a quoted key (`  "appId": com.DRIFT`) and an anchored scalar (`appId: &wid com.DRIFT`) inside the `win:` block are both DETECTED by the guard, each proven by making the mutation and observing the guard fail
- [ ] #7 The WIN_BLOCK sanity assert in test/main/app-user-model-id.test.js makes its own comment exactly true: an empty-string WIN_BLOCK fails loudly rather than skipping silently (e.g. `assert.ok(WIN_BLOCK, ...)` or a `.trim() !== ''` check), proven by simulating an empty return with a real drift present and observing a failure
- [ ] #8 Every guard change above is proven non-vacuous BY EXPERIMENT, not by reading: for each, state the exact mutation applied, that the guard failed with it and passes without it, and confirm the guard was not already catching it before the change
<!-- AC:END -->

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
<!-- SECTION:NOTES:END -->
