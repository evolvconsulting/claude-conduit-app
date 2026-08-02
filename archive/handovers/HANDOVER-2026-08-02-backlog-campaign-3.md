# Handover — NCOW-10 auto-update campaign, wave 3 done + escalation resolved (waves: 1, tasks: NCOW-10.3 blocked/resolved, NCOW-20 filed)

**Date**: 2026-08-02 | **Grounded against**: `dev` @ `9ef8aecedfb2d4c1384fd576f54eabf935f3c93f`,
clean, 0 ahead/0 behind `origin/dev` | **Tracker**: doc-4

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. This is
the same campaign round (doc-4) as the prior handovers. Wave 3 (NCOW-10.3)
returned status=blocked on a genuine structural finding, was independently
reviewed (verdict: escalate/human_needed), and that escalation was resolved
IN THIS SESSION by the user, not deferred:

- evolvconsulting/claude-conduit was PRIVATE, so electron-updater's default
  unauthenticated feed 404'd for every real install on every platform. User
  chose to make the repo PUBLIC (not the private+token path) and had it
  executed immediately -- confirmed via `gh repo view` and by re-testing the
  feed directly (releases.atom / releases/latest both now 200, previously
  404). This part is DONE, do not re-ask.
- User approved filing exactly one follow-up task for the two independent
  Windows litellm-launch bugs found along the way (NOT the minor
  pm2Control-timeout/package-lock.json items -- those stay as notes only,
  declined as separate tasks) -- created as NCOW-20, no dependencies, ready
  now.
