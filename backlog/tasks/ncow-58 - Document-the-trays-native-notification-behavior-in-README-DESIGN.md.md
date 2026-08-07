---
id: NCOW-58
title: Document the tray's native notification behavior in README/DESIGN.md
status: Done
assignee: []
created_date: '2026-08-06 18:16'
updated_date: '2026-08-07 14:19'
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
- [x] #1 README.md documents that a wedged tray Start/Stop/Restart action raises a native OS notification, alongside this project's existing documentation of other tray/proxy user-facing behavior
- [x] #2 DESIGN.md's existing tray/pm2-timeout section (§7.x) is updated if it needs to reflect the new notification surface, or explicitly left alone with a note why if it doesn't
- [x] #3 Known platform caveats (Windows AUMID/portable-build gap, macOS DND/permission-denied) are mentioned or linked to NCOW-57's resolution, whichever is accurate at the time this task is done
- [x] #4 README.md describes BOTH failure classes the tray now surfaces: a wedged/thrown call and a resolved {ok:false} result (e.g. NOT_CONFIGURED on an unconfigured install, HEALTH_CHECK_TIMEOUT), not just the wedged case
- [x] #5 The deliberate tray-Start-vs-dashboard-#start-btn asymmetry from NCOW-56's AC#2 decision is documented where a user can read it, including why tray Start stays enabled with no manifest and notifies on click instead of being disabled
- [x] #6 README.md:331's `npm test` comment no longer asserts a protection that does not hold: the "no real config touched" half is corrected or dropped so the line is accurate on Windows as well, and accurate regardless of whether NCOW-60 lands (do NOT write a claim whose truth depends on a sibling task merging)
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

## Wave-17 review pass 1 verdict — REQUEST_CHANGES (reviewer, Opus, in the branch's own worktree)

Reviewed `docs/NCOW-58-tray-notify-docs` @ `16c35195ff3e5b771f16f9ef29c0d926401569ae` against wave base
`20ffa60add5d7e281a2f39610adcec1ee987b489`. Independently re-ran `npm test`: 485/485.

**AC#1-#5 CONFIRMED**, each against source the reviewer opened itself rather than the implementer's
summary. Notably it closed the two second-hand-sourcing gaps the implementer had flagged honestly:
`NOT_CONFIGURED` confirmed at `src/main/engine-context.js:412` and `HEALTH_CHECK_TIMEOUT` at
`src/engine/pm2Control.js:703` (passed through by `engine-context.js:420`; `restart` inherits both via
`engine-context.js:427`) — so AC#4 no longer rests on tray.js's comment. It also verified the macOS
caveat against the pinned Electron `docs/tutorial/notifications.md` @ v43.2.0 and judged the README's
hedge to neither overstate nor understate it, and confirmed AC#5's quoted dashboard condition verbatim
at `src/renderer/views/dashboard-view.js:94` plus the `getStatus()` shape at `pm2Control.js:746-757`.

**AC#6 NOT CONFIRMED — three blocking findings, one of which nobody else had seen.**

- **B1 (DESIGN.md:422-424) — false counterfactual.** "Before NCOW-55, a thrown/rejected
  `handlers.proxy.*()` call reached only `console.error`" is true of `onStop` ONLY, and only since
  NCOW-53. The reviewer read the pre-NCOW-55 source directly (`git show 76a7c3c^:src/main/tray.js`
  lines 151-156): `onStart` and `onRestart` had NO `.catch()` at all, so a rejection there reached
  nothing and became an unhandled main-process rejection. `src/main/tray.js:189-193` already says this
  and calls it "worse than onStop's pre-NCOW-53 silence"; the new prose flattens it and understates the
  pre-fix state.
