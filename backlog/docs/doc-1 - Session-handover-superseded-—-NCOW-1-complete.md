---
id: doc-1
title: Session handover (superseded) — NCOW-1 complete
type: guide
created_date: '2026-07-31 20:02'
updated_date: '2026-07-31 21:57'
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

## Git state: committed on a branch, not yet on `dev`

The work is committed as seven logical commits on **`feat/nim-proxy-manager`**, on top of
the repo's original `0528c91 Initial commit: add DESIGN.md`:

```
b917f28 build: package for macOS, Windows and Linux, and document distribution
b3a5e24 feat(icon): replace the default Electron icon with a custom app mark
09494dc feat(renderer): add the views, Setup wizard and shared components
a99e9e7 feat(main): add the Electron main process and IPC security boundary
cdfd63e feat(engine): add the plain-Node engine layer
cd89cf6 docs: record Claude Desktop third-party config reverse-engineering findings
525fc43 chore: scaffold project tooling, agent config and Backlog tracking
```

The working tree is clean and `npm test` is 101/101 at HEAD.

**Still to do:** the branch has not been merged into `dev` (the default branch), and
nothing has been pushed. A remote *is* configured
(`origin git@github.com:evolvconsulting/nvidia-cowork.git`) but no push was requested, so
the work exists only on this machine. To put it on `dev`:

```sh
git switch dev && git merge --ff-only feat/nim-proxy-manager
```

Secret hygiene was verified after committing, not assumed: `.env` holds a real working
NVIDIA API key, is gitignored, appears in no commit, and the key string itself does not
appear anywhere in `git rev-list --all`. `dist/` and `build/icons/` are ignored too — the
latter holds regenerable icon intermediates, rebuildable with `npm run icons`; only
`build/icon.svg` and the three packaging inputs it produces are tracked.

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

- Merge `feat/nim-proxy-manager` into `dev` (command above) and push to `origin`. Until
  then the work exists only on this machine — ask before pushing.
- Launch-test the Windows and Linux artifacts. They were built successfully but never run —
  no such machine was available. This is stated explicitly in NCOW-1.10's notes rather than
  papered over.
- Consider a versioning/release flow if distribution moves beyond personal use.
