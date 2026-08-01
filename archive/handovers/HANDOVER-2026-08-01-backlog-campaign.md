# Handover — backlog-handover campaign initialized (waves: 0, tasks: none yet)

**Date**: 2026-08-01 | **Grounded against**: `feat/nim-proxy-manager` @ `d1bfe6a`, clean, 0 waves
run yet | **Tracker**: doc-3

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. 0 waves
completed so far — this is the very first restore after init. Queue order
confirmed by the user on 2026-08-01; do not re-ask: NCOW-16 before NCOW-12.
The ready set is recomputed live at restore — do NOT hardcode a "next wave"
list here; the tracker (doc-3) is the source of truth for what's ready.

Locked decisions (see doc-3's "Confirmed at init" section for the full
record):
- NCOW-14 and NCOW-15 are deliberately excluded from this campaign — both
  need subtask splitting first, which is out of scope for a wave dispatch.
  Do not queue them without a fresh, explicit user decision.
- NCOW-12's GitHub repo rename (evolvconsulting/nvidia-cowork →
  claude-conduit) stays a MANUAL step — do not have any worker or the
  orchestrator itself run `gh repo rename`. Every code-level rename is
  in scope; the actual repo rename is not.

Critical trap: the entire `feat/nim-proxy-manager` branch (17 commits,
including this campaign's own init) has NEVER been pushed to origin — there
is no upstream tracking branch at all. This is orthogonal to the campaign's
own future branches (which branch off `dev`, the real default branch, not
off `feat/nim-proxy-manager`), but the user should probably be asked
whether/when to push this branch, since none of this session's work is
backed up anywhere but this machine yet.
```

## State

| Item | Status |
| --- | --- |
| Campaign tracker | doc-3, created and populated this session |
| Wave 1 | Not yet dispatched — next restore's job |
| `.claude/handovers/` | gitignored, created this session |
| `archive/handovers/` | tracked, created this session (empty, `.gitkeep`) |
| `feat/nim-proxy-manager` | 17 commits ahead of `origin/dev`, 0 behind, **never pushed** |

## This session's in-flight wave (omit if clean)

(clean — no wave has been dispatched yet)

## Next steps

1. `/backlog-handover restore` — will run R1 (locate this handover) → R2 (drift check —
   should find nothing, since nothing was dispatched) → R4 wave loop, building wave 1 from
   NCOW-16 (no deps, ready) and NCOW-12 (no deps, ready), per the confirmed queue order in
   doc-3.
2. NCOW-16's fix (a hardcoded 30s timeout in `src/engine/diagnostics.js`'s `postMessages()`)
   will need live verification against the real NVIDIA account per its AC#2 — the real key is
   in `.env`, and `meta/llama-3.3-70b-instruct` is the known-slow model to re-test against
   (`.env`/model choice per `CLAUDE.md`'s Safe manual testing section).
3. NCOW-12 (rebrand) touches persisted user state (config directory, pm2 app name, Electron
   userData holding the encrypted API key, the Claude Desktop entry) — AC#4/#5 require a
   documented migrate/leave/reinstall decision verified against a **real pre-rename install**.
   This machine already has one (per prior session's doc-2/NCOW-8 work) — good, that's exactly
   the real state needed to verify against, but be careful: it also has a real Claude Desktop
   entry (`desktop_config_entry_id` in the manifest) from earlier live testing. Do not let a
   NCOW-12 worker touch that entry without the same care CLAUDE.md already documents for
   Claude Desktop writes (backup first, dedicated entry only, real consent).

## Critical context / traps

- Every Backlog CLI write during the wave loop must run from the orchestrator's own main
  checkout, never inside a worktree — see the skill's Conventions table, "All Backlog CLI
  writes" row. This was the single biggest defect the Opus review caught in the skill itself;
  don't reintroduce the mistake by hand.
- `treehouse`'s pool is cold on this machine (no `treehouse.toml`, `treehouse status --json`
  currently returns nothing) — wave 1's first worktree(s) will pay a full `npm install`
  regardless of treehouse vs. fallback.
- This app has shared machine-global state (`~/.pm2`, one fixed proxy port, real Claude
  Desktop/Code config) that the file-conflict model doesn't see — the skill's "Shared machine
  state" convention row already covers this, but it's worth restating: at most one in-flight
  wave member may touch the running app live, and only under `NIM_PROXY_TEST_HOME` + `--dev`.

## Do not repeat

- (none yet — no wave has run)