- **B2 (README.md:374-375)** — the AC#6 rewrite inverts the forbidden dependency, as already recorded.
- **B3 (README.md:374) — THE PROPOSED REMEDY WAS ITSELF INSUFFICIENT, and this is the wave's best catch.**
  Keeping `# 485 tests, no network access` preserves a SECOND false protection: `npm test` really does
  make a live network call. `test/engine/nvidiaKey.test.js:83` is gated
  `{ skip: process.env.CI ? 'no network in CI' : false }`, so it RUNS whenever `CI` is unset — the
  ordinary local invocation this very README line documents. Observed in the reviewer's own run with
  `CI` empty: `ok 129 - validateApiKey: LIVE - a garbage key against the real NVIDIA API is genuinely
  rejected (network test)`, `duration_ms: 300.35725`. Since this branch rewrote that exact clause
  (`no network` -> `no network access`), it is this branch's to get right. This is the
  "fix the claim, not the instance" class landing on AC#6's own line — the fourth consecutive wave in
  which a pass shipped a fresh instance of the class it was closing.
  Recommended: `# 485 tests`, or `# 485 tests (one live NVIDIA API check unless CI is set)`.

**S1 (should-fix, README.md:288-292) — truncated condition.** The Windows caveat renders Electron's
two-part requirement as "the shortcut a Windows toast is meant to pair with", dropping the
ToastActivatorCLSID co-requirement — which is open on BOTH Windows targets, not portable-only
(`electron-builder.yml:119-127`). So "a real, currently open gap for that build only" is wrong in scope.
Fixing it now also makes the section survive either NCOW-61 resolution and removes a doc edit from that
task's plate, which NCOW-61's own text anticipates.

**N1-N3 (nits)**: DESIGN.md:430 says NCOW-57 "tracked by" these caveats when it resolved them (and the
open CLSID half belongs to NCOW-61); a one-column comment misalignment at README.md:375; Linux listed
under "Known platform caveats" though its bullet is a positive verification.

**ID citation sweep: CLEAN.** NCOW-55 (x3), NCOW-56 (x3), NCOW-57 (x2), NCOW-60 (x1) — all resolve to
real filed tasks. Trailer `Refs NCOW-58.` correct. No fabricated IDs.

**Claim sweep**: the old "no network or real config touched" text survives nowhere outside campaign
records that quote it deliberately. But B1's false counterfactual is a NEW claim this branch introduced,
in DESIGN.md only — a fix pass must not reintroduce it in README.

Fix pass 1 dispatched into the same worktree with all findings verbatim.

## Wave-17 fix pass 1 (fresh worker, same worktree, commit `bd593c090b24ebd15b64db70bef6a0289abaff60` on top of `16c35195ff3e5b771f16f9ef29c0d926401569ae`)

All three blocking findings plus the should-fix addressed; two of the three nits resolved. Cumulative
branch diffstat: README.md +52/-1, DESIGN.md +16. `npm test` 485/485, run twice.

**B1 fixed, and verified at the source rather than from the review text.** The worker ran
`git show 76a7c3c^:src/main/tray.js` itself and confirmed only `onStop` had a `.catch()` (added by
NCOW-53) while `onStart`/`onRestart` had none. Rewrote the DESIGN.md sentence to say exactly that,
deliberately matching `src/main/tray.js:189-193`'s existing framing rather than inventing new wording.

**B2 + B3 fixed as one edit.** `README.md:381` now reads:
`npm test              # 485 tests (one live NVIDIA API check unless CI is set)`
This drops the NCOW-60-coupled `%APPDATA%` claim AND the false "no network access" claim, asserting no
config-safety or network protection at all. It also collapses the two-line comment to one, which
incidentally resolved nit N2.

**B3 RE-VERIFIED INDEPENDENTLY by the fix worker, not taken from the review.** It read the gating line
at `test/engine/nvidiaKey.test.js:83` (`{ skip: process.env.CI ? 'no network in CI' : false }`),
confirmed `CI` was unset via `env | grep '^CI='` returning nothing, and observed in its own run:
`ok 129 - validateApiKey: LIVE - a garbage key against the real NVIDIA API is genuinely rejected (network test)`
with `duration_ms: 291.648459` — a real round trip, not a skip. It chose the reviewer's second suggested
wording over the bare `# 485 tests` precisely because it could personally verify the stronger statement
was true.

**S1 fixed.** Confirmed via `electron-builder.yml:119-127` that electron-builder writes a
ToastActivatorCLSID for NEITHER `nsis` nor `portable` (that comment cites its own zero-hit grep over
`node_modules/app-builder-lib/templates/nsis/`). Reworded the Windows bullet to name the CLSID
co-requirement, scope THAT gap to both targets, and keep the Start-Menu-shortcut gap scoped to
`portable` only. NCOW-61 cited after confirming it is real and open by listing `backlog/tasks/`.

