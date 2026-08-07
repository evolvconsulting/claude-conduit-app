---
id: NCOW-58
title: Document the tray's native notification behavior in README/DESIGN.md
status: In Progress
assignee: []
created_date: '2026-08-06 18:16'
updated_date: '2026-08-07 13:54'
labels: []
dependencies:
  - NCOW-55
  - NCOW-56
ordinal: 71000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-55 introduced this app's first-ever native OS notification (Electron's `Notification` API, used to surface a wedged tray Start/Stop/Restart call). The wave-14 integration review found zero mentions of "notification" anywhere in README.md, DESIGN.md, or CLAUDE.md — the only doc change NCOW-55 itself made was bumping the test count. This is a real user-facing behavior with real platform caveats (see NCOW-57), and this project's README already documents comparable user-facing behavior in detail elsewhere (tray optionality, quit-stops-proxy, the shared Start/Stop/Restart lock).

This task: add a short section to README.md (and DESIGN.md if it has a relevant tray/timeout section already, per its own §7.x tray/pm2-timeout prose) describing that a wedged tray action now raises a native OS notification, and noting the known platform caveats from NCOW-57 (or, if NCOW-57 lands first, linking to its resolution instead of duplicating the caveat).

**SCOPE EXTENDED after NCOW-56 landed (wave 15, user-approved).** This task was filed before NCOW-56 merged, so the text above describes only ONE failure class. Two things changed:

1. **The user-visible surface is now two failure classes, not one.** NCOW-56 extended the tray's error surface to cover a RESOLVED `{ok:false}` result (`NOT_CONFIGURED`, `HEALTH_CHECK_TIMEOUT`) in addition to a thrown/rejected call. The `{ok:false}` case is the more common one in practice — clicking tray Start on a fresh, unconfigured install hits it. Documentation that mentions only "wedged" actions would be stale on arrival.

2. **A deliberate behavioral asymmetry currently exists only as a code comment.** NCOW-56's AC#2 decision was that the tray's Start item stays ENABLED whenever status is not `running`, with no manifest check — unlike the dashboard's `#start-btn`, which is `disabled` when `!manifest` (`src/renderer/views/dashboard-view.js:94`). Clicking tray Start with no manifest therefore round-trips through the handler and surfaces a `NOT_CONFIGURED` notification rather than the control being visibly inert. The reasoning lives only in `src/main/tray.js`'s comment block; a user who notices the two Start controls behaving differently has nowhere to read why. The wave-15 integration review flagged this as a real gap.

Also note: the wave-15 integration review's own staleness sweep confirmed that no statement in README.md, DESIGN.md, or CLAUDE.md currently describes what happens when a tray action FAILS — so this task is adding new prose, not correcting existing prose. Nothing in those files has gone stale; the material is simply absent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 README.md documents that a wedged tray Start/Stop/Restart action raises a native OS notification, alongside this project's existing documentation of other tray/proxy user-facing behavior
- [ ] #2 DESIGN.md's existing tray/pm2-timeout section (§7.x) is updated if it needs to reflect the new notification surface, or explicitly left alone with a note why if it doesn't
- [ ] #3 Known platform caveats (Windows AUMID/portable-build gap, macOS DND/permission-denied) are mentioned or linked to NCOW-57's resolution, whichever is accurate at the time this task is done
- [ ] #4 README.md describes BOTH failure classes the tray now surfaces: a wedged/thrown call and a resolved {ok:false} result (e.g. NOT_CONFIGURED on an unconfigured install, HEALTH_CHECK_TIMEOUT), not just the wedged case
- [ ] #5 The deliberate tray-Start-vs-dashboard-#start-btn asymmetry from NCOW-56's AC#2 decision is documented where a user can read it, including why tray Start stays enabled with no manifest and notifies on click instead of being disabled
- [ ] #6 README.md:331's `npm test` comment no longer asserts a protection that does not hold: the "no real config touched" half is corrected or dropped so the line is accurate on Windows as well, and accurate regardless of whether NCOW-60 lands (do NOT write a claim whose truth depends on a sibling task merging)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read the task spec and CLAUDE.md for conventions.
2. Read the ACTUAL current source rather than trusting the task description's summary (the task warns the description predates some of that code): src/main/tray.js (full createTray/createTrayActions including the NCOW-55/56/57 comment blocks), src/main/appUserModelId.js, electron-builder.yml's win.target comment, and src/renderer/views/dashboard-view.js to confirm #start-btn's disabled expression.
3. Read README.md and DESIGN.md in full to find insertion points alongside existing tray/proxy documentation (README's "Closing vs. quitting" area; DESIGN.md 7.4).
4. Independently confirm the README.md:331 claim's falsity rather than taking the dispatch briefing on trust.
5. Sweep README.md/DESIGN.md/CLAUDE.md for OTHER instances of the "no real config touched" claim (fix the class, not the instance).
6. Write a new README.md subsection covering both failure classes, the enabled-with-no-manifest asymmetry, and platform caveats.
7. Add a short paragraph to DESIGN.md 7.4 pointing at the new notification surface without duplicating platform-caveat detail, which stays single-sourced in README.
8. Correct README.md:331's npm test comment.
9. Run npm test, verify git status shows only README.md/DESIGN.md changed, commit, push.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Scope amendment at wave-17 dispatch (2026-08-07) — user-approved via AskUserQuestion

AC#6 added. `README.md:331` reads `npm test              # 485 tests, no network or real config touched`.
The wave-16 cleanup branch edited that exact line (bumping the count) and left the second half standing;
NCOW-60 establishes that half is FALSE on Windows (`npm test` overwrites the real
`%APPDATA%\claude-conduit`). The user was offered three homes for the correction — this task, NCOW-60,
or leave it as a note — and chose this task, because this task is the only wave-17 member editing
README.md, which keeps README single-owner for the wave and lets NCOW-58/59/60 run genuinely parallel.

Deliberate constraint on the wording, and the reason AC#6 says it explicitly: the corrected line must be
true on its own, not conditional on NCOW-60 merging. Dropping or qualifying the false half satisfies
this; re-asserting the protection because a sibling branch is expected to land does not.

## Wave-17 implementation evidence (worker, branch `docs/NCOW-58-tray-notify-docs`, commit `16c35195ff3e5b771f16f9ef29c0d926401569ae`, branched from `20ffa60add5d7e281a2f39610adcec1ee987b489`)

Recorded by the orchestrator from the worker's structured return. Diffstat: README.md +46/-1,
DESIGN.md +13. NOT yet independently reviewed at the time of writing.

**AC#1** — added `### Tray notifications on Start/Stop/Restart failures` to README.md (after the
pm2-daemon paragraph, before `### Where things live`), listing a wedged/thrown call as one of two
failure classes that raise a native OS notification instead of failing silently. Checked against
`createTrayActions()`/`runAction()`'s `.catch()` branch, which calls `notifyFailure()`.

