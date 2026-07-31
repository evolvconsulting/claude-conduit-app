# NIM Proxy Manager

Cross-platform Electron app that sets up and supervises a local LiteLLM proxy so Claude
Desktop and the Claude Code CLI route to NVIDIA NIM models. `DESIGN.md` is the source of
truth for behaviour; its section numbers are cited throughout the code.

<!-- BACKLOG.MD GUIDELINES START -->
<!-- backlog.md-instructions-version: 1.48.0 -->
<CRITICAL_INSTRUCTION>

## Backlog.md Workflow

This project uses Backlog.md for task and project management.

**For every user request in this project, run `backlog instructions overview` before answering or taking action.**

Use the overview to decide whether to search, read, create, or update Backlog tasks.

Before task lifecycle actions, read the matching detailed guide:
- `backlog instructions task-creation` before creating or splitting tasks
- `backlog instructions task-execution` before planning, changing status or assignee, adding a plan or implementation notes, or implementing task work
- `backlog instructions task-finalization` before checking acceptance criteria, writing final summaries, or moving tasks to terminal statuses

Use `backlog <command> --help` before running unfamiliar commands. Help shows options, fields, and examples.

Do not edit Backlog task, draft, document, decision, or milestone markdown files directly. Use the `backlog` CLI so metadata, relationships, and history stay consistent.

</CRITICAL_INSTRUCTION>
<!-- BACKLOG.MD GUIDELINES END -->

## Commands

```sh
npm test        # node --test, 101 tests. Run before AND after any change.
npm run dev     # run from source
npm run icons   # regenerate build/icon.* + src/assets/icon.png from build/icon.svg
npm run pack    # unpacked app dir — fastest packaging sanity check
npm run dist    # all three platforms (also dist:mac / dist:win / dist:linux)
```

## Layout

- `src/engine/` — plain Node, no Electron imports. Every dependency is injected (pm2,
  safeStorage, fs paths), which is what makes it unit-testable without an app.
- `src/main/` — Electron main. `engine-context.js` is the composition root wiring every
  engine module to real dependencies; `ipc.js` registers channels from `ipc-channels.js`
  behind a per-domain mutex; plus `windows.js`, `tray.js`, `status-poller.js`, `app-icon.js`.
- `src/preload/index.js` — derives the entire `window.nimProxy` bridge automatically from
  `CHANNELS`. Adding a channel + handler is all that is needed; don't hand-edit the preload.
- `src/renderer/` — plain HTML/CSS/ES modules. No bundler, no framework. Hash router with
  **bare** route names (`#setup`, not `#/setup`).
- `test/engine/`, `test/main/`, `test/renderer/` — the test glob is `test/**/*.test.js`.

## Safe manual testing (load-bearing)

`NIM_PROXY_TEST_HOME` **combined with `--dev`** redirects every path the app touches — its
config dir, `~/.claude`, and Claude Desktop's `configLibrary` — under a fake home. It is the
only way to click destructive buttons without hitting this machine's real Claude
Desktop/Code config. Never remove it. It is ignored without `--dev`, so it can never engage
in a packaged build.

```sh
NIM_PROXY_TEST_HOME=/tmp/fake-home NIM_TEST_API_KEY=$(grep NVIDIA_NIM_API_KEY .env | cut -d= -f2) \
  ./node_modules/.bin/electron . --dev
```

A real working NVIDIA key is in `.env` (gitignored, never committed) — reuse it rather than
asking for a new one. Prefer `meta/llama-3.1-8b-instruct` for test runs (~300-900ms);
`meta/llama-3.3-70b-instruct` has been observed genuinely slow upstream on this account.

To drive the real UI, launch Electron with `--remote-debugging-port` and speak CDP over a
WebSocket (`ws` is already in `node_modules`). Two traps that silently corrupt results:
kill the **process group** — the npm `electron` shim spawns the real binary, so killing the
shim leaves a zombie holding the port and you end up driving the wrong app — and subscribe
to `Runtime.exceptionThrown`, or renderer errors stay completely invisible.

## Hard-won constraints — do not "simplify" these away

- **Never `window.confirm/alert/prompt` in the renderer.** They block the entire Electron
  renderer: no timers, no IPC replies, no repaints. Use `components/confirm-dialog.js`.
  A test enforces this.
- **`backgroundThrottling: false`** in `windows.js`. Chromium throttles an occluded
  renderer, which suspends `<dialog>` close events (so confirm promises never settle) and
  stalls the live log viewer and status pill.
- **`sandbox: false`** in `windows.js`. Electron's sandboxed-preload `require()` resolves
  only a small built-in allowlist and cannot load local project files at all.
  `contextIsolation: true` + `nodeIntegration: false` remain the real boundary.
- **pm2 must be `asarUnpack`ed.** It spawns its daemon by real script path, which is not
  executable from inside `app.asar`.
- **electron-builder's `files` is an allowlist.** It packs from the filesystem, not from
  git, so this is what keeps `.env` out of every artifact.
- **macOS needs ad-hoc signing (`identity: "-"`) plus `disable-library-validation`.** A
  fully unsigned binary will not launch on Apple Silicon, and the hardened runtime
  otherwise rejects Electron's own dylibs.
- **The master key never lives in `manifest.json`** — only in `litellm.env`, read via
  `configGen.resolveMasterKey()`.
- **Claude Desktop's metadata file is `_meta.json`** (leading underscore). The writer only
  ever touches its own dedicated entry, after a full backup, with explicit consent.
- **Uninstall never touches Claude Desktop as a side effect** — that is a separate,
  individually confirmed opt-in in the Uninstall view.
- The pm2-supervised proxy **deliberately outlives the app**. Closing the window hides it;
  quitting leaves the proxy running.

## Verification standard

Live end-to-end testing here has repeatedly caught defects unit tests missed — including a
unit test that masked a real bug by inventing a manifest field that never exists in
reality. Check acceptance criteria against fresh observed output, not code reading.
