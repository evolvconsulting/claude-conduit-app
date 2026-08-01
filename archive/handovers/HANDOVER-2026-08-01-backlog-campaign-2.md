# Handover — backlog campaign wave 1 done (waves: 1, tasks: NCOW-16)

**Date**: 2026-08-01 | **Grounded against**: `dev` @ `171a682d6f1864bedd0893cbbb10ad0c9304113c`,
clean, 0 ahead/0 behind `origin/dev` | **Tracker**: doc-3

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. 1 wave
completed so far (wave 1: NCOW-16, merged via PR #2). Queue order confirmed
by the user on 2026-08-01: NCOW-16 before NCOW-12 (NCOW-16 is now done).
NCOW-12 is next and is NOT yet confirmed ordered against the two follow-up
tasks created at wave 1 settlement (NCOW-17, NCOW-18) -- ask the user for a
quick queue-order confirmation covering those three before building wave 2,
unless they're both still blocked/deferred for other reasons by then. The
ready set is recomputed live at restore -- do NOT hardcode a "next wave" list
here; the tracker (doc-3) is the source of truth.

Locked decisions (see doc-3's "Confirmed at init" section for the full
record, still valid, do not re-ask):
- NCOW-14 and NCOW-15 stay excluded from this campaign -- both need subtask
  splitting first, out of scope for a wave dispatch.
- NCOW-12's GitHub repo rename (evolvconsulting/nvidia-cowork ->
  claude-conduit) stays a MANUAL step -- no worker or the orchestrator runs
  `gh repo rename` autonomously. Every code-level rename is in scope; the
  actual repo rename is not.

New locked decision from this session (2026-08-01), also do not re-ask:
- `origin/dev` is now the real, full mainline (was previously a bare stub --
  see "Resolved at restore #1" in doc-3 for the one-time fix). All future
  wave worktrees fork from `dev` per the skill's normal convention, no more
  deviation.
