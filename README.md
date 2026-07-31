# NIM Proxy Manager

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

### Where this is heading

Three changes are agreed and in the backlog, and they will affect anyone building on this
now:

- **The product is being renamed to Claude Conduit**, and this repository to
  `claude-conduit`.
- **NVIDIA NIM is becoming one provider among several**, alongside OpenRouter and any
  OpenAI-compatible custom/local endpoint — so the NIM-specific framing throughout this
  README is temporary.
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

Builds are **unsigned** — there's no paid Apple Developer ID or Windows code-signing
certificate behind them. Both operating systems will therefore warn you on first launch.
The one-time workarounds are below.

### macOS — `NIM Proxy Manager-<version>-universal.dmg`

Universal build; runs natively on both Apple Silicon and Intel.

1. Open the `.dmg` and drag the app to **Applications**.
2. **Right-click** (or Control-click) the app → **Open** → **Open** in the dialog.
   Double-clicking will *not* work the first time — macOS only offers the "open anyway"
   path from the right-click menu.

If macOS still refuses ("damaged and can't be opened" — which really means "quarantined
and unsigned"), clear the quarantine flag:

```sh
xattr -dr com.apple.quarantine "/Applications/NIM Proxy Manager.app"
```

After that it opens normally forever. The first launch can take **20–40 seconds** while
macOS verifies the (large) bundle; subsequent launches are fast.

### Windows — `NIM Proxy Manager Setup <version>.exe`

Installs per-user, so it needs no administrator rights. There's also a
`NIM Proxy Manager <version>.exe` portable build that runs without installing.

SmartScreen will show *"Windows protected your PC"*. Click **More info** →
**Run anyway**.

### Linux

- **AppImage** — `chmod +x 'NIM Proxy Manager-<version>.AppImage'` then run it.
- **deb** — `sudo dpkg -i nim-proxy-manager_<version>_amd64.deb`

The system tray is optional: if your desktop has no AppIndicator/StatusNotifier host
(support is inconsistent across Linux desktops), the app logs a warning and runs
perfectly well from its window alone.

### About the download size

| Artifact | Size |
|---|---|
| macOS `.dmg` / `.zip` (universal) | ~224 MB |
| Windows installer / portable `.exe` | ~97 MB |
| Linux `.AppImage` | ~128 MB |
| Linux `.deb` | ~98 MB |

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

### Where things live

| Path | What |
|---|---|
| `~/.config/claude-nim-proxy/` (macOS/Linux), `%APPDATA%\claude-nim-proxy\` (Windows) | config.yaml, litellm.env, ecosystem.config.cjs, manifest.json, logs/ |
| `~/.claude/settings.json` | Claude Code CLI env keys (only the documented ones) |
| Claude Desktop's `Claude-3p/configLibrary/` | A dedicated "NIM Proxy Manager" entry, created only with your explicit consent, and only after a full backup |

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
takes a full backup first, only ever creates or edits a dedicated "NIM Proxy Manager"
entry, and never touches your other configurations. The manual instructions are always
shown right next to it, so you never depend on the automation. You must fully quit
(⌘Q) and reopen Claude Desktop for a change to take effect.

If Desktop has never created its config store, the app will tell you to open
Developer → *Configure Third-Party Inference…* once first — it will not fabricate that
directory itself.

---

## Building from source

```sh
npm install
npm test              # 101 tests, no network or real config touched
npm run dev           # run from source
npm run icons         # regenerate icons from build/icon.svg
```

Packaging (electron-builder; config in `electron-builder.yml`):

```sh
npm run pack          # unpacked app dir only, fastest way to sanity-check
npm run dist:mac      # dmg + zip (universal)
npm run dist:win      # NSIS installer + portable exe
npm run dist:linux    # AppImage + deb
npm run dist          # all three
```

Artifacts land in `dist/`. macOS builds are **ad-hoc signed** (`identity: "-"`): a fully
unsigned binary won't launch at all on Apple Silicon, and the hardened runtime then needs
the `disable-library-validation` entitlement in `build/entitlements.mac.plist` or Electron's
own dylibs get rejected. Windows and Linux builds are unsigned. Cross-building all three
targets from macOS works; electron-builder downloads the toolchains it needs.

### Safe manual testing

Passing `NIM_PROXY_TEST_HOME` **together with `--dev`** redirects every path the app
touches — its config directory, `~/.claude`, and Claude Desktop's `configLibrary` — under a
throwaway home, so you can click every destructive button without touching your real
configuration:

```sh
NIM_PROXY_TEST_HOME=/tmp/fake-home ./node_modules/.bin/electron . --dev
```

The override is ignored unless `--dev` is present, so it can never engage in a packaged build.

---

## Uninstalling

Use the app's **Uninstall** page. It stops and removes the pm2 app, removes the Claude Code
CLI env keys it added, and lets you either keep or purge the config directory. Reverting
Claude Desktop is a separate, individually confirmed opt-in — it's never a side effect.

---

## Licensing

**NIM Proxy Manager is licensed under the [GNU AGPL-3.0-or-later](LICENSE).**

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
