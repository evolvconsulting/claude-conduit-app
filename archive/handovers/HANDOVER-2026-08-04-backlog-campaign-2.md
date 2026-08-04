# Handover — wave 13 complete (NCOW-24 Done, 3 review passes)

**Date**: 2026-08-04 | **Grounded against**: `dev` @ `08f6812`, clean, 0 ahead / 0 behind
`origin/dev` | **Tracker**: doc-4

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. Same
campaign round (doc-4). Restore 7 found zero drift against the wave-12
handover, confirmed winvm reachable, then ran wave 13: NCOW-24
(bootstrapped pm2 daemon locks this app's own installed binary on
Windows, HIGH priority, queued since wave 6) dispatched solo -- all three
ready tasks (NCOW-21, NCOW-24, NCOW-31) conflicted pairwise
(NCOW-21/NCOW-24: Shared Machine State/winvm; NCOW-21/NCOW-31:
configGen.js; NCOW-24/NCOW-31: engine-context.js -- a CONFIRMED file
conflict via grep, not the "probable" one flagged at wave 12 settlement),
so the wave shrank to one, same shape as waves 3/10/12.

Took ALL 3 allowed opus review passes (the maximum before auto-escalation
on retry-budget exhaustion) -- this was the longest single-task wave of
the campaign so far. Pass 1: request_changes -- live-reproduced that the
initial fix's companion-file list omitted libffmpeg.so, silently breaking
pm2 cold-bootstrap on every shipped LINUX target (a real regression on a
platform nobody was asking about); live-reproduced that the recorded
"NSIS update is blocked" characterization was WRONG (a real silent NSIS
update against a genuinely locked exe succeeds via Windows'
rename-the-running-image-aside + PendingFileRenameOperations mechanism;
only UNINSTALL is actually blocked, and only intermittently); and found no
integrity check against a partially-copied companion file. Fix pass 1
fixed all three with fresh live verification (a real Ubuntu container
with a genuine Electron Linux binary; real NSIS installers on winvm) --
293/293. Pass 2: independently re-verified all three fixes with
DELIBERATELY DIFFERENT reproductions than pass 1 (linux-arm64 instead of
x64, genuine signed release installers, FileId/registry tracking instead
of timestamps, a different corrupted file) -- all confirmed genuinely
fixed -- but found ONE remaining doc-only defect: README and the About
dialog each still asserted a false "you can clean it up by running
uninstall again" remedy that contradicted the correct "never removed"
claim stated elsewhere in the SAME documents. Fix pass 2 corrected exactly
those two sentences (no code/test changes). Pass 3 (final): approve, all
6 ACs independently confirmed.

npm test 293/293 post-rebase -- one earlier LOCAL run on the rebased
branch showed 292/293; two immediate re-runs came back clean, treated as
flaky/timing-sensitive (not a regression) consistent with this campaign's
prior isolated pm2-test flakiness notes. Squash-merged PR #21 -> dev @
4441f40.

Process note: review pass 2's own returned report triggered the harness's
prompt-injection pattern-match (tag: "settings-json") -- same
false-positive class as wave 9's NCOW-23 review. Inspected and confirmed
benign (the flagged text was the reviewer legitimately reporting real
config-file hash checks it ran to prove nothing sensitive was touched,
not an embedded instruction). Flagged transparently to the user; nothing
in the report was treated as a directive.

This session stopped after wave 13 settlement as a clean context-pressure
checkpoint (R4j) -- this was an unusually long single-task wave (5 agent
dispatches: 1 worker + 3 reviewers + 1 fix-pass worker... actually 2
worker fix passes + 3 reviews = 5 subagents total for one task), not an
escalation. Everything this wave is fully resolved and recorded.

Two tasks remain queued, neither blocked by a dependency: NCOW-21,
NCOW-31. CHECK winvm REACHABILITY FIRST (~/.scripts/winvm.sh "hostname")
before picking up NCOW-21 -- confirmed reachable at this session's
restore 7, not re-checked since. NCOW-24, which conflicted with BOTH
remaining tasks, is now done -- but NCOW-21 (configGen.js /
test/engine/configGen.test.js) and NCOW-31 (engine-context.js,
configGen.js, ipc.js) likely STILL conflict with each other on
configGen.js. Do a fresh file-citation check, don't assume clean just
because NCOW-24 is gone.

