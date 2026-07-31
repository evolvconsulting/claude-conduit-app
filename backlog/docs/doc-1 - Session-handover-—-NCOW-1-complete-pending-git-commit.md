---
id: doc-1
title: 'Session handover — NCOW-1 complete, pending git commit'
type: guide
created_date: '2026-07-31 20:02'
updated_date: '2026-07-31 20:03'
---
Read this before doing anything else. It covers where the project stands, the one
outstanding decision, and the traps that cost the most time to find.

## Status: NCOW-1 and all ten subtasks are Done

The app is feature-complete and packaged for all three platforms. `npm test` is 101/101,
and the full UI has passed **three consecutive clean end-to-end runs (50/50 assertions,
0 failures)** against the real NVIDIA API, a real litellm+pm2 proxy, and a sandboxed fake
home. NCOW-1.8 (renderer/tray/wizard) and NCOW-1.10 (packaging) were finished in the most
recent session; read their Implementation Notes for full detail — this document does not
repeat them.

## THE ONE THING THAT NEEDS A DECISION: nothing is committed to git

The entire project is **untracked**. There is exactly one commit in the repo
(`0528c91 Initial commit: add DESIGN.md`); every source file, test, config, doc and icon
written across this whole effort exists only in the working tree.

**Do not commit without asking the user.** They were asked at the end of the last session
and did not answer, so the decision is still open. Two sub-questions were put to them and
are also still open:

1. One commit, or split by area (engine/renderer fixes, icon, packaging)?
2. `build/icons/` holds nine regenerable intermediate PNGs. The recommendation was to
   commit only the three final assets (`build/icon.png`, `.icns`, `.ico`) and gitignore
   `build/icons/`. Not actioned.

Safety already verified: `.env` (which holds a real working NVIDIA API key) is gitignored,
has never been staged, and `git log --all --diff-filter=A` confirms it was never committed.
`dist/` is gitignored too. Nothing sensitive is at risk of being committed accidentally,
but the work is unbacked-up until someone commits it.

## Where to look

- `CLAUDE.md` — updated with commands, layout, the safe-testing mechanism, and a
  "hard-won constraints" list. Read it; several entries encode bugs that took hours to
  find and would be easy to undo while "cleaning up".
- `README.md` — user-facing: prerequisites, per-platform install with the Gatekeeper and
  SmartScreen workarounds, measured artifact sizes, usage, gotchas, building from source.
- `DESIGN.md` — the behavioural source of truth; section numbers are cited in the code.
- `docs/reverse-engineering/claude-desktop-config/` — the NCOW-1.6 spike findings and
  fixtures for Claude Desktop's undocumented local 3P config format.
- `electron-builder.yml` — packaging config, with the reasoning kept as real comments
  (electron-builder's schema rejects `//` keys, which is why it is not in package.json).

## Traps that silently corrupt results

These wasted the most time last session. All are avoidable if you know them.

- **Driving the app over CDP:** kill the **process group**, not the npm `electron` shim.
  The shim spawns the real binary, so `child.kill()` leaves a zombie holding the debug
  port — and your next launch attaches to the *wrong app*, producing confident nonsense.
  Guard by refusing to attach if the port is already in use.
- **Subscribe to `Runtime.exceptionThrown`.** Without it, renderer exceptions are entirely
  invisible and failures look like mysterious hangs.
- **An occluded Electron window gets throttled by Chromium.** This was the root cause of
  the intermittent "uninstall hangs" symptom, and it is fixed in-app via
  `backgroundThrottling: false`. If a UI-driving test goes flaky again in a way that
  self-recovers after ~30-60s, suspect throttling before suspecting app logic.
- **Claude Desktop's metadata file is `_meta.json`**, with a leading underscore.
  Assertions that read `meta.json` silently see nothing and report false failures.
- **The Claude Desktop apply correctly refuses** when Desktop has never created its
  config store (`NO_EXISTING_CONFIG_LIBRARY`). A test fake home must seed
  `Library/Application Support/Claude-3p/configLibrary/_meta.json` first.
- **Claude Code CLI configure intentionally leaves `#toggle-result` empty** — it re-renders
  the whole view (status flips to "Configured" plus a toast). Assert on rendered state.
- **The Gotchas panel is a `<details>` accordion**, so `innerText` omits it. Use
  `textContent`.
- **`meta/llama-3.3-70b-instruct` is genuinely slow upstream on this NVIDIA account**
  (confirmed by direct API calls bypassing the app). Use `meta/llama-3.1-8b-instruct` for
  test runs so you are not debugging someone else's latency.

## Verification standard for this project

Live end-to-end testing has repeatedly caught defects that unit tests missed — in one case
a unit test actively *masked* a real bug by inventing a manifest field that does not exist
in reality. Every acceptance criterion closed here was checked against fresh observed
output, not code reading. Hold that line.

## Reasonable next steps

Nothing is blocked and no follow-up tasks have been created (per the task-creation guide,
that needs user approval). Candidates to raise with the user:

- Resolve the git decision above and commit.
- Launch-test the Windows and Linux artifacts. They were built successfully but never run —
  no such machine was available. This is stated explicitly in NCOW-1.10's notes rather than
  papered over.
- Consider a versioning/release flow if distribution moves beyond personal use.