- User then decided NCOW-10.3's real re-verification should wait for NCOW-20
  to land first (so AC#3, proxy restart across the update, can be exercised
  in the same full pass as AC#1/#2, rather than a partial re-run now).
  NCOW-10.3 was given a real Backlog dependency on NCOW-20 (`--dep NCOW-20`)
  to formalize this -- do NOT re-ask this sequencing decision.

The ready set is recomputed live at restore -- do NOT hardcode a "next wave"
list here, but as of this writing NCOW-20 is the only ready task (no deps),
and NCOW-10.3 is blocked-by-dependency on it. Read NCOW-20's full detail
fresh with `backlog task view NCOW-20 --plain` before dispatching.
```

## State

| Item | Status |
| --- | --- |
| Campaign tracker | doc-4. NCOW-10.3 stayed off the Resolved table (not Done — genuinely blocked, then re-sequenced, not completed) but its human_needed escalation is fully resolved. NCOW-20 added to Queue as ready. |
| `dev` / `origin/dev` | In sync, `9ef8aec`, `npm test` confirmed 220/220 after wave 3's merge (PR #11 → `7ea3b45`) |
| Repo visibility | **`evolvconsulting/claude-conduit` is now PUBLIC** (was private all along until this session) — a real, externally-visible, deliberate change made with explicit user confirmation. Verified the auto-update feed now resolves (200, was 404). |
| Real GitHub Releases | `v0.1.0` and `v0.1.1` both published **permanently** (not smoke tests — explicit user decision) with real Windows/macOS/Linux artifacts. `v0.1.0` is currently installed (not running) on the Windows VM `winvm`. |
| Worktrees / treehouse pool | Both slots in pool `claude-conduit-163fa4` (`/1`, `/2`) released and available |
| Branches | No leftover `feat/NCOW-*`/`fix/NCOW-*` branches, local or remote |
| Open PRs | None from this campaign (PR #11 merged). One unrelated open PR exists from another contributor (`tturnerevolv:feat/spec-rev3-and-test-harness`) — not part of this campaign, leave alone |
| `.claude/handovers/` | This file (gitignored) |
| `archive/handovers/` | Now contains 6 prior handovers |

## This session's in-flight wave (omit if clean)

(clean — NCOW-10.3's wave fully settled: worker → reviewer → merge of the narrow version-bump
diff → escalation → user resolution, all complete. No wave dispatched for NCOW-20 yet.)

## Next steps

1. `/backlog-handover restore` — R1/R2/R3 should find a clean, matching state (no drift). R4
   builds the next wave: NCOW-20 is the only ready task (NCOW-10.3 is blocked on it via a real
   dependency edge). Solo wave, no conflicts — dispatch directly.
2. Read NCOW-20's full current text with `backlog task view NCOW-20 --plain` before dispatch —
   it already has 4 ACs and full root-cause detail carried over from NCOW-10.3's findings (see
   `src/engine/platform.js`'s `resolveCliCommand()`, `src/engine/prereqs.js`'s
   `checkLitellmOnPath()`/`checkPython()`, and `configGen.js`'s generated `run.js` launcher).
3. This is a normal code-fix task (unlike NCOW-10.3, it does NOT require live VM access to
   implement — the existing `test/engine/platform.test.js` pattern already injects
   `process.platform`, so Windows behavior can be unit-tested without a real Windows machine).
   Live re-verification on `winvm` is only needed later, as part of NCOW-10.3's full re-attempt,
   not for NCOW-20 itself.
4. Once NCOW-20 is Done, recompute the ready set — NCOW-10.3 should then be ready (both its
   dependencies, now including NCOW-20, satisfied) for a full re-verification pass covering all
   three ACs together. That re-verification will reuse the same winvm access pattern
   (`~/.scripts/winvm.sh`) and CDP-driving technique this session established (see Critical
   context below) — it does not need to be rediscovered.

## Critical context / traps

- **The repo is now PUBLIC.** This is a significant, deliberate, user-confirmed change made this
  session (was private for the entire project history before this). If any future task's
  reasoning assumes "private repo" (e.g. anything about credential handling, security posture,
  or references to "this private project"), that assumption is now stale — re-verify with
  `gh repo view evolvconsulting/claude-conduit --json isPrivate` rather than trusting old
  assumptions or even this handover after enough time has passed.
- **A new live-VM-driving technique was established this session and worked well**: launching
  the installed Electron app on `winvm` with `--remote-debugging-port=9222`, tunneling it over
  SSH (`ssh -L 9222:127.0.0.1:9222`), and driving it via CDP `Runtime.evaluate` calls against
  `window.nimProxy.*` — the same bridge this project's preload already exposes. This is the
  Windows-remote analogue of `CLAUDE.md`'s existing macOS-local CDP pattern. Worth reusing
  directly for NCOW-10.3's eventual re-attempt rather than re-deriving from scratch.
- **Background subagents dispatched via the Agent tool do not reliably self-sustain a long
  `run_in_background: true` Bash wait across multiple CI-polling cycles** — this session had to
  resend a `SendMessage` nudge to the wave-3 worker twice before it correctly set up its own
  background poll-and-notify loop (`until [ "$(gh run view <id> ...)" = completed ]; do sleep
  20; done` as a backgrounded Bash call) instead of just stopping and waiting to be manually
  resumed. If a future worker task involves waiting on a CI run, brief it explicitly up front to
  set up that pattern immediately, not just when told to.
- **`gh repo edit --visibility public` requires `--accept-visibility-change-consequences`** on
  current `gh` — without that flag it either prompts interactively (which fails non-interactively)
  or refuses; pass it explicitly.
- **NCOW-10.3's task notes are the fullest record of the auto-update root-cause chain** — both the
  original worker's findings and an independent opus reviewer's from-first-principles
  re-derivation (which went further than the worker: it additionally confirmed electron-builder
  never auto-detects repo privacy when inferring `publish:` config, and confirmed the blocker
  is platform-independent, i.e. Linux/AppImage would have failed identically). Read those notes
  directly (`backlog task view NCOW-10.3 --plain`) rather than relying on this handover's summary
  if deeper detail is ever needed — this handover intentionally stays a thin pointer per this
  skill's own conventions.
- **Two minor findings from wave 3 were deliberately left as notes-only, not tasks**, per an
  explicit user choice: a `pm2Control.ensureConnected()` timeout/retry gap (a hung first
  `pm2.connect()` permanently wedges every future `proxy:*` IPC call) and a `package-lock.json`
  version-drift nit (still reads `0.1.0` despite `package.json`'s `0.1.1` — `npm ci` tolerated it
  for the real release builds, but it will compound at the next bump). Do not file tasks for
  these without asking again — the user was explicit that only the litellm-launch bugs (NCOW-20)
  warranted a task this round.

## Do not repeat

- Do not re-ask whether the campaign may publish real GitHub Releases, or re-litigate the
  real-permanent-versions-not-smoke-tests decision — both were confirmed earlier in this
  campaign round and exercised without incident.
- Do not re-ask about repo visibility or the token-distribution alternative — the user already
  chose public and it's already done.
- Do not re-ask whether to file a task for the Windows litellm bugs, or whether to also file
  tasks for the pm2Control/lockfile minor items — both were explicitly decided this session
  (yes to the former as NCOW-20 only, no to the latter).
- Do not attempt a partial NCOW-10.3 re-verification (AC#1/#2 only) before NCOW-20 lands — the
  user explicitly chose to wait for a full pass instead.
- Do not trust an agent's own "I'm stopping"/"I've stopped" self-report as proof it has released
  a shared resource — this remains true from prior waves, not re-tested this session but still
  valid guidance for any future concurrent dispatch.