The ready set is recomputed live at restore -- do NOT hardcode a
next-wave list. Queue order confirmed by the user across prior sessions;
do not re-ask about repo visibility, release versioning, the two
permanently-published releases, the package-lock.json drift (fixed), or
any of the "do not re-ask" items already recorded in doc-4.
```

## State

| Item | Status |
| --- | --- |
| Campaign tracker | doc-4. Resolved now also holds NCOW-24 (#15). Queue holds NCOW-21, NCOW-31. |
| `dev` / `origin/dev` | In sync at `08f6812`. `npm test` **293/293** verified on merged dev. |
| Merged this session | PR #21 (NCOW-24) → `4441f40`. |
| New task filed | None this session (no follow-up candidates were significant enough to propose; the reviewer's non-blocking findings — disk-cost documentation, staleness-heuristic comment, README wording, test-coverage gaps — were all addressed inline during the fix passes, not deferred to new tasks). |
| Worktrees / treehouse | All 3 slots in pool `claude-conduit-163fa4` released and available. |
| Branches / PRs | No campaign branches (local or remote), no open campaign PRs. |
| Real GitHub Releases | `v0.1.0` and `v0.1.1` still published permanently, untouched. **No new release was published.** Both predate NCOW-24's fix too (like NCOW-27/28/30 before it) — an existing install only picks this fix up via NCOW-30's regeneration mechanism (once the app's own version bumps) or a fresh setup. |
| `winvm` | Confirmed reachable at this session's restore 7 (`~/.scripts/winvm.sh "hostname"` → `winvm`) and used extensively across all 3 review passes plus 2 fix passes. **Re-verify reachability at the start of the next restore** before assuming, same as every prior handover has said. All test artifacts (installed builds, `daemon-interpreter` dirs, `old-install` temp folders) were cleaned up after each session on winvm; the pre-existing shared pm2 daemon (pid 8832) was confirmed byte-identical/PID-identical throughout every pass. |
| `linuxvm` | Not used this wave — the Linux verification this wave used disposable Docker/OrbStack containers instead (genuine Electron Linux binaries downloaded fresh each time), not the campaign's persistent `linuxvm` host. Last confirmed reachable/qualified during NCOW-29 (wave 11). |
| This dev Mac | Real shared pm2 daemon (`~/.pm2`) has the user's own unrelated apps, confirmed untouched (pid, `dump.pm2` hash) before/after every review pass this wave. |

## This session's in-flight wave

(clean — nothing in flight. Wave 13 fully settled: worktree released, branch deleted, PR merged, tracker and task settled Done.)

## Next steps

1. `/backlog-handover restore`. R2/R3 should find no drift.
2. Re-check winvm reachability first if picking up NCOW-21.
3. Build a wave from {NCOW-21, NCOW-31}. Do a fresh file-citation check via `grep` (not the
   cluster-tag heuristic) — as of this handover, NCOW-21 touches `src/engine/configGen.js` /
   `test/engine/configGen.test.js` (`cmdQuoteArg()`), and NCOW-31 touches
   `src/main/engine-context.js`, `src/engine/configGen.js` (`regenerateStaleConfig()`), and
   `src/main/ipc.js` (the mutex it needs to share) — they likely still conflict on
   `configGen.js`, meaning the wave will probably shrink to one again (same pattern as waves
   3/10/12/13). If they turn out NOT to conflict (e.g. if NCOW-31's implementation ends up not
   touching `configGen.js` after all), they could run in parallel — don't assume either way,
   re-verify against the real code.
4. NCOW-31's AC#1 wants a shared mutex primitive `engine-context.js` and `ipc.js` can both
   construct/reuse without `engine-context.js` requiring `ipc.js` directly (which it currently
   cannot, since `ipc.js` pulls Electron modules at module scope and `engine-context.js` is
   required by plain `node --test` suites with no Electron runtime) — whoever picks this up
   should read NCOW-30's own notes for the full reasoning trail before assuming a one-line fix.

## Critical context / traps

- **The Windows daemon-lock characterization from wave 13 supersedes anything said before it**:
  an NSIS **update** against a locked exe is NOT blocked (Windows permits renaming a running
  image; NSIS relocates it via `PendingFileRenameOperations`) — only **uninstall** is blocked,
  and only **intermittently** (only when a preceding update hasn't already relocated the original
  exe). If any future task or doc still says "update is blocked," that's stale — the original
  NCOW-24 report and its first fix pass both had this wrong; it took two independent live
  reviewer reproductions across two passes to pin down the accurate version now in
  README/DESIGN.md/CLAUDE.md/the About dialog.
- **The relocated daemon-interpreter copy at `~/.pm2/daemon-interpreter/` (~227MiB on Windows,
  smaller on Linux) is NEVER cleaned up by any uninstall path, on any platform, by design** — this
  was investigated and explicitly deferred (not a gap): `uninstall.js` can't reliably tell
  whether the daemon currently at `PM2_HOME` is still using that exact copy as its running image,
  so deleting it there risks recreating the exact locked-file problem this fix solves, just
  relocated. Documented consistently across all 4 touched docs now. Don't "fix" this without
  re-deriving why it was left as-is.
- **`DAEMON_INTERPRETER_COMPANION_FILES` in `pm2Control.js` now includes `libffmpeg.so`** — this
  is load-bearing for Linux (`DT_NEEDED`, `RPATH=$ORIGIN`), guarded by `existsSync` so it's a
  correct no-op on win32 where the file doesn't exist. Do not remove it thinking it's
  Windows-specific cruft; the whole reason it's there is that its ABSENCE silently broke Linux
  cold-bootstrap and took a full review pass to catch (nobody had tested Linux against the
  initial fix).
- **`resolveDaemonInterpreter()`'s copy is now integrity-checked and atomic** (stage-then-rename;
  checks every companion file's presence at the destination, not just the exe's size) — this
  closes the "partial copy from a crashed mid-copy is silently reused forever" gap pass 1 found.
  One residual, accepted-as-low-severity gap remains and is fine to leave: the check is
  presence-only, not content-verified, so a *truncated* (not missing) companion file would still
  be accepted — the atomic staging already eliminates this code's own ability to produce that
  state, so it's a residual theoretical case, not a reproduced defect.
- **The size-based staleness check in `resolveDaemonInterpreter()` never actually fires for this
  app's real upgrades** (0.1.1/0.1.2 exes are the same byte size since the code lives in
  `app.asar`, not the exe) — documented as a known, benign limitation (same Electron version =
  still functionally valid interpreter), not a bug to "fix" without a real reason.
- Do not `pm2 kill` any daemon on any machine, ever.
- Diskutil guidance from an earlier wave still stands: never `unmountDisk`/`eject` a whole disk
  identifier locally.
- **A second confirmed false-positive of the harness's prompt-injection pattern-matcher** (tag:
  "settings-json") fired on review pass 2's report this wave — same class as wave 9's NCOW-23
  review. Both times the flagged text was legitimate reporting of real file-path/hash
  verification the reviewer ran to PROVE nothing sensitive was touched, not an actual embedded
  instruction. Continue flagging these transparently to the user when they occur, but don't treat
  them as a reason to distrust an otherwise well-evidenced report.
- Reviewers this campaign have repeatedly modeled a good standard worth continuing: build your
  OWN independent A/B (not the implementer's/prior reviewer's) when re-verifying a fix, and vary
  the exact reproduction inputs to catch an overfit fix — wave 13's review pass 2 did this most
  thoroughly yet (different Linux architecture, different release build, different verification
  method, different corrupted file, all deliberately distinct from pass 1's approach).
- CLAUDE.md still says "178 tests" in its Commands section — stale, drifted over many waves
  (real count is 293 as of this handover). Flagged again by wave 13's review pass 3. Non-blocking,
  flagged repeatedly across at least 3 waves now, not fixed here — mention if picked up, don't
  treat as new information. **If NCOW-21 or NCOW-31 is picked up next and either worker has spare
  scope, this one-line CLAUDE.md fix might finally be worth just doing inline** rather than
  flagging a fourth time — use judgment, it's genuinely trivial.

## Do not repeat

- Do not re-verify NCOW-27/28/29/30/24's ACs — all closed with independently-reproduced live
  evidence (see doc-4's Resolved table and each task's own notes).
- Do not re-ask about repo visibility, release versioning, the two permanent releases, the queue
  order, or the package-lock.json drift (fixed) — all settled and still valid.
- Do not publish a GitHub Release or push a tag without explicit user authorization.
- Do not propose filing a follow-up task for `secretStore.js`'s `importFromExistingEnvFile()` —
  already evaluated and correctly declined (dead code, zero callers) back in wave 11.
- Do not trust a subagent's idle notification as a completed handoff — prior-wave reviewer agents
  have gone idle without sending their structured verdict; the correct move was to message them
  directly and ask for the result, not to assume failure or re-dispatch a fresh agent.
- Do not assume "an NSIS update is blocked" by the daemon file-lock — this was the ORIGINAL
  (wrong) characterization in NCOW-24's own filed description and its first fix pass; it took two
  live reviewer reproductions to establish the accurate version (update: not blocked; uninstall:
  blocked, intermittently). See Critical context above.