**AC#2** — DESIGN.md 7.4 UPDATED (not left alone). Added a paragraph after the pm2-timeout-codes
paragraph, stating explicitly that it is not duplicating the platform caveats ("This section is about
the pm2 lifecycle itself, not the UI layer that reports its failures") and pointing at the README
section instead. A deliberate single-sourcing choice, stated as such in the prose rather than left
implicit.

**AC#3** — wrote a "Known platform caveats (NCOW-57)" bullet list covering Windows (AUMID now matches
the nsis Start Menu shortcut; `portable` still has no Start Menu shortcut, an open gap), macOS (ad-hoc
signing's effect unverified either way; DND/permission state not checked), and Linux (verified live via
`dbus-monitor` against GNOME), plus the always-on console-log fallback. NCOW-57 is treated as LANDED
rather than pending, which is correct as of this wave base.
SOURCING CAVEAT, worth carrying: the worker deliberately did NOT re-fetch Electron's own docs, reasoning
that current upstream docs could contradict this repo's evidence trail, which is pinned at Electron
v43.2.0. It paraphrased only what `src/main/tray.js`'s NCOW-57 comment block and
`electron-builder.yml`'s `win.target` comment already state, without requoting their embedded
Electron-doc excerpts. Defensible for internal consistency, but it means the caveat prose rests on
in-repo paraphrase rather than a primary source.

**AC#4** — the same section explicitly lists a resolved `{ok:false}` result as "the more common case in
practice", naming `NOT_CONFIGURED` and `HEALTH_CHECK_TIMEOUT`. The worker flagged honestly that it did
NOT re-open `engine-context.js` itself (outside its edit scope), so this one detail rests on tray.js's
comment as source rather than a direct second read.

**AC#5** — the asymmetry paragraph quotes `disabled = status === 'running' || !manifest`, verified
directly against `src/renderer/views/dashboard-view.js:94`, and explains the reasoning sourced from
tray.js's comment block rather than the task description's summary.

**AC#6 — NOT SATISFIED AS WRITTEN. Defect confirmed by the worker itself when challenged.**
The line was changed to:
`npm test              # 485 tests, no network access (on Windows, some tests write into`
`                       # the real %APPDATA%\claude-conduit - tracked as NCOW-60)`
That makes a PRESENT-TENSE behavioral claim whose truth value inverts the moment NCOW-60's fix lands -
which is expected in this same wave. AC#6 required wording accurate regardless of whether NCOW-60
lands; this inverts the dependency rather than removing it (false-after-merge instead of the
false-today-true-after-merge failure the AC's parenthetical guarded against). The `NCOW-60` citation
itself is legitimate - that task is really filed, so this is NOT the ID-fabrication class.
The worker's own proposed correction, which it reached unprompted once the flaw was named, is to drop
the behavioral claim entirely and keep only `npm test              # 485 tests, no network access` -
the "drop" branch AC#6 itself offers. Handed to review for disposition rather than fixed by the
orchestrator.

**Class sweep** — swept README/DESIGN/CLAUDE for other instances of the "no real config touched" claim
and found only the one at README.md:331.

**Verification** — `# tests 485 / # pass 485 / # fail 0`, unchanged as expected for a docs-only change.

## Separate staleness item, NOT this worker's defect

That same line asserts `485 tests`. Wave 17's sibling branches add tests (NCOW-59 adds 2; NCOW-60 adds
its own), so the count goes stale on merge. The worker was explicitly instructed NOT to bump it, since
the final number is unknowable from inside a single branch. This belongs to the wave's post-merge
cleanup, not to this task.
<!-- SECTION:NOTES:END -->