**N1 fixed** ("tracked by NCOW-57" -> "documented by NCOW-57"). **N2** resolved as a side effect.
**N3** deliberately left alone (optional).

**Claim sweep, wider than the finding.** Grepped README/DESIGN/CLAUDE for `no network`, `network access`,
`real config`, `no real`, `485 tests`. One other hit: `README.md:412`, "without touching your real
configuration or your real NVIDIA key" — correctly judged NOT an instance, because it describes the
`NIM_PROXY_TEST_HOME` MANUAL testing harness (CLAUDE.md's "Safe manual testing" section), a different
independently-documented mechanism, and the statement is true. `CLAUDE.md:51`'s own `npm test` line
asserts no protection at all. No other instance of the class found.

**Known residual, disclosed by the worker itself and worth review pass 2's attention**: the S1 wording is
a paraphrase of `electron-builder.yml`'s in-repo comment, which itself paraphrases Electron's doc without
quoting it — so the README text is a paraphrase of a paraphrase, not a direct quote. That was the
instructed fallback (`node_modules/electron` ships no `docs/` directory, only `electron.d.ts`), but it
means the CLSID claim's primary source is not reachable from this worktree.

## Wave-17 review pass 2 verdict — APPROVE (reviewer, Opus, same worktree)

Reviewed the cumulative branch (`16c35195ff3e5b771f16f9ef29c0d926401569ae` + fix
`bd593c090b24ebd15b64db70bef6a0289abaff60`) against wave base
`20ffa60add5d7e281a2f39610adcec1ee987b489`. **ALL SIX acceptance criteria CONFIRMED**, including AC#6,
which pass 1 rejected.

**All pass-1 findings CLOSED: B1, B2, B3, S1, N1, N2** (N2 incidentally, by the line collapsing to one
row). N3 deliberately left as an optional nit.

**Fresh-instance check: NO fresh false or unverified claim.** The reviewer re-read every sentence the fix
commit added or touched and checked each against primary evidence rather than the fix worker's report —
re-deriving the counterfactual from `git show 76a7c3c^:src/main/tray.js` itself, re-running the
ToastActivatorCLSID grep itself (zero hits, and it confirmed `portable.nsi` IS inside the searched
directory, so the evidence genuinely spans both targets rather than only nsis), and reading
`notifyFailure()` at `src/main/tray.js:343-364` to confirm the "never register an activation handler"
claim (construction is `{title, body}` + `.show()`, no listeners).

**The network claim was verified by MEASUREMENT, not inference — the strongest verification in this wave.**
The reviewer ran the full suite under `NODE_OPTIONS=--require <spy>` wrapping `globalThis.fetch` plus
`http.request/get` and `https.request/get`, logging every real call. Result: 485/485 pass, and the log
contained EXACTLY TWO entries, both from that one test —
`REAL FETCH: https://integrate.api.nvidia.com/v1/models` and
`REAL FETCH: https://integrate.api.nvidia.com/v1/chat/completions`. No other real fetch, no raw
http/https; everything else is mocked. It also ran the suite both ways: `CI` unset gives
`# pass 485 / # skipped 0`, `CI=1` gives `# pass 484 / # skipped 1`. So exactly one test in the suite is
CI-gated, and the parenthetical describes the CI-set behavior correctly.
**Verdict on the wording: exactly true as written.** Two recorded precision nits, neither warranting a
change: the single check makes two HTTP round trips (catalog then probe), and the gate is truthiness, so
`CI=` (set but empty) still runs it.

**S1 sourcing judged ADEQUATE, and better than the fix worker disclosed.** `node_modules/electron` indeed
ships no `docs/` directory (verified by listing it), so Electron's prose doc is genuinely unreachable
in-repo. But the chain is not paraphrase-of-a-paraphrase only: `backlog/tasks/ncow-61...md:19` records the
near-verbatim statement WITH the version pin, and `ncow-57...md:17` states the same with its verification
record. Both are filed, in-repo, reviewed artifacts. The README sentence is also WEAKER than that source
("Electron pairs that AUMID with a ToastActivatorCLSID" rather than "requires"), which is the right
direction to err for a user-facing caveat. And the load-bearing half — that electron-builder stamps no
CLSID for either target — the reviewer verified with its own grep.

**ID citation sweep CLEAN**: NCOW-53, NCOW-55, NCOW-56, NCOW-57 (all Done) and NCOW-61 (To Do, correctly
described as "open"). The removed NCOW-60 citation is gone from the tree. No abbreviated SHA leaked into
either committed file.

**Claim sweep verified sound.** The fix worker's judgment that `README.md:412` is NOT an instance is
correct: it describes the `NIM_PROXY_TEST_HOME` + `--dev` MANUAL harness, whose Windows parity was
specifically fixed and live-verified by NCOW-23, whereas this task's defect is in a test-harness path.
Different mechanism, and the claim holds for what it describes.

**Remaining nits, none requiring a pass**: `DESIGN.md:424-425`'s "worse than onStop's pre-NCOW-53 silence"
compares silence to silence, so "worse" does not carry its own reason — `src/main/tray.js:191-193` grounds
it in the unhandled rejection being a process-level hazard, "not just a silent one". Plus the two
precision nits above, N3, and an abbreviated SHA in the fix commit's own body (not in any file).

**Overlap notes.** NCOW-59's prose constraint is satisfied — README never mentions `isSupported()`
throwing and never describes a double-logged or misattributed line, and `README.md:276`/`:310-312` stay
true after NCOW-59 lands. The NCOW-60 semantic collision is fully dissolved, since this branch now makes
no config-safety claim at all. The wording survives either NCOW-61 resolution. **One item for the wave's
post-merge cleanup**: after NCOW-59 (+2) and NCOW-60 (+2) merge, both `README.md:381` and `CLAUDE.md:51`
go stale at 485 -> 489, and the cleanup must change only the number while PRESERVING `README.md:381`'s
parenthetical.

Approved for the merge queue. Two review passes, one fix cycle.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Documented the tray's native OS notification behavior — this app's first-ever OS notification, previously absent from README.md, DESIGN.md and CLAUDE.md alike — and corrected a false safety claim in README's build instructions. Merged as `bc839e110c58cc4ab04f64ffea8b4d1c6aaf29f7` (PR #64), squashed from `23e2f64` + `0c85782` after rebase onto `dev`.

README.md gains a `### Tray notifications on Start/Stop/Restart failures` section covering both failure classes (a wedged/thrown call, and a resolved `{ok:false}` such as `NOT_CONFIGURED` or `HEALTH_CHECK_TIMEOUT` — the more common case), the deliberate tray-Start-vs-dashboard-`#start-btn` asymmetry whose reasoning previously existed only as a code comment, and the known Windows/macOS/Linux caveats. DESIGN.md §7.4 gains a pointer paragraph that deliberately does not duplicate those caveats and says why.

AC#6 corrected `README.md`'s `npm test` comment, which claimed "no network or real config touched". BOTH halves were false: the config half on Windows (which NCOW-60 fixes), and the network half everywhere, because `test/engine/nvidiaKey.test.js:83` skips only when `CI` is set. The line now asserts no protection at all.

Verified: `npm test` 485/485, re-verified after rebase onto `dev`. Two review passes, one fix cycle; all six acceptance criteria independently confirmed by review pass 2, which checked each against primary source rather than the implementer's report. The replacement wording was verified BY MEASUREMENT — the suite run under a require-hook spying on `fetch`/`http`/`https` showed exactly two real calls, both from that one CI-gated test, and `CI=1` yielded 484 pass / 1 skipped.

Pass 1's decisive finding: the obvious remedy for the false claim was itself insufficient, because keeping "no network access" preserved a second false protection in the same clause. It also caught a false counterfactual in DESIGN.md by reading the pre-NCOW-55 source directly — `onStart`/`onRestart` had no `.catch()` at all, so a rejection became an unhandled main-process rejection rather than "only `console.error`".

Known follow-up, recorded for the wave's post-merge cleanup: the `485` count in README.md and CLAUDE.md both go stale once the sibling branches land, and the bump must preserve README's new parenthetical.
<!-- SECTION:FINAL_SUMMARY:END -->