```

## State

| Item | Status |
| --- | --- |
| Campaign tracker | doc-3, updated through wave 1 settlement |
| Wave 1 (NCOW-16) | Done. Merged via PR #2 (squash commit `a56b156`, now in `dev`) |
| NCOW-17, NCOW-18 | Created this session as wave-1 follow-ups (user-approved); both To Do, not yet queue-ordered against NCOW-12 |
| `origin/dev` / `origin/main` | Fixed this session -- both now carry the full codebase (previously stuck at the bare initial commit; see tracker) |
| `feat/nim-proxy-manager` (local) | Still exists locally, now fully contained in `dev` (safe to ignore or delete at your discretion -- not touched this session beyond the initial push) |
| `.claude/handovers/` | This file (gitignored) |
| `archive/handovers/` | Previous handover archived here this session |
| Treehouse pool | 1 worktree slot (`claude-conduit-2dea77/1`), released back to `available` after wave 1, currently warm (has `node_modules`) -- reusing it for wave 2 should skip the `npm install` step |

## This session's in-flight wave (omit if clean)

(clean — wave 1 fully settled, nothing in flight)

## Next steps

1. `/backlog-handover restore` — R1/R2/R3 should find a clean, matching state (no drift). R4
   builds wave 2 live: NCOW-12 is ready (no deps), but check whether NCOW-17/NCOW-18 should be
   folded into the same wave or deferred — they're unordered relative to NCOW-12 in the
   confirmed queue, so a brief user check on relative priority is warranted before committing to
   wave 2's exact membership (unless NCOW-12 alone already fills the wave per Shared Machine
   State — see below).
2. **NCOW-12 (rebrand) needs careful handling**, more than a typical wave member:
   - It's the only task from the confirmed queue order still pending, and it's large: touches
     `package.json`, `electron-builder.yml`, `REPO_URL`, the macOS dev-bundle rename script,
     tray/menu labels, README/DESIGN.md/CLAUDE.md, generated `licenses.json`, **and** persisted
     user state (config directory, pm2 app name `litellm-nim`, Electron `userData` holding the
     encrypted API key, the Claude Desktop `configLibrary` entry).
   - AC#4/#5 require a documented migrate/leave/reinstall decision, verified against a **real
     pre-rename install**. This machine has one (from prior NCOW-8 work) — good, that's the real
     state needed, but it also has a real Claude Desktop entry (`desktop_config_entry_id` in the
     manifest) from earlier live testing. Do not let a worker touch that entry without the same
     care `CLAUDE.md` documents for Claude Desktop writes (backup first, dedicated entry only,
     real consent) — this is exactly the kind of "material product decision baked into an
     ambiguous AC" the skill's Escalation Policy decide-vs-defer test is for; lean toward
     `human_needed` over a worker guessing past it.
   - It needs live app/proxy verification (AC#8, packaged build launches under new identity) —
     Shared Machine State rule applies: it must be the only live-verification task in its wave.
   - The GitHub repo rename itself stays manual per the locked decision above — do not let a
     worker or the orchestrator run `gh repo rename`.
3. NCOW-9 (blocked on NCOW-12) becomes reachable once NCOW-12 resolves.
4. NCOW-17/NCOW-18 are both agent-resolvable, lower-risk than NCOW-12 (no live-verification
   requirement for NCOW-18; NCOW-17 does touch diagnostics.js again but is scoped, mechanical
   fixes plus a doc update) — good candidates to run alongside or before NCOW-12 if the user
   wants a lower-risk wave first.

## Critical context / traps

- **This session found and fixed a real base-branch problem** (see doc-3's "Resolved at restore
  #1"): `origin/dev`/`origin/main` were both stuck at the bare initial commit; the entire
  codebase existed only on a local, never-pushed `feat/nim-proxy-manager` branch. Fixed via a
  clean fast-forward push. This should not recur, but if a future drift check ever again finds
  `origin/dev` suspiciously behind, don't assume it's fine — check what's actually on it.
- **Live verification against the real NVIDIA account is genuinely slow and variable, not just
  "give it a bigger timeout."** NCOW-16 spent most of wave 1's wall-clock time here: the account
  hit real multi-tenant queue congestion on NVIDIA's shared/free trial endpoint (confirmed via a
  raw curl bypassing this app entirely — 186.6s wall time, NVIDIA's own response reporting real
  queue depth). 90s, 180s, and 300s timeout ceilings were each tried live and still weren't
  enough. **Do not assume "make the timeout bigger" is ever the right fix for a slow-model
  diagnostics complaint** — the user's explicit call was that multi-minute latency is a genuine
  usability failure to surface accurately, not something to paper over. If a future task touches
  similar territory, budget real wall-clock time for live verification (tens of minutes is
  normal) and prefer `meta/llama-3.1-8b-instruct` for anything that doesn't specifically need to
  exercise slow-model behavior (per `CLAUDE.md`).
- Every Backlog CLI write must run from the orchestrator's own main checkout (now `dev`, not a
  worktree) — see the skill's Conventions table, "All Backlog CLI writes" row. Followed
  throughout wave 1 without incident; keep it up.
- The treehouse worktree from wave 1 is warm (has `node_modules`) and back in the pool — reuse
  it for the next wave member rather than re-installing "to be safe."
- A cleanup command (`rm -rf` on a path outside the repo, `/tmp/ncow16-review-*`) was denied by
  this session's permission settings even with `dangerouslyDisableSandbox: true` — looks like a
  hard policy block, not something to keep retrying. If a future wave needs to clean up a
  similar out-of-repo temp path, expect the same block and just ask the user to do it manually
  rather than spending retries on it.

## Do not repeat

- Don't dispatch NCOW-16 and NCOW-12 in the same wave without checking Shared Machine State
  first — both need live proxy/app verification, and only one such task may be in-flight per
  wave. This was caught correctly in wave 1 (NCOW-16 dispatched alone) — keep applying the same
  check for wave 2 if NCOW-17/18 end up sharing a wave with NCOW-12 (they don't need live
  verification themselves, so that particular conflict shouldn't recur, but re-check rather than
  assume).
- Don't accept a worker's live-verification "pre-existing failure" characterization at face
  value when it's based on `git stash` within the same `node_modules` — that only proves it's
  unrelated to the worker's *code* changes, not that it's actually pre-existing/environment-
  independent. The licenses.json staleness in this session was only caught because the
  orchestrator independently reproduced it in a genuinely fresh install; a stash-based check
  inside the same worktree would have missed the real cause (npm-install drift, not the worker's
  diff).
- Don't let a worker converge on an ever-larger timeout constant as "the fix" without checking
  whether the underlying latency is actually bounded. NCOW-16's worker correctly did the raw-curl
  isolation to prove NVIDIA-side congestion was the real cause rather than something in this
  app's own stack (retries, litellm config) — that's the right instinct to keep encouraging in
  review prompts for anything timeout-adjacent.
