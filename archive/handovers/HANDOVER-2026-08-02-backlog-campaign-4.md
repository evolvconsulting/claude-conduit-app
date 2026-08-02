# Handover — NCOW-10 auto-update campaign, wave 4 done (waves: 1, tasks: NCOW-20 done, NCOW-21 filed)

**Date**: 2026-08-02 | **Grounded against**: `dev` @ `26434d3202495f129043f9f638b8aca9e626a983`,
clean, 0 ahead/0 behind `origin/dev` | **Tracker**: doc-4

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. This is
the same campaign round (doc-4) as the prior handovers. Wave 4 (NCOW-20,
Windows litellm-launch bugs) went through 3 review passes and is now Done
and merged (PR #12 -> dev @11eacfa). Two ready tasks now exist:

- NCOW-10.3 (real end-to-end auto-update verification) -- all 3 dependencies
  (NCOW-10.1, NCOW-10.2, NCOW-20) are Done. This is the big one: real live
  verification on the Windows VM (winvm), reusing the app already installed
  there (v0.1.0) and the already-published v0.1.1 release from wave 3. User
  explicitly chose to stop the session after wave 4 rather than dispatch
  this immediately, given how much ground the session had already covered --
  not because of any blocker. It is fully unblocked and ready.
- NCOW-21 (small follow-up: harden cmd.exe embedded-quote escaping + fix a
  doc-comment wording nit in configGen.js) -- no dependencies, ready now.
  User approved filing this from NCOW-20's two non-blocking review findings.
  This is a normal, fast, low-risk code-fix task (unlike NCOW-10.3) -- no
  live VM strictly required to implement, though live verification via
  winvm is worth it for AC#1 given how much subtlety this exact escaping
  logic has already shown across NCOW-20's 3 review passes.

The ready set is recomputed live at restore -- do NOT hardcode a "next wave"
list here. Both NCOW-10.3 and NCOW-21 touch/relate to configGen.js and the
Windows launcher path -- read each task's real Dependencies and file
footprint fresh before deciding whether they conflict (NCOW-21 touches
configGen.js's escaping logic directly; NCOW-10.3 doesn't modify code, it
verifies the already-shipped behavior -- likely NOT a real file conflict,
but confirm rather than assume).
```

## State

| Item | Status |
| --- | --- |
| Campaign tracker | doc-4. NCOW-20 moved to Resolved. NCOW-10.3 and NCOW-21 both in Queue as ready. |
| `dev` / `origin/dev` | In sync, `26434d3`, `npm test` confirmed 235/235 after wave 4's merge (PR #12 → `11eacfa`) |
| Repo visibility | Still PUBLIC (set in the prior session, unchanged this session) |
| Real GitHub Releases | `v0.1.0` and `v0.1.1` still published permanently. `v0.1.0` is still installed (not running) on `winvm` — untouched this session, NCOW-20 needed no live VM access to implement (only its reviewer used `winvm`, for verification, not code changes). |
| Worktrees / treehouse pool | Both slots in pool `claude-conduit-163fa4` (`/1`, `/2`) released and available |
| Branches | No leftover `feat/NCOW-*`/`fix/NCOW-*` branches, local or remote |
| Open PRs | None from this campaign (PR #12 merged). One unrelated open PR from another contributor, unchanged, leave alone |
| `.claude/handovers/` | This file (gitignored) |
| `archive/handovers/` | Now contains 7 prior handovers |

## This session's in-flight wave (omit if clean)

(clean — NCOW-20's wave fully settled: implementation → 3 review/fix-pass cycles → merge →
settlement → follow-up task filed. No wave dispatched for NCOW-10.3 or NCOW-21 yet.)

## Next steps

1. `/backlog-handover restore` — R1/R2/R3 should find a clean, matching state (no drift). R4
   builds the next wave from NCOW-10.3 and NCOW-21 — check for a real file conflict before
   deciding whether they can run in the same wave (see the paste-ready prompt above).
2. For NCOW-10.3: read its full current text fresh (`backlog task view NCOW-10.3 --plain`) —
   it already carries the complete history from wave 3 (privacy blocker, resolution, the two
   Windows bugs that are now fixed). The remaining work is genuinely just: relaunch the
   already-installed v0.1.0 app on `winvm` so a fresh startup check fires against the
   already-published v0.1.1, confirm the update now actually downloads+installs (should work
   now — the repo is public), and this time also confirm AC#3 (proxy actually running again
   post-update) since NCOW-20's fixes mean litellm can now genuinely launch on Windows. This
   should be substantially cheaper than wave 3's original attempt — no new releases need
   publishing, no fresh install needed, just the relaunch-and-observe cycle plus first-run setup
   if the VM's install needs it reconfigured.
3. For NCOW-21: read its full text (`backlog task view NCOW-21 --plain`) — it has complete
   technical detail on the exact escaping construction the reviewer already live-verified
   (`s.replace(/(\*)"/g, '$1$1""')`-shaped, cmd.exe-style doubled-quote escaping instead of
   MSVCRT backslash-doubling). A worker should still independently verify rather than just
   transcribing the task description.

## Critical context / traps

- **`gh repo edit --visibility public` requires `--accept-visibility-change-consequences`** —
  not relevant again unless visibility ever needs touching, but worth remembering.
- **Live-VM-driving via CDP over an SSH-tunneled `--remote-debugging-port`** remains the
  established technique for anything requiring real UI interaction on `winvm` — reuse directly.
- **DISKUTIL SAFETY, learned the hard way this session**: a wave-4 reviewer's own cleanup of a
  local case-sensitive test volume ran `diskutil unmountDisk force`, which unmounts the WHOLE
  disk/container, not just one volume — it took down this repo's own disk (`/Volumes/_data`,
  FileVault-encrypted) mid-review. No data was lost; the user manually unlocked it
  (`diskutil apfs unlockVolume disk3s7` or via Finder/Disk Utility) and the orchestrator
  confirmed full repo/worktree integrity before continuing. **Any future agent creating a local
  test volume/mount for any reason must target only that specific volume when tearing down**
  (`diskutil unmount <volume>` or `hdiutil detach <device>`), never `unmountDisk`/`eject` on a
  whole disk identifier. Subsequent fix/review passes in this session were explicitly briefed on
  this and completed without incident (one skipped local volume creation entirely and relied on
  hand-tracing instead; another used only `winvm` SSH access with no local disk operations).
