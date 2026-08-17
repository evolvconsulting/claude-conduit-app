# Handover — wave 16 complete (NCOW-57 Done; 5 review passes across 2 branches, 3 fix cycles, 2 tasks filed)

**Date**: 2026-08-07 | **Grounded against**: `dev` @ `c659e79096b2ca1b4683ae0838076b89f9569bc4`,
clean, 0 ahead / 0 behind `origin/dev` (verified after this handover's own archive commit was
pushed; this handover file itself is gitignored) | **Tracker**: doc-5

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. Wave 16 is
fully merged and settled — NCOW-57 — 26 tasks resolved across waves 1-16.
Queue order confirmed by user on 2026-08-04; do not re-ask.

Queue is 4 items: NCOW-58, NCOW-59, NCOW-60, NCOW-61. All ready by dependency
(NCOW-58 on NCOW-55+NCOW-56, NCOW-59 on NCOW-56, NCOW-61 on NCOW-57 — all Done;
NCOW-60 has no dependencies). RECOMPUTE THE CONFLICT GRAPH LIVE. Provisional,
NOT ground truth:
- NCOW-58 docs-only (README.md/DESIGN.md); NCOW-59 src/main/tray.js +
  test/main/tray-actions.test.js; NCOW-60 test/main/engine-context-config-regen
  .test.js only. Those three look PAIRWISE DISJOINT — a real 3-task wave 17 if
  the file-citation check confirms it. That would be the first genuinely
  parallel wave in a while.
- NCOW-61 is the awkward one and conflicts with all three: its resolution is doc
  material (58), it may touch src/main/tray.js (59), and it shares
  test/main/app-user-model-id.test.js with two latent guard findings recorded in
  its own notes.
- NONE of the four obviously needs live app verification. Confirm that at
  dispatch rather than assuming — NCOW-61 might, depending which way it resolves.

WAVE 16 IS A STANDING WARNING ABOUT PROVISIONAL FILE GUESSES. The guesses
recorded at wave-15 settlement for NCOW-57 were wrong in substance: the task was
filed as "the app never calls setAppUserModelId, and portable installs no
AUMID-bearing shortcut", and the real defect turned out to be an AUMID MISMATCH
affecting the nsis target exactly as much as portable. Compute fresh; do not
inherit.

CRITICAL BRIEFING FOR EVERY WORKER AND REVIEWER — one NEW failure class from
wave 16, plus the established ones which recurred hard:

NEW: "AN AGENT ASKED TO CITE UNFILED WORK WILL GUESS AN ID, AND THE GUESS CAN
COLLIDE WITH A REAL TASK." The cleanup worker cited "NCOW-60" for a follow-up
that had not been filed yet — and NCOW-60 already existed, about something
entirely unrelated. A reader following that pointer lands on the wrong task.
This shipped INSIDE the very branch whose purpose was fixing fabricated
specifics. MITIGATION, now mandatory: never write an ID for work that is not
already filed — cite it by description, or file it first and use the real ID.
Reviewers should sweep NCOW-\d+ citations for existence; the final wave-16
reviewer did this repo-wide (691 citations, 52 distinct IDs, ALL resolve to
filed tasks, zero dangling) and it is cheap.

ESTABLISHED, AND ALL THREE RECURRED IN THIS WAVE:
1. "Fix the claim, not the instance." THREE CONSECUTIVE PASSES shipped a fresh
   instance of the class each was closing. Pass 1 found a truncated Electron
   quote that elided "detect that SQUIRREL was used" (the load-bearing
   condition) plus a false "had no AUMID at all" claim stated in two places.
   Fix pass 1 fixed those and introduced a NEW elision in the same file, in the
   text written to close the related finding. Then the ID fabrication above.
   Each was caught by the NEXT review, never by the pass that shipped it. The
   mandatory sweep-and-report is what eventually breaks the streak — the
   cleanup fix pass was the first in the wave to ship none.
2. Fabricated specifics. Wave 16 hit this twice: an electron-builder "glossary"
   quote that could not be located in any reachable docs source, and the ID
   collision. Require workers to say WHERE they got a quote, and reviewers to
   re-fetch it rather than restate the previous agent's rendering.
