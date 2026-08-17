# Claude Conduit

Cross-platform Electron app that sets up and supervises a local LiteLLM proxy so Claude
Desktop and the Claude Code CLI route to NVIDIA NIM models.

**Where behaviour is defined.** `DESIGN.md` is the v1 spec and its section numbers are
cited throughout the code — but it is no longer the whole story. Post-v1 decisions live in
Backlog tasks (CCA-2 onward), and where the two disagree, the task wins and DESIGN.md
should be corrected. CCA-4 already reversed a documented v1 decision this way.

**CCA-12 (rebrand to Claude Conduit) has landed.** The product name, config directory
(`claude-conduit`), electron-builder identity, and every in-repo URL/slug now reflect the
new name; README documents the persisted-state migration decisions (config dir, pm2 app
name, Electron userData/encrypted key, Claude Desktop entry) and `src/engine/
configDirMigration.js` / `userDataMigration.js` implement the ones that migrate. The actual
GitHub repo rename (`evolvconsulting/nvidia-cowork` → `evolvconsulting/claude-conduit`) is
now done — it was performed manually out of band, and `REPO_URL` and the git remote both
point at the new location.
**CCA-14 is partly landed.** CCA-14.1 (define the provider interface, reimplement NVIDIA NIM
against it), CCA-14.2 (OpenRouter end to end), CCA-14.3 (Custom/Local — any OpenAI-compatible
base URL) and CCA-14.4 (diagnostics keyed off the active provider's declared capabilities)
are Done: `src/engine/providers/` now holds the `Provider` shape and its `registry.js`, with
three providers registered (`nvidia-nim`, `openrouter`, `custom-local`), and
`engine-context.js` goes through `providers.getProvider(...)` instead of importing
`nvidiaKey`/`modelCatalog` directly — still pinned to `'nvidia-nim'` until CCA-15 adds
multiple saved connections, so nothing but NVIDIA is reachable end to end yet. CCA-14.5
(multi-credential manifest/secret storage) is still open, and so is the parent CCA-14, so the
NVIDIA-only framing is not fully dropped yet — keep implementing against the `Provider`
interface rather than adding new NVIDIA-specific abstractions (the pm2 app name
`litellm-nim` and the icon's NVIDIA/evolv amalgam mark are deliberately untouched by CCA-12
for exactly this reason; see README).

**Three-repo split (2026-08-07).** This repo was renamed again, `evolvconsulting/
claude-conduit` → `evolvconsulting/claude-conduit-app` (GitHub redirects the old name;
the local remote is updated; the in-repo URL sweep and live auto-update verification are
CCA-63). It is now one of three sibling repos: **`claude-conduit-docs`** holds the v2
design — spec `docs/specs/claude-conduit-v2-architecture.md` plus ADRs, maintained with
the `lore` CLI, and is where cross-repo sessions run from — and
**`claude-conduit-gateway`** holds the hosted AWS gateway (LiteLLM on ECS Fargate,
virtual-key auth, Langfuse to the evolv-ultra instance, Bedrock ApplyGuardrail hooks,
email-code key broker; backlog prefix CCG). v2 design decisions are recorded as ADRs in
the docs repo; this repo's Backlog stays authoritative for app behaviour. The app-side
hosted-connection work is CCA-62, gated behind CCA-14/15.

**Backlog prefix migration (2026-08-07): NCOW → CCA, numbering preserved.** `NCOW-N` and
`CCA-N` are the same task — an `NCOW-46` citation in an old code comment, error string,
commit message, or `archive/handovers/` file is today's `CCA-46`. Everything *live*
(backlog/, this file, README, DESIGN.md, docs/, the backlog-handover skill) now says CCA;
source comments and string literals were deliberately left as historical citations — do
not "fix" them in bulk, and cite CCA-N in anything new.

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
npm test          # node --test, 562 tests. Run before AND after any change.
npm run dev       # run from source
npm run icons     # regenerate build/icon.* + src/assets/icon.png from build/icon.svg
npm run licenses  # regenerate src/assets/licenses.json — re-run after ANY dependency change
npm run patch:dev-name  # macOS: make a *source* run say "Claude Conduit", not "Electron"
npm run pack      # unpacked app dir — fastest packaging sanity check
npm run dist      # all three platforms (also dist:mac / dist:win / dist:linux)
```

`src/assets/licenses.json` is **generated and committed** — `npm run dist` has no build
step that could produce it, and the packaging allowlist copies it straight off disk.

## Layout

- `src/engine/` — plain Node, no Electron imports. Every dependency is injected (pm2,
  safeStorage, fs paths), which is what makes it unit-testable without an app.
- `src/main/` — Electron main. `engine-context.js` is the composition root wiring every
  engine module to real dependencies; `ipc.js` registers channels from `ipc-channels.js`
  behind per-domain mutexes — `uninstall` aliases to three (`claudeCode`, `config`,
  `proxy`), acquired together in a fixed order via `withLocks()`; `menu.js` exports
  `buildMenuTemplate(actions, platform)` so the Windows/Linux branches are testable from
  macOS; `shutdown.js` stops the proxy on quit; plus `windows.js`, `tray.js`,
  `status-poller.js`, `app-icon.js`.
- `src/preload/index.js` — derives the entire `window.nimProxy` bridge automatically from
  `CHANNELS`. Adding a channel + handler is all that is needed; don't hand-edit the preload.
- `src/renderer/` — plain HTML/CSS/ES modules. No bundler, no framework. Hash router with
  **bare** route names (`#setup`, not `#/setup`). `components/` holds the `<dialog>`-based
  confirm/about/licenses modals.
- `src/assets/` — runtime data packed into the app: `icon.png` and generated
  `licenses.json`.
- `scripts/` — dev/build tooling: icon generation, license generation, and the macOS
  dev-bundle rename.
- `test/engine/`, `test/main/`, `test/renderer/` — the naming convention is
  `test/**/*.test.js`, but `npm test` is a bare `node --test`, whose real default discovery
  ALSO runs any `.js`/`.cjs`/`.mjs` file found anywhere under a directory named `test`,
  whatever that file is called (verified empirically in CCA-60). Shared, non-test helper
  modules therefore live under a **dot-prefixed** directory — `test/engine/.helpers/` — which
  that discovery skips; a plain `test/**/helpers/*.js` gets picked up as its own
  zero-assertion "test" and silently inflates the reported test count.

## Safe manual testing (load-bearing)

`NIM_PROXY_TEST_HOME` **combined with `--dev`** redirects every path the app touches — its
config dir, `~/.claude`, Claude Desktop's `configLibrary`, and (since CCA-12)
`secretStore.js`'s encrypted-key file — under a fake home. It is the only way to click
destructive buttons without hitting this machine's real Claude Desktop/Code config or its
real encrypted NVIDIA key. Never remove it. It is ignored without `--dev`, so it can never
engage in a real end-user launch of a packaged build (nothing about the packaged binary
itself prevents passing `--dev` — a controlled test launch of the raw executable with
`NIM_PROXY_TEST_HOME` set is exactly as safe as a source `--dev` run, and was used to verify
CCA-12's AC#8).

NOTE (CCA-12): this redirects the one file this app itself writes into Electron's userData
directory (`nim-key.enc`), but NOT Electron's *own* internal `--user-data-dir` (Chromium's
session/GPU/network cache) — that always lands under the real
`~/Library/Application Support/<productName>/` (or platform equivalent) on every launch,
packaged or dev, because it's set by Electron itself before any app code runs. This is
disposable Chromium housekeeping, never anything sensitive this app writes, and is safe to
delete after a manual test run.

NOTE (CCA-23): Windows parity was not automatic. `paths.js`'s win32 branches each resolve as
`opts.appData ?? process.env.APPDATA ?? path.join(homedir, ...)` (same shape for
`LOCALAPPDATA`) — correct for a real, unmodified Windows run, since `APPDATA`/`LOCALAPPDATA`
can legitimately differ from `homedir/AppData/...` under folder redirection or a roaming
profile, so the env var must win over a bare homedir guess there. But it means a caller that
redirects *only* homedir (as `engine-context.js`/`main/index.js` used to) is silently ignored
on win32, because `APPDATA`/`LOCALAPPDATA` are always set on a real Windows machine. Fixed by
having both call sites also pass a matching `appData`/`localAppData` override
(`paths.resolveWindowsAppDataOverrides`) whenever `--dev` + `NIM_PROXY_TEST_HOME` are active —
confirmed live on winvm: the config dir, Claude Desktop's `configLibrary` dir, and the
encrypted-key userData dir all resolved under the fake home, and the real
`%APPDATA%\claude-conduit` (5 files) plus the real Electron userData directory were
SHA-256/timestamp-identical before and after. Any *new* path resolver added to `paths.js` with
a win32 branch needs the same override wired through its call site, or it will silently repeat
this bug. Since CCA-60 there is a **partial** automated backstop for that:
`test/engine/paths-win32-override-guard.test.js` fails if any `test/**/*.test.js` calls one of
those resolvers with a homedir-only override, and its export-drift check fails until a human
classifies each new `paths.js` export as win32-branching or exempt. It scans `test/` only, so
production call sites (`engine-context.js`, `main/index.js`) still have no automated check —
and it is a text scan, with its gaps listed in that file's own "Known, still-open gaps" comment.

```sh
NIM_PROXY_TEST_HOME=/tmp/fake-home NIM_TEST_API_KEY=$(grep NVIDIA_NIM_API_KEY .env | cut -d= -f2) \
  ./node_modules/.bin/electron . --dev
```

That direct `electron .` invocation bypasses npm, and so bypasses the `predev` hook that
renames the dev bundle — run `npm run patch:dev-name` once after any `npm install` if a
source run introduces itself as "Electron".

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
- **A macOS source run takes its menu-bar title and dock tooltip from the *vendored*
  `node_modules/electron/dist/Electron.app/Contents/Info.plist`** — not from
  `package.json`, and not from `app.setName()` (which only relabels menu *items*).
  `scripts/patch-dev-bundle-name.js` rewrites `CFBundleName` there, and both of its extra
  steps are load-bearing: editing the plist breaks the code-signature seal, so it re-signs
  ad-hoc or the bundle will not launch on Apple Silicon at all; and without a following
  `lsregister -f`, macOS serves a stale LaunchServices record and the rename has *no
  visible effect whatsoever*. Packaged builds are unaffected — electron-builder writes the
  right plist. `npm install` restores the pristine bundle; `predev`/`prestart` re-apply.
- **macOS needs ad-hoc signing (`identity: "-"`) plus `disable-library-validation`.** A
  fully unsigned binary will not launch on Apple Silicon, and the hardened runtime
  otherwise rejects Electron's own dylibs.
- **The master key never lives in `manifest.json`** — only in `litellm.env`, read via
  `configGen.resolveMasterKey()`.
- **Claude Desktop's metadata file is `_meta.json`** (leading underscore). The writer only
  ever touches its own dedicated entry, after a full backup, with explicit consent.
- **Uninstall never touches Claude Desktop as a side effect** — that is a separate,
  individually confirmed opt-in in the Uninstall view.
- **Closing the window hides it; quitting stops the proxy** (CCA-4 — this reversed the
  original "the proxy outlives the app" design, so treat any comment still claiming that
  as stale). The stop hangs off the single `before-quit` handler in `index.js`, which
  cancels the quit, stops the proxy, then re-issues it behind a latch — remove the latch
  and it loops forever. `shutdown.js` bounds the stop with a timeout, because a wedged
  pm2 must never make the app unquittable.
- **Never `pm2 kill` from this app.** pm2 runs against the shared default `PM2_HOME`
  (`~/.pm2`), so killing the daemon would stop every unrelated app the user supervises.
  Stop the `litellm-nim` app only; the daemon is not ours — even when *this app itself*
  was the one that bootstrapped it (`pm2Control.js`'s `spawnDaemon()`, CCA-22): the
  moment it exists it's exactly as shared as one that pre-existed, since anything else on
  the machine using the default `PM2_HOME` can register apps against it afterward, and
  this app has no reliable, race-free way to prove it hasn't. **CCA-24 nuance:** that
  daemon is still detached and long-lived by pm2's own design regardless of who started
  it, so it can keep running after this app quits or is even uninstalled — on win32/linux
  `spawnDaemon()` hands it a private copy of the interpreter (`resolveDaemonInterpreter()`)
  instead of this app's own installed binary, so the installed binary is never the thing
  held open. **Corrected characterization (fix pass #2):** updating this app was never
  actually blocked by the daemon holding its own binary open — NSIS renames a locked,
  running image aside and deletes it later, it doesn't fail outright. *Uninstalling* is the
  case that genuinely can still be blocked, intermittently: on a fresh install that was
  never subsequently updated, a silent uninstall reports success while leaving the locked
  binary behind. This fix's relocation is still what makes a normal, repeated uninstall
  attempt eventually succeed cleanly — it just isn't a guarantee against the first attempt
  ever showing that leftover file. The relocated copy (`~/.pm2/daemon-interpreter/`, ~227MiB)
  is itself never cleaned up by an uninstall on any platform — see README.md's "Where things
  live" table and `src/engine/uninstall.js`'s comment on why that's deferred, not fixed. It's
  still a real, still-running, still app-sized process either way — this fix relocates what
  it holds open, it does not stop it existing, and killing it remains exactly as forbidden as
  before. See DESIGN.md section 7.4 and README.md's "Closing vs. quitting".
- **The app is AGPL-3.0-or-later because pm2 is AGPL-3.0**, bundled, and linked through
  `require('pm2')` rather than a subprocess boundary. This is not a free choice — if pm2
  is ever swapped out, the licensing decision must be reopened deliberately. A test in
  `test/main/licenses.test.js` fails if pm2's license and the app's stop agreeing.
- **The renderer's CSP sets `connect-src 'none'`**, so it cannot `fetch()` anything —
  including its own bundled files. Data the renderer needs (e.g. `licenses.json`) comes
  over IPC, never over the network stack.
- **Menu items with a `role` have no JS click handler**, so `menuItem.click()` on them is
  a no-op. Custom items with a `click` callback *are* invokable — that is why About,
  Licenses and View Logs Folder can be driven in tests and Quit cannot.
- **Guard async dialog openers with a *synchronous* latch.** Any `if (openDialog) return`
  check placed after an `await` is useless: two fast clicks both pass it and stack two
  modals. This was a real observed bug in the About dialog.

## Verification standard

Live end-to-end testing here has repeatedly caught defects unit tests missed — including a
unit test that masked a real bug by inventing a manifest field that never exists in
reality. Check acceptance criteria against fresh observed output, not code reading.