- **`cmd.exe`'s command-line quoting semantics are subtler than they look, proven across 3 real
  review passes on NCOW-20**: quoting alone (no caret-escaping) is what neutralizes `& | < > ( )`
  inside a quoted region — `^` is NOT an escape character there and inserting one corrupts
  values (broke `Program Files (x86)`, twice, in two different flawed attempts). Live testing on
  a real Windows VM caught defects that careful code reasoning alone missed twice in a row. If
  NCOW-21 or any future task touches this same escaping logic, insist on live winvm verification
  again rather than trusting reasoning-only review — this specific piece of logic has a real
  track record of looking correct and not being.
- **Case-sensitivity blind spots**: this Mac's default filesystem (APFS) is case-insensitive,
  which let a real test bug (fixtures created as lowercase `.exe` matching an uppercase-default
  `pathExt` only by accident) pass locally while it would have broken CI (`ubuntu-latest`, which
  is case-sensitive). Any test asserting exact filename/extension matching on this codebase
  should double-check it isn't silently relying on this machine's case-folding.

## Do not repeat

- Do not re-ask about repo visibility, the token-distribution alternative, or the
  real-permanent-versions-not-smoke-tests decision — all settled in prior sessions/waves.
- Do not re-ask whether to file NCOW-21 — already approved and filed this session.
- Do not attempt to "simplify" the `cmd.exe` launcher escaping back toward `shell:true` or a
  simpler quoting scheme without live-verifying on `winvm` first — this exact code has already
  fooled two rounds of careful-looking-but-wrong fixes.
- Do not use `diskutil unmountDisk`/`eject` on a whole disk identifier for any local test-volume
  cleanup — target the specific volume only (see Critical context above).
- Do not trust an agent's own "I'm stopping"/"I've stopped" self-report as proof it has released
  a shared resource — carried forward from earlier waves, still valid guidance.
