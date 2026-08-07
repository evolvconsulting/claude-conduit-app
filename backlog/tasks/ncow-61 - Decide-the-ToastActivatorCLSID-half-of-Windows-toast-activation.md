---
id: NCOW-61
title: Decide the ToastActivatorCLSID half of Windows toast activation
status: To Do
assignee: []
created_date: '2026-08-07 13:00'
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
<!-- AC:END -->
