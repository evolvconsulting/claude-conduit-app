# Claude Conduit

A cross-platform desktop app that sets up and supervises a local [LiteLLM](https://docs.litellm.ai/)
proxy, so **Claude Desktop** and the **Claude Code CLI** talk to
[NVIDIA NIM](https://build.nvidia.com/) models instead of Anthropic's API.

It handles the parts that are tedious or easy to get wrong: checking prerequisites,
validating your NVIDIA key, picking models, generating the LiteLLM config, keeping the
proxy alive under pm2, wiring up both Claude clients, and running a 10-check diagnostic
suite against the running proxy.

> **Read this first — this is not "free Claude."** Responses come from whichever NIM model
> you choose. Agentic-coding quality differs from Claude models, sometimes a lot. See
> [Things to know](#things-to-know) before you rely on it.

> **Upgrading from NIM Proxy Manager?** This app was previously named NIM Proxy Manager.
> See [Upgrading from NIM Proxy Manager](#upgrading-from-nim-proxy-manager) for what
> carries over automatically and what you'll need to redo.

### Where this is heading

Two changes are still agreed and in the backlog, and they will affect anyone building on
this now:

- **NVIDIA NIM is becoming one provider among several**, alongside OpenRouter and any
  OpenAI-compatible custom/local endpoint — so the NIM-specific framing throughout this
  README is temporary. (This is also why the pm2 app name `litellm-nim` and the current
  NVIDIA/evolv icon mark were deliberately left alone by the Claude Conduit rename —
  changing them once, when NIM stops being the only provider, beats changing them twice.)
- **Configuration becomes a library of named connections** you switch between, rather than
  a single proxy you set up once.

Builds are currently unsigned; code signing is planned before the first tagged release.

---

## Prerequisites

| What | Why | Required |
|---|---|---|
| **Python 3** (on `PATH`) | Needed to install `litellm` if you don't have it. The app can install it for you, but it cannot install Python. | Only if litellm isn't installed yet |
| **litellm** | The actual proxy. The app detects it, and offers to install it via Python if missing. | Yes |
| A free **NVIDIA NIM API key** | Get one at [build.nvidia.com](https://build.nvidia.com/) → pick any model → *Get API Key*. | Yes |

Node.js and pm2 are **bundled inside the app** — you don't need to install them.

The app refuses to use litellm **1.82.7** and **1.82.8**: those two releases on PyPI
contained malware. If you already have one of them, upgrade before continuing.

---

## Install

**Download the build for your OS from the
[Releases page](https://github.com/evolvconsulting/claude-conduit/releases/latest).**
That's the only install path: no Homebrew cask, no `winget`, no apt repository, and
deliberately no `curl … | sh` installer script. The reasoning behind both of those
choices is written up in [docs/distribution.md](docs/distribution.md).

Nothing else has to be installed first — Node and pm2 ride along inside the app, and the
app installs `litellm` for you (via your Python) during setup.

> **Builds are not code-signed yet.** macOS builds are ad-hoc signed and *not* notarized;
> Windows builds carry no Authenticode signature. Both operating systems therefore warn
> loudly on first launch, and you have to click through it once. Real signing is planned
> before 1.0, at which point these sections get much shorter.

The filenames below are written with **dashes**, matching the names recorded in the
`latest*.yml` update metadata (i.e. what an auto-updater will fetch). `npm run dist` writes
them to disk with a **space** instead — `Claude Conduit-<version>-universal.dmg` — and
GitHub's web uploader would turn that space into a period. Same artifact either way; if
what you downloaded has a space or a period where this README shows a dash, it's not a typo
and not a different build.

### macOS — `Claude-Conduit-<version>-universal.dmg`

Universal build; runs natively on both Apple Silicon and Intel.

1. Open the `.dmg` and drag **Claude Conduit** onto the **Applications** shortcut.
2. Launch it once from Applications. macOS blocks it with a dialog along the lines of
   *"Apple could not verify "Claude Conduit" is free of malware…"* — click **Done**
   (**not** *Move to Trash*).
3. Open **System Settings → Privacy & Security**, scroll down to **Security**. There's a
   line saying Claude Conduit was blocked — click **Open Anyway**, authenticate, then
   confirm with **Open**.

That's once per installed version; afterwards it launches normally.

On **macOS 15 (Sequoia) and later** step 3 is the only route — Apple removed the old
Control-click → *Open* override. On **macOS 14 and earlier**, Control-click the app →
**Open** → **Open** still works and replaces steps 2–3.

If you'd rather do it from a terminal (or the *Open Anyway* button isn't there), clear the
download-quarantine flag yourself and then open the app normally:

```sh
xattr -dr com.apple.quarantine "/Applications/Claude Conduit.app"
```

Either way, the *first* launch can take **20–40 seconds** while macOS verifies the large
universal bundle. Later launches are fast.

### Windows — `Claude-Conduit-Setup-<version>.exe`

Installs per-user, so it needs no administrator rights. There's also a
`Claude-Conduit-<version>.exe` portable build that runs without installing anything.

1. Run the downloaded `.exe`.
2. SmartScreen shows *"Windows protected your PC"* with only a **Don't run** button.
   Click **More info** — the publisher line will say *Unknown publisher* — then
   **Run anyway**.
3. Follow the installer (it lets you change the install directory).

If Windows offers *"Keep"* / *"Keep anyway"* on the download itself in Edge or Chrome,
that's the same warning one step earlier — the file is unsigned, not damaged.

### Linux

Both x86-64 (`amd64`) and arm64 (`aarch64`) builds are published (since CCA-25) — pick
the pair matching your machine's `uname -m`. The arm64 artifacts carry an `-arm64` suffix
(`Claude-Conduit-<version>-arm64.AppImage`,
`claude-conduit_<version>_arm64.deb`); the x86-64 ones are unsuffixed, unchanged from
before.

**AppImage** — self-contained, no install:

```sh
chmod +x Claude-Conduit-<version>.AppImage        # or the -arm64 build on aarch64
./Claude-Conduit-<version>.AppImage
```

If that fails with `dlopen(): error loading libfuse.so.2`, your distro ships FUSE 3 only
(Ubuntu 22.04+, Debian 12+). Either install the compatibility library —
`sudo apt install libfuse2` (`libfuse2t64` on Ubuntu 24.04+) — or skip FUSE entirely:

```sh
./Claude-Conduit-<version>.AppImage --appimage-extract-and-run
```

**deb** — installs to `/opt` with a desktop entry. Use `apt`, not `dpkg -i`, so
dependencies resolve:

```sh
sudo apt install ./claude-conduit_<version>_amd64.deb   # or _arm64.deb on aarch64
```

No rpm is published; on Fedora/openSUSE use the AppImage.

The system tray is optional: if your desktop has no AppIndicator/StatusNotifier host
(support is inconsistent across Linux desktops), the app logs a warning and runs
perfectly well from its window alone.

### About the download size

Measured from a real `npm run dist` at 0.1.0:

| Artifact | Size |
|---|---|
| macOS `.dmg` (universal) | ~223 MB |
| macOS `.zip` (universal) | ~221 MB |
| Windows installer `.exe` | ~102 MB |
| Windows portable `.exe` | ~102 MB |
| Linux `.AppImage` (x64) | ~131 MB |
| Linux `.deb` (x64) | ~103 MB |
| Linux `.AppImage` (arm64) | ~131 MB |
| Linux `.deb` (arm64) | ~97 MB |

Most of that is the bundled Chromium/Node runtime, and the macOS build carries **two**
architectures. This is the accepted tradeoff for shipping something that runs with no
runtime installation step.

---

## Using it

**First launch** goes straight into the Setup wizard, and the other sections stay locked
until it completes:

1. **Prerequisites** — checks Node, Python, litellm, the litellm version, and whether the
   port is free. Offers to install litellm if it's missing.
2. **API key** — validated against NVIDIA for real, then stored with the OS keychain via
   Electron `safeStorage`. It is never written to the config directory.
3. **Models** — pick a primary and a small/fast model from your account's live catalog.
   Recommended models are flagged; anything else warns that tool-calling support is
   unverified until the final test.
4. **Generate & start** — writes the LiteLLM config, starts the proxy under pm2, waits for
   it to become healthy, and runs a quick three-check validation.
5. **Connect your clients** — hands off to the Claude Desktop and Claude Code CLI pages.

After setup:

- **Dashboard** — status pill, Start/Stop/Restart, a live log viewer (seeded with recent
  history, then streamed), and a Test Connection button.
- **Claude Desktop** — the automated apply/revert action **and** the manual instructions,
  always shown together, both filled in with your real port and master key.
- **Claude Code CLI** — one configure/remove toggle, plus a read-only list of exactly
  which `env` keys in `settings.json` get touched. Nothing else in that file is modified.
- **Diagnostics** — 10 checks against the running proxy, from liveness through tool
  calling, streaming, and a live `claude -p` smoke test.
- **Uninstall** — keep-or-purge, with an opt-in, separately-confirmed Claude Desktop
  revert.

The *Things to know* caveats live in **About** — the app menu on macOS, **Help → About**
on Windows and Linux — along with the version and a link to the repo.

### Closing vs. quitting

Closing the window **hides** it, and the proxy keeps running — that's deliberate, so the
manager can sit out of the way while Claude Desktop and Claude Code keep routing through
NIM.

**Quitting stops the proxy.** Quit from the sidebar's **Quit** button, the tray, **File →
Exit** (⌘Q on macOS), or the dock — every route behaves the same. Once it's stopped,
Claude Desktop and the Claude Code CLI have nothing to route to until you start the
manager again, so leave it running if you want the proxy up.

Only the `litellm-nim` app is stopped. The pm2 daemon itself is left alone, because it's
the shared one at `~/.pm2` and killing it would take down anything else you supervise
with pm2.

**Quitting mid-restart is deliberately not queued behind the Start/Stop/Restart lock
(CCA-31, CCA-34).** The window/tray Start, Stop, and Restart buttons share one lock so
clicking them in quick succession queues instead of racing. Quitting skips that lock on
purpose: a background restart can hold it for a minute or more, and making the quit-time
stop wait its turn would risk leaving a wedged pm2 in charge of whether the app can
close at all — the one outcome this app will not allow. The quit-time stop instead talks
to pm2 directly and relies on its own timeout: `shutdown.js` bounds the stop at 15 seconds,
so a wedged pm2 can't hold up the exit either way.

**A pm2 daemon process can keep running after you quit (CCA-24).** If no pm2 daemon
existed yet the first time this app needed one, it started one itself — and, like any pm2
daemon, that process is detached and outlives whatever started it by design. In practice
this means a background process can still be running after you quit, even after you
uninstall. This is not a bug in the sense of something gone wrong: it's the same shared,
persistent daemon model described under *Reboot persistence* below. One consequence is that
running `pm2 ls` yourself can show apps started by completely unrelated tools — even ones
you've never used alongside this manager — because they all share the same daemon. Three
things that follow from it:

- The daemon this app bootstraps runs as a private copy of this app's own runtime
  (there's no separate, lighter interpreter to hand it), so it is genuinely the same
  size as the app itself in Activity Monitor / Task Manager while it's running — not a
  small background helper.
- That copy lives outside this app's install location so a running daemon never has this
  app's own installed binary open. **Corrected characterization (verified live against a
  real packaged NSIS build):** a Windows/Linux *update* was never actually blocked by
  this — NSIS renames a locked, running binary aside and deletes it later, it doesn't fail
  outright. *Uninstalling* is the case that genuinely was (and, on a fresh install that was
  never subsequently updated, still can be) blocked: it deregisters the app and deletes
  every other file while silently leaving that locked, multi-hundred-MB binary behind,
  still running, with no way to discover it through the UI. Since CCA-24, the daemon's own
  copy of the interpreter means it's never *this app's own installed binary* left behind —
  only that daemon-owned copy under `~/.pm2/daemon-interpreter/` (see the table below),
  which is never cleaned up by uninstalling, no matter how many times you run it.
- That daemon-owned copy is never deleted by an uninstall — see the "Where things live"
  table below for its size and lifetime.

If you don't want any pm2 daemon running at all, stop it the same way you would for any
other pm2 daemon on your machine (e.g. `pm2 kill`) — but only run that yourself,
deliberately, once you know it's fine for everything else you supervise with pm2, since it
affects all of that too. This app can never make that judgment call on your behalf, which
is exactly why it never runs that command itself (see CLAUDE.md).

### Tray notifications on Start/Stop/Restart failures

Clicking **Start**, **Stop**, or **Restart** from the tray menu can fail two different
ways, and both now raise a native OS notification instead of failing silently
(CCA-55, extended by CCA-56):

- **A wedged/thrown call** — the underlying pm2 operation times out or otherwise rejects
  (see DESIGN.md §7.4 for the pm2 timeout codes this can surface).
- **A resolved `{ok:false}` result** — the more common case in practice. Clicking tray
  **Start** on a freshly installed, unconfigured app resolves `NOT_CONFIGURED` ("Run setup
  first."); a start that begins but never reports healthy resolves `HEALTH_CHECK_TIMEOUT`.

Both paths always log to the console, and — when the OS notification API is available
(`Notification.isSupported()`) — also show a toast titled "Claude Conduit" with the
failure's message (falling back to its error code, then a fixed string, if no message is
present).

**Tray Start stays enabled even with no manifest**, unlike the dashboard's own Start
button (`#start-btn`), which is disabled whenever setup hasn't been completed
(`disabled = status === 'running' || !manifest`). This is a deliberate trade-off, not an
oversight: the tray's status callback only ever carries `{status, pid?, uptime?,
restarts?}`, with nothing about manifest presence, and threading that through was ruled
out of scope when this was decided. So tray Start stays enabled whenever status isn't
`running`, and clicking it on an unconfigured install round-trips through the same handler
as any other click, surfacing the `NOT_CONFIGURED` notification above — visibly wrong
instead of silently inert.

**Known platform caveats (CCA-57):**

- **Windows** — the app's AppUserModelID now matches the Start Menu shortcut the NSIS
  installer creates, so a `nsis` install's notifications are correctly attributed on the
  AUMID half. There is a second half electron-builder leaves open on **both** Windows
  targets: Electron pairs that AUMID with a ToastActivatorCLSID, and electron-builder
  writes none for `nsis` or `portable` (`electron-builder.yml`'s CCA-57 comment: a
  `ToastActivator`/`CLSID` grep over `node_modules/app-builder-lib/templates/nsis/` returns
  zero hits). This app's toasts are plain informational notifications that never register
  an activation handler, so the gap isn't exercised today — but it isn't closed either, and
  CCA-61 is open to decide it. Separately, and specific to **portable**: that build
  installs no Start Menu shortcut at all, so even the AUMID half has nothing to be paired
  with.
- **macOS** — builds are ad-hoc signed, not signed with a full Apple Developer ID; whether
  that's enough for notifications to fire at all is not yet verified either way.
  Notification permission and Do Not Disturb state also aren't checked before a
  notification is shown.
- **Linux** — verified live: a wedged action's notification reaches the desktop's
  notification service (confirmed via a `dbus-monitor` capture against GNOME).
- On every platform, the console log trail fires regardless of whether the OS actually
  displays a notification, so a wedged or failed action is never completely silent even
  where the toast itself is suppressed or unsupported.

### Where things live

| Path | What |
|---|---|
| `~/.config/claude-conduit/` (macOS/Linux), `%APPDATA%\claude-conduit\` (Windows) | config.yaml, litellm.env, ecosystem.config.cjs, manifest.json, logs/ |
| `~/.claude/settings.json` | Claude Code CLI env keys (only the documented ones) |
| Claude Desktop's `Claude-3p/configLibrary/` | A dedicated "Claude Conduit" entry, created only with your explicit consent, and only after a full backup |
| `~/.pm2/daemon-interpreter/` (win32/linux only) | A private copy of this app's own runtime, created the first time this app bootstraps a pm2 daemon (CCA-24). ~227 MiB (the executable plus `icudtl.dat`/`snapshot_blob.bin`/`v8_context_snapshot.bin`/`libffmpeg.so` on Linux), measured live. Survives quitting *and* uninstalling this app — nothing removes it, because the daemon that may still be using it outlives this app's own lifecycle (see `src/engine/uninstall.js`'s comment on why cleaning it up from there isn't safe). |
| Electron's userData directory (`nim-key.enc`) | Your NVIDIA API key, encrypted at rest by the OS (`secretStore.js`; see "Upgrading from NIM Proxy Manager" below for how this file itself migrates). **Survives this app's own Uninstall flow, including Purge** — `src/engine/uninstall.js`'s delete set is the settings-file keys, the `litellm-nim` pm2 app (not guaranteed either, if that same pm2 call is the one that times out), and, only when Purge is selected **and the uninstall completes successfully**, the `~/.config/claude-conduit/` (macOS/Linux) / `%APPDATA%\claude-conduit\` (Windows) config directory — a pm2 call timing out (CCA-48) makes the whole uninstall fail before that directory delete is ever reached, so a Purge that fails there leaves the config directory (and everything in it) exactly as it was, same as an unselected Purge; it never calls `secretStore.clear()` — that function's only caller anywhere in the app is the `apiKey.clear` IPC handler, and no shipped UI currently invokes it, so nothing in the app deletes `nim-key.enc`. A successful Purge deletes `litellm.env`'s *derived* copy of the key, not this original; see "Uninstalling" below for how to remove the original by hand. |

The generated proxy master key lives in `litellm.env`, never in `manifest.json`.

---

## Things to know

These are surfaced in the app too, and they matter:

- **Not "free Claude"** — responses come from the chosen NIM model; agentic-coding quality
  differs from Claude models.
- **Rate limits** — the hosted NIM free tier is roughly 40 requests/min plus limited credits.
- **No prompt caching** — long sessions re-pay full input tokens every turn.
- **Context windows** — many NIM models cap at ≤128k; large repos can exceed that.
- **Reboot persistence** — pm2 apps survive a daemon restart once saved, but surviving a
  *reboot* needs `pm2 startup`, which prints a `sudo` command. **You** run that command;
  this app never runs `sudo` for you.
- **Supply chain** — litellm 1.82.7/1.82.8 shipped malware on PyPI. This app blocks them.

### Claude Desktop support is best-effort

Anthropic documents Claude Desktop's local third-party gateway config as written only by
Desktop's own UI. The automated apply is therefore **unsupported and best-effort**: it
takes a full backup first, only ever creates or edits a dedicated "Claude Conduit"
entry, and never touches your other configurations. The manual instructions are always
shown right next to it, so you never depend on the automation. You must fully quit
(⌘Q) and reopen Claude Desktop for a change to take effect.

If Desktop has never created its config store, the app will tell you to open
Developer → *Configure Third-Party Inference…* once first — it will not fabricate that
directory itself.

---

## Upgrading from NIM Proxy Manager

This app was previously named **NIM Proxy Manager** (repository `nvidia-cowork`). CCA-12
renamed it to **Claude Conduit**. Everything visible — window title, menu bar, tray, About,
installer, desktop entry — updates automatically the moment you run the new build. Here is
what happens to everything else, and what (if anything) you need to do:

| Persisted state | Decision | What you'll see |
|---|---|---|
| Config directory (`~/.config/claude-nim-proxy` → `claude-conduit`) | **Migrates automatically**, no action needed | The first launch after upgrading moves the whole directory — config.yaml, litellm.env (your proxy master key), manifest.json, logs — to its new name, and repairs the absolute paths baked into the generated launcher files. Your proxy configuration and port survive untouched. |
| pm2 app name (`litellm-nim`) | **Left as-is**, no action needed | Still `litellm-nim` in `pm2 status`/`pm2 logs`. It's an internal identifier tied to the underlying litellm+NIM proxy, not the product name, and CCA-14 (multi-provider support) is a more natural point to revisit it — changing it once there beats changing it twice. Your running proxy process is unaffected either way. |
| Encrypted NVIDIA API key (Electron's userData directory) | **Best-effort copy**, may need one re-entry | Electron stores this file under a directory named after the app, so the rename moves it too. The app copies the encrypted blob forward automatically. On **Windows** this reliably still decrypts (the OS keys it to your user account, not the app). On **macOS** it is expected to **not** decrypt — the OS Keychain entry backing it is scoped to the app's name, which just changed — so **the Setup wizard will most likely ask you to re-enter your NVIDIA key once** after upgrading. This is safe and expected, never a crash: a failed decrypt is always treated as "no key stored yet." |
| Claude Desktop's third-party inference entry | **Renamed in place, next time you click Apply** | The entry this app created is normally tracked by its own internal id (recorded in `manifest.json`), so upgrading reuses it rather than creating a duplicate. If that id record is missing — e.g. `manifest.json` was lost to a purge-uninstall — Apply falls back to looking the entry up by its old name instead of creating a second one. Its *label* inside Claude Desktop's picker still reads "NIM Proxy Manager" until you next use this app's **Apply Gateway Config** button (Claude Desktop page) — at that point, as part of that same already-consented write, it's relabelled to "Claude Conduit". Purely cosmetic either way; the gateway keeps working regardless. |

You do need to **download and install the new build** — there is no auto-update yet
(that's CCA-10, sequenced after this rename on purpose). Uninstalling the old build first
is not required; installing the new one over it is fine.

---

## Building from source

```sh
npm install
npm test              # 485 tests (one live NVIDIA API check unless CI is set)
npm run dev           # run from source
npm run icons         # regenerate icons from build/icon.svg
```

Packaging (electron-builder; config in `electron-builder.yml`):

```sh
npm run pack          # unpacked app dir only, fastest way to sanity-check
npm run dist:mac      # dmg + zip (universal)
npm run dist:win      # NSIS installer + portable exe
npm run dist:linux    # AppImage + deb, both x64 and arm64
npm run dist:linux:x64    # AppImage + deb, x64 only
npm run dist:linux:arm64  # AppImage + deb, arm64 only
npm run dist          # all three platforms (Linux: both arches)
```

Artifacts land in `dist/`, alongside the `latest*.yml` update metadata electron-builder
emits once it can resolve a publish target — which `package.json`'s `repository` field now
pins down without depending on the checkout's `.git` layout (a future auto-updater reads
those, so don't rename artifacts when uploading a release — see
[docs/distribution.md](docs/distribution.md) for the full release checklist).

macOS builds are **ad-hoc signed** (`identity: "-"`): a fully
unsigned binary won't launch at all on Apple Silicon, and the hardened runtime then needs
the `disable-library-validation` entitlement in `build/entitlements.mac.plist` or Electron's
own dylibs get rejected. There is no notarization, so `spctl` rejects the app until the
user clears quarantine. Windows builds really are unsigned — electron-builder logs
`signing with signtool.exe` even with no certificate configured, but the emitted `.exe`
files carry an empty PE certificate table. Cross-building all three targets from macOS
works; electron-builder downloads the toolchains it needs.

### Safe manual testing

Passing `NIM_PROXY_TEST_HOME` **together with `--dev`** redirects every path the app
touches — its config directory, `~/.claude`, Claude Desktop's `configLibrary`, and the
encrypted-key file — under a throwaway home, so you can click every destructive button
without touching your real configuration or your real NVIDIA key:

```sh
NIM_PROXY_TEST_HOME=/tmp/fake-home ./node_modules/.bin/electron . --dev
```

The override is ignored unless `--dev` is present, so it can never engage in a real
end-user launch of a packaged build. It does *not* redirect Electron's own internal
userData (Chromium's session/cache) — that's disposable housekeeping Electron itself
creates under the real per-OS app-data location on every launch, never anything this app
writes.

---

## Uninstalling

Use the app's **Uninstall** page. It stops and removes the pm2 app, removes the Claude Code
CLI env keys it added, and lets you either keep or purge the config directory. Reverting
Claude Desktop is a separate, individually confirmed opt-in — it's never a side effect.

**An uninstall can fail partway through.** Its pm2 calls are bounded (CCA-48) so a wedged
pm2 daemon makes it fail observably instead of hanging — the Uninstall page shows the raw
error (e.g. "pm2 list timed out after 15000ms") with no further explanation. If a **Purge**
reports a pm2-related error (the kind these bounded calls actually produce), it has **not**
purged: the config directory, including `litellm.env`'s plaintext copy of your key, is left
exactly as it was, since that error always surfaces before the directory delete is ever
attempted. Retrying once pm2 is healthy again is safe.

**Purge does not remove your saved NVIDIA API key.** It lives encrypted, outside the
config directory entirely, in `nim-key.enc` under Electron's userData directory (see
"Where things live" above) — Purge only deletes `litellm.env`'s derived copy. There is
currently no in-app way to remove the saved key itself. If you specifically want it gone
too, delete `nim-key.enc` by hand: `~/Library/Application Support/Claude Conduit/` on
macOS, `~/.config/Claude Conduit/` on Linux, `%APPDATA%\Claude Conduit\` on Windows. The
app treats a missing key file exactly like one that was never set (`secretStore.js`'s
`load()`), so it will simply prompt you to re-enter the key next time it's needed.

---

## Licensing

**Claude Conduit is licensed under the [GNU AGPL-3.0-or-later](LICENSE).**

That is not an arbitrary choice. The app bundles [pm2](https://github.com/Unitech/pm2),
which is **AGPL-3.0**, and drives it through its programmatic API rather than as a
subprocess — so the combined work is AGPL. If you fork this, the same applies to you.

Every third-party notice ships with the app: **Help → Licenses** lists all bundled
packages with their license identifiers and full texts. That list is generated from the
real dependency tree, not hand-maintained:

```sh
npm run licenses   # regenerates src/assets/licenses.json — re-run after any dependency change
```

Two things the Licenses view is careful to state accurately:

- **LiteLLM is not bundled.** The app installs it into *your* Python environment during
  setup, so the exact set of Python packages and their licenses lives on your machine.
- **`litellm-enterprise` is not open source.** It ships alongside `litellm` under a
  proprietary license. This app doesn't use its enterprise features, but pip installs it
  regardless.