3. Guard claims verified BY EXPERIMENT, never by reading. The appId drift guard
   was hardened twice and STILL had holes each time — it silently no-opped
   while a real drift passed green. Probing found six of eight adversarial
   mutations caught, two surviving.

Also still applies: no false counterfactuals; absolute SHAs only, never
HEAD/HEAD~N.

Not queued this round (re-check fresh — last freshly checked 2026-08-06):
NCOW-7 (parked pending NCOW-15), NCOW-11 (open metrics-source design question),
NCOW-13 (depends on undecomposed NCOW-14), NCOW-14 and NCOW-15 (both
self-described as needing subtask decomposition). All still last-updated
2026-07-31.

No in-flight worktrees, branches, or PRs. All 4 treehouse pool trees released
and available. Tree 1 was leased and released cleanly THREE times this session
(implementation + 2 fix passes; integration review; cleanup + fix) — warm-pool
reuse continues to hold, no npm install was needed after the first lease.

This session stopped between waves ON THE USER'S EXPLICIT INSTRUCTION, after
the orchestrator flagged that its context had grown heavy and the queue had
grown from 2 to 4. NOT because the queue emptied.
```

## State

| Item | Status |
| --- | --- |
| Waves 1-15 (NCOW-32 … NCOW-56) | Done, merged prior sessions (PRs #24-#61) |
| Wave 16 (NCOW-57) | Done, merged this session (PR #62 `97f13aa`) |
| Wave 16 cleanup | Merged this session (PR #63 `903bca5`, 2 review passes, 1 fix cycle) |
| Tracker (doc-5) | Settled for wave 16, committed + pushed |
| Queue | 4 tasks — NCOW-58, NCOW-59, plus NCOW-60 and NCOW-61 both filed this session |
| Worktrees/branches/PRs | None in flight; all 4 pool trees released; no open PRs |
| Working tree | Clean, `dev` @ `c659e79`, in sync with origin |
| Test count on merged dev | **485/485 passing** (verified directly by the orchestrator, twice) |

## This session's in-flight wave

None. Wave 16 fully settled: dispatch (conflict graph computed fresh, pairwise-complete across the
queue-order-first pick, so solo BY COMPUTATION) → **precondition probe** → implement (worker,
treehouse tree 1 pinned at wave base `09cbdd9`) → **task review 3 passes / 2 fix cycles** →
serial merge (clean rebase, mandatory re-verify 485/485, PR #62 `97f13aa`) → wave-level integration
review (**8 findings — 16th consecutive wave with real material**) → 2 user-approved follow-ups
(NCOW-60, NCOW-61) → cleanup dispatch → cleanup review 2 passes / 1 fix cycle → cleanup merge
(PR #63 `903bca5`) → settlement (check-ac 1-5, final-summary, `-s Done`, plus a correction to
NCOW-57's own description) → tracker update → this handover.

## Environment facts — probed live this session, worth not re-deriving

Both remote hosts are reachable by hostname over Tailscale with key auth already working
(`ssh -o BatchMode=yes` succeeds). **`timeout` is NOT available on this macOS shell** — use
`ssh -o ConnectTimeout=N`.

**linuxvm (100.68.142.68)** — genuine ACTIVE GNOME 50.1 **Wayland** session (`loginctl`: session 1,
seat0, user `jdnewhouse`, Type=wayland, State=active). `org.freedesktop.Notifications` is owned by
**gnome-shell itself** (`GetServerInformation` → `('gnome-shell','GNOME','50.1','1.2')`). From SSH,
export `XDG_RUNTIME_DIR=/run/user/1000` and
`DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus`; for a GUI app also
`DISPLAY=:0` plus `XAUTHORITY` from `/run/user/1000/.mutter-Xwaylandauth.*` (this last one is NOT
discoverable from docs — a worker found it empirically after "Missing X server or $DISPLAY").
node v22.23.2, npm 10.9.8, git 2.53.0. **GNOME 50 DENIES the Shell Screenshot D-Bus API**
(`AccessDenied: Screenshot is not allowed`) and neither `gnome-screenshot` nor `grim` is installed,
so pixel proof is unobtainable there; `dbus-monitor --session "interface='org.freedesktop.Notifications'"`
is the working substitute. **A preserved evidence capture from this wave lives at
`~/ncow57-evidence/dbus-capture-ncow57-fixpass.log`** — deliberately left in place so reviewers
could confirm it first-hand; safe to delete once nobody needs it.

**winvm (100.76.121.102)** — Windows 11 Pro, ACTIVE CONSOLE SESSION id 1 (`quser`). node v24.18.0,
git 2.54.0. **`ssh winvm` lands in `cmd.exe`, not a POSIX shell** — a POSIX-style
`ssh winvm 'a; b; c'` is echoed back literally rather than executed; wrap in
`powershell -NoProfile -Command "..."`. **`npm.ps1` is blocked by PowerShell's execution policy** —
use `npm.cmd` from `cmd.exe`. To render on the visible desktop, launch into console session 1
(`schtasks` with `/ru` + `/IT` worked). Neither host has the repo cloned; rsync/scp of the worktree
(tar+scp on winvm, which lacks rsync) worked, and both hosts CAN reach GitHub unauthenticated
(`git ls-remote` succeeds) if you prefer cloning.

## Next steps

1. Run `/backlog-handover restore`. Recompute the ready set and conflict graph live. Expect 4 ready,
   with NCOW-58/59/60 plausibly disjoint (a real 3-task wave) and NCOW-61 conflicting with all three.
2. **Brief every worker and reviewer on the ID-fabrication class** (new this wave) and on the three
   established classes, all of which recurred.
3. Consider whether NCOW-60 should also fix `README.md:331`'s "no network or **real config**
   touched" claim — the wave-16 cleanup branch edited that exact line and left that half standing,
   and NCOW-60 establishes it is false on Windows. Recorded in NCOW-60's notes, deliberately NOT
   added to its acceptance criteria unilaterally; ask the user.
4. Consider whether NCOW-61 should absorb the two latent drift-guard bypasses and the one-word
   comment overstatement recorded in its notes. Same call — recorded, not added as ACs.
5. Once NCOW-58/59/60/61 are done, re-run inventory (I1) rather than assuming NCOW-7/11/13/14/15 are
   still correctly excluded.

## Critical context / traps

- **Doc-4 must not be reopened — doc-5 is the live tracker.**
- **The integration review has now found real material in every wave, 1 through 16, without
  exception.** Never skip or shortcut it. Wave 16's yielded 8 findings over a diff a 3-pass task
  review had already approved, including the stale test count in two files and a fabricated doc
  attribution.
- **`npm test` ON A REAL WINDOWS HOST OVERWRITES THE USER'S REAL `%APPDATA%\claude-conduit`.** This
  is filed as NCOW-60 and is NOT yet fixed. `test/main/engine-context-config-regen.test.js:90` and
  `:256` call `paths.resolveConfigDir({homedir})` without threading
  `paths.resolveWindowsAppDataOverrides()`, and `paths.js:59-62`'s win32 branch prefers `APPDATA`
  over a bare homedir override. **Do not run `npm test` on winvm until NCOW-60 lands.** It had
  already fired silently in an earlier wave (clobbered files dated 2026-08-02). The key it writes is
  the fixture `nvapi-old-install`, never a live secret — this also de-escalated a possible-live-key
  concern raised earlier in the wave.
- **NCOW-57 changed Windows behavior for BOTH packaged targets, by explicit user decision.** The app
  now sets the AUMID to `com.evolvconsulting.claudeconduit` on win32 unconditionally, replacing
  Electron's generated fallback `electron.app.Claude Conduit`. Flagged but NOT verified: Windows
  keys taskbar pinning/grouping on the AUMID, so a user who pinned the running window under the old
  value may find the updated app no longer groups with that pin. NCOW-58 may want a sentence on it.
- **NCOW-57 closed only HALF of Electron's two-part Windows requirement.** The ToastActivatorCLSID
  half is NCOW-61. Electron generates a random CLSID once per run when
  `app.setToastActivatorCLSID()` is never called, so the runtime value can never match a shortcut.
- **The `appId` value is hardcoded in exactly two places** — `electron-builder.yml:8` and
  `src/main/appUserModelId.js` — and a drift guard covers that pair, including a `win:`-scoped
  override (which `app-builder-lib`'s `AppInfo.id` getter actually PREFERS over the top-level one).
  Two exotic bypasses survive (a quoted key, a YAML anchor), recorded on NCOW-61.
- **AC amendments this wave were the user's, recorded on the task with reasons** — NCOW-57's AC#1
  and AC#3 moved from "a visible toast" to acceptance-plus-AUMID-correctness because pixel capture
  proved unobtainable on winvm across four strategies; AC#4 got the equivalent clarification for
  Linux. Do not let a future reviewer treat those as an agent quietly reinterpreting a criterion.
- **`src/main/tray.js` deliberately leaves the macOS ad-hoc-signing question unresolved.** Electron's
  docs say unsigned binaries emit a `failed` event; this app ships `identity: "-"`. Whether ad-hoc
  counts as signed is not stated anywhere reachable, and two reviewers agreed inventing an answer
  would be worse than leaving it open. Do not "fix" that by guessing.

## Do not repeat

- **`path` is a zsh-special variable tied to `PATH`.** Assigning `path=/some/dir` in a Bash tool call
  destroys `PATH` and every later command in that invocation fails. Use `WT`, `wt_path`.
- **`git checkout -- <file>` bit an agent mid-pass**, silently reverting its real work along with an
  experiment. Every subsequent agent was told to use a scratchpad backup + `diff` instead, and the
  final reviewers did exactly that. Keep instructing this explicitly.
- **The Agent tool's own `isolation: "worktree"` conflicts with this skill's treehouse-managed
  worktrees — never pass both.** No isolation parameter was passed to any dispatch this session.
- **`treehouse get --lease --json` prints an update banner before the JSON** — extract the object
  first (`grep -o '{.*}'`).
- **Embedding literal apostrophes/backticks inside a single-quoted bash argument silently corrupts
  the text.** Use a heredoc assigned to a shell variable, then pass `"$VAR"`. Every Backlog text
  field this session used `$(cat <<'EOF' ... EOF)`, and the tracker-doc rewrites used a Python script
  writing to a scratchpad file (the doc is ~1550 lines; string-replacing into it from bash is not
  viable).
- **Strip the YAML frontmatter (first 7 lines) before passing a tracker-doc copy to
  `backlog doc update --content`** — `awk 'NR>7'`. The CLI writes its own frontmatter.
- **`backlog task edit` has no per-index AC replace.** `--ac` APPENDS, `--acceptance-criteria`
  REPLACES ALL. To amend criteria #1 and #3 this session, all five had to be re-passed verbatim.
- **`-d/--description` also replaces wholesale**, so correcting a stale statement in a task
  description means reconstructing the whole text. Extracting it first with
  `backlog task view <id> --json` piped through Python was the reliable route.
- **`git branch -d` refuses after a squash merge** — use `-D`, and only after the worktree holding
  the branch has been released.
- **Do not run `backlog` writes from inside a worktree**, and do not let workers run them at all.
  Every dispatch this session was explicitly barred from this; none violated it.
- **User approval was sought via AskUserQuestion before filing NCOW-60 and NCOW-61, before amending
  NCOW-57's ACs, and before stopping.** Follow-up findings were recorded on NCOW-60/NCOW-61 as
  NOTES, deliberately not promoted to acceptance criteria without asking — that call is still open
  for the next session.
- No Agent dispatch failures this session — no 529s, no interruptions. No `name` parameter was passed
  to any Agent call; keep omitting it. No `ScheduleWakeup` fallbacks needed; every dispatch's
  completion notification arrived on its own.
- When archiving a consumed handover, `ls archive/handovers/` first for the next free suffix. This
  session's archived at `-3` (base and `-2` were both taken by earlier same-day sessions).
