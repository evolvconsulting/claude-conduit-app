# Spec: `claude-conduit` — Route Claude Desktop (Cowork) & Claude Code through LiteLLM → NVIDIA NIM

> **⚠️ This is the v1 spec, not the current source of truth.** It described the app as
> originally built and shipped. Decisions made since then live in Backlog tasks (NCOW-2
> onward) and **override this document where they conflict**; sections corrected that way
> are marked with the task ID (see §7.4). **NCOW-12 has landed**: the product is now
> **Claude Conduit** and the repository is `claude-conduit` — every `claude-nim-proxy` /
> "NIM Proxy Manager" reference below has been updated to match (the hypothetical CLI
> wizard this spec describes was never built; see §2/§11 for what that means for this
> document). **NCOW-14** is still pending and will invalidate the sections below that
> assume NVIDIA NIM is the only possible upstream. Check the backlog before treating
> anything below as current.

**Status:** Implementation-ready specification
**Audience:** Implementing engineer (or engineering agent). Every load-bearing external fact was
verified against primary sources on 2026-07-16; source URLs in §14. No further research required.
**Target platform:** macOS (Darwin) primary; Linux works with the same flow (§10 notes)
**Date:** 2026-07-17 (supersedes 2026-07-16 draft: process manager is now **pm2**, model choice is
now **interactive from the live NIM catalog**, and the tool is a **user-run setup wizard** rather
than a system installer)

---

## 1. Product summary

A single-file CLI wizard that a user runs once. It:

1. Checks prerequisites: **pm2 installed globally** and **litellm on PATH** (with a safe version).
2. Prompts for their **NVIDIA API key** (masked input).
3. **Enumerates the live model catalog** from the NVIDIA NIM API and lets them **pick** a primary
   model and a small/fast model.
4. Generates all configuration (LiteLLM config, secrets env file, launcher script, pm2 ecosystem
   file, gateway master key).
5. Starts the proxy under **pm2** via the launcher script and persists it (`pm2 save`).
6. Prints (and saves) **step-by-step Claude Desktop instructions** — Desktop's third-party
   inference form cannot be written by a script (verified, §5.3), so this part is guided-manual.
7. Optionally configures the **Claude Code CLI** automatically (settings.json env merge).
8. Ships a **test mode** (`test` subcommand, also auto-run at the end of setup) that validates the
   whole chain end to end: proxy → LiteLLM translation → NIM → tool calling → streaming.

### Architecture

```
┌─────────────────────────────┐   Anthropic Messages API          ┌──────────────────────┐
│ Claude Code CLI             │   POST /v1/messages (streaming)   │ LiteLLM proxy        │
│   env: ANTHROPIC_BASE_URL   │ ────────────────────────────────▶ │ 127.0.0.1:4000       │
│ Claude Desktop / Cowork     │   GET  /v1/models                 │ (pm2 app             │
│   3P: inferenceGatewayBaseUrl│                                  │  "litellm-nim")      │
└─────────────────────────────┘                                   └──────────┬───────────┘
                                                                             │ OpenAI-compatible
                                                                             │ /v1/chat/completions
                                                                             ▼
                                                          ┌──────────────────────────────────┐
                                                          │ NVIDIA NIM                       │
                                                          │ hosted: integrate.api.nvidia.com │
                                                          │ or self-hosted NIM container     │
                                                          └──────────────────────────────────┘
```

**Verified load-bearing facts:**

1. LiteLLM's `/v1/messages` endpoint speaks the *Anthropic* wire format and works with **all**
   LiteLLM providers, including `nvidia_nim/*`. This is what lets Claude clients talk to NIM.
2. Claude Code's documented gateway mechanism is `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`.
3. Claude Desktop has an official third-party inference gateway mode (the docs name LiteLLM as a
   supported gateway). Requirements: `POST /v1/messages` with streaming + tool use; `GET
   /v1/models` optional. Local Cowork sessions route through it; **cloud-hosted Cowork
   (claude.ai/mobile) cannot be redirected**.
4. Desktop ignores `ANTHROPIC_BASE_URL`/`settings.json` for routing; only its 3P config counts,
   and the locally-entered form values are stored in a location scripts must not write
   (`~/Library/Application Support/Claude-3p/configLibrary/`, written by the app UI only).

---

## 2. Implementation language & deliverables

**Language: Node.js ≥ 18, single file, zero npm dependencies.**
Rationale: pm2 is a hard prerequisite, so Node is guaranteed present; Node 18+ has built-in
`fetch` (NIM catalog enumeration, health checks), `readline/promises` (interactive prompts),
`crypto` (key generation), and native JSON (the delicate `settings.json` merge). A Python
implementation was considered and rejected: it adds a second runtime requirement and version
ambiguity (pyenv/system splits) for zero benefit.

Repository layout:

| Path | Purpose |
|---|---|
| `claude-conduit.mjs` | The entire CLI (wizard + subcommands). ESM, `#!/usr/bin/env node`. |
| `README.md` | Install one-liner, prerequisites, gotchas (§12), troubleshooting, uninstall. |
| `package.json` | `"bin": {"claude-conduit": "./claude-conduit.mjs"}`, `"engines": {"node": ">=18"}`, no deps. Publishing to npm optional; `node claude-conduit.mjs` must always work standalone. |

Generated at runtime under `~/.config/claude-conduit/` (created `0700`):

| File | Mode | Purpose |
|---|---|---|
| `config.yaml` | 0644 | LiteLLM proxy config (§6.1). |
| `litellm.env` | **0600** | `NVIDIA_NIM_API_KEY`, `LITELLM_MASTER_KEY`. The only place secrets live. |
| `run.sh` | 0700 | Launcher: sources `litellm.env`, execs litellm (§6.2). |
| `ecosystem.config.cjs` | 0644 | pm2 app definition pointing at `run.sh` (§7). No secrets. |
| `manifest.json` | 0644 | Everything the tool changed, for `uninstall`/`status` (§9.3). |
| `DESKTOP-SETUP.md` | 0644 | The printed Claude Desktop instructions, saved for later reference (§8). |

---

## 3. CLI reference

```
claude-conduit [setup]            # default subcommand: the interactive wizard
    --nim-api-key <key>             # skip the key prompt
    --model <id>                    # skip primary-model picker
    --small-model <id>              # skip small-model picker
    --port <n>                      # default 4000
    --nim-base-url <url>            # self-hosted NIM (default https://integrate.api.nvidia.com/v1)
    --configure-cli | --no-cli      # skip the "configure Claude Code?" prompt (yes/no)
    --yes                           # accept all defaults; with --nim-api-key => fully non-interactive
claude-conduit test               # end-to-end validation (§11); exit 0 = all pass
claude-conduit status             # what's installed/running/configured (§9.2)
claude-conduit restart            # pm2 restart litellm-nim (after manual config edits)
claude-conduit uninstall [--purge]
```

**Exit codes (all subcommands):** `0` success · `1` unexpected failure · `2` prerequisite missing ·
`3` user aborted a prompt · `4` one or more test-mode checks failed.

---

## 4. Setup wizard, step by step

The wizard is a linear sequence; each step prints a one-line ✅/❌ status. On ❌ it prints the fix
and exits with code 2 (prereqs) or 1. Steps:

### Step 1 — prerequisite checks

| Check | Command | On failure, print |
|---|---|---|
| Node ≥ 18 | `process.versions.node` | (can't happen if running, but guard for 16) |
| pm2 global | `pm2 --version` exit 0 | `npm install -g pm2` |
| pm2 daemon usable | `pm2 jlist` exit 0, parseable JSON | `pm2 kill && pm2 ls` to reset a wedged daemon |
| litellm on PATH | `litellm --version` exit 0 | Install command below |
| litellm version safe | parse version from output | See below |
| Port free | attempt `net.createServer().listen(port, '127.0.0.1')` | `--port <other>` or find the holder: `lsof -i :4000` |

litellm install guidance (printed verbatim on failure — pick the first tool present on PATH):

```
uv tool install 'litellm[proxy]==<PINNED>'      # preferred
pipx install 'litellm[proxy]==<PINNED>'
pip install --user 'litellm[proxy]==<PINNED>'
```

`<PINNED>` is a constant in the script — the engineer sets it to the latest stable at build time
(must be ≥ 1.83). **Security requirement, not a nicety:** LiteLLM **1.82.8** on PyPI contained
credential-stealing malware (`litellm_init.pth`, executed on every Python interpreter start,
exfiltrating env vars / SSH keys / cloud credentials). If the detected installed version is 1.82.7
or 1.82.8, print a prominent warning to uninstall immediately and rotate all credentials, and
refuse to proceed. If the installed version is older than the pin, warn but continue.

### Step 2 — NVIDIA API key

Order: `--nim-api-key` flag → `NVIDIA_NIM_API_KEY` env var → interactive masked prompt
(readline with echo suppressed; never print the key back, in logs show `nvapi-…last4`).
If the key doesn't start with `nvapi-`, warn but accept (self-hosted NIMs may issue other
schemes). Where to get one (print): https://build.nvidia.com → any model → Get API Key.

**Immediately validate** by calling `GET {nim_base}/models` with `Authorization: Bearer <key>`
(10 s timeout). 401/403 → "NVIDIA rejected the key" and re-prompt (max 3 attempts, then exit 2).
Network error → name the failing host and exit 2. Success → keep the parsed model list for Step 3.

### Step 3 — model selection (interactive)

Data: the `data[].id` values from Step 2's `/v1/models` response (typically 100+ IDs like
`meta/llama-3.3-70b-instruct`). The endpoint does **not** expose whether a model supports
function calling, so the wizard combines a curated shortlist with free search, and the test mode
(§11) is the authoritative check.

Curated shortlist — a constant `RECOMMENDED_PRIMARY` in the script, shown **only if present in
the live list** (intersect; never show a model the account can't call):

```js
const RECOMMENDED_PRIMARY = [   // strong tool-calling / agentic-coding models, mid-2026
  'qwen/qwen3-coder-480b-a35b-instruct',   // default
  'moonshotai/kimi-k2-instruct',
  'deepseek-ai/deepseek-v3.1',
  'meta/llama-3.3-70b-instruct',
];
const RECOMMENDED_SMALL = [
  'meta/llama-3.1-8b-instruct',            // default
  'qwen/qwen2.5-7b-instruct',
];
```
(Engineer: refresh these constants against build.nvidia.com at build time; runtime intersection
makes stale entries harmless.)

Prompt UX (plain readline, no TUI deps), run twice — once for the primary model, once for the
small/fast model:

```
Select the PRIMARY model (handles coding/agentic traffic — must support tool calling):

  Recommended:
    1) qwen/qwen3-coder-480b-a35b-instruct   [default]
    2) moonshotai/kimi-k2-instruct
    3) deepseek-ai/deepseek-v3.1
    4) meta/llama-3.3-70b-instruct

  Or: type part of a name to search all 127 available models, or 'list' to page through them.

Choice [1]:
```

- Number → pick from the shortlist. Empty → default.
- Any other text → case-insensitive substring filter over the full list; show matches numbered
  (≤ 20 per page, `more` to page); user picks a number or refines the search.
- Picking a model not on the curated list prints:
  `⚠ Tool-calling support unverified for this model — the final test will check it.`
- `--model`/`--small-model` flags skip prompts but are still validated against the live list
  (absent → error listing near-matches, exit 1).

### Step 4 — generate configuration

Write all files from §2's table. Master key: reuse the existing one from `litellm.env` if present
(idempotent re-runs don't invalidate already-configured clients); else
`'sk-litellm-' + crypto.randomBytes(24).toString('hex')`.

### Step 5 — start under pm2

Per §7. Ends with the proxy answering `GET /health/liveliness`.

### Step 6 — client configuration

1. **Claude Desktop (always):** print + save the instruction block (§8).
2. **Claude Code CLI (optional):** prompt `Also configure the Claude Code CLI to use this proxy?
   [y/N]` (`--configure-cli`/`--no-cli` skip the prompt). If yes → settings merge per §9.1.

### Step 7 — auto-run test mode

Run every §11 check. Print the summary table. Setup exits 0 only if all critical checks pass
(4 if not, leaving everything installed for debugging — the failure output names the broken layer).

---

## 5. Client configuration surfaces (verified facts the flow rests on)

### 5.1 Claude Code CLI — scriptable

Env vars in a settings file; settings-file values override shell exports; a gateway credential
takes precedence over a saved claude.ai login (login stays saved and unused; after uninstall the
login resumes, `/login` if prompted). Remote Control and voice dictation are unavailable while a
gateway credential / non-Anthropic base URL is active (Claude Code ≥ 2.1.196).

### 5.2 Claude Desktop + local Cowork — official 3P gateway mode, guided-manual

`inferenceProvider: "gateway"` activates it. Auto-discovery of models from the gateway's
`/v1/models` shows only "recognizably Claude" IDs — our aliases aren't, so `inferenceModels` must
be set explicitly in the form. Config is read **once at app launch** → user must fully quit and
reopen. While a gateway is active: desktop sessions run locally only (local Cowork VM works; no
Anthropic-hosted cloud environments, no SSH picker, no Remote Control). MCP tool search and other
experimental betas are disabled by default on 3P — correct for this proxy; don't enable
`toolSearchEnabled`.

### 5.3 Why Desktop is instructions, not automation

Local 3P config lives in `~/Library/Application Support/Claude-3p/configLibrary/` (`_meta.json` +
`<id>.json`), documented as written by the in-app form; direct file writes are not a supported
path. The alternative supported write path is MDM (`com.anthropic.claudefordesktop` managed
preferences) — inappropriate to install from a user wizard. Therefore: the wizard prints exact
values for the in-app form. `status` MAY read (never write) `configLibrary/` and
`defaults read com.anthropic.claudefordesktop` to report whether desktop routing appears active.

---

## 6. Generated LiteLLM artifacts

### 6.1 `config.yaml`

> **NCOW-8:** `model_name` values below were renamed from their original provider-neutral
> aliases to `claude-sonnet-4-5`/`claude-haiku-4-5`, because clients validate/expect
> Anthropic-shaped model IDs and rejected the original aliases as invalid model
> identifiers. The underlying upstream model is unaffected — only the client-facing
> `model_name` changed.

```yaml
model_list:
  # Stable, client-facing IDs shaped like real Anthropic model names — clients
  # validate/expect this format. Re-running setup to swap the underlying NIM
  # model never requires touching client config.
  - model_name: claude-sonnet-4-5    # primary — what Desktop's default + ANTHROPIC_MODEL point at
    litellm_params:
      model: nvidia_nim/{{PRIMARY_MODEL_ID}}
      api_key: os.environ/NVIDIA_NIM_API_KEY
      # api_base: {{NIM_BASE_URL}}   # emitted only when --nim-base-url was given

  - model_name: claude-haiku-4-5     # background/haiku-class traffic
    litellm_params:
      model: nvidia_nim/{{SMALL_MODEL_ID}}
      api_key: os.environ/NVIDIA_NIM_API_KEY

  # Safety net: Claude clients sometimes request concrete Anthropic IDs
  # (claude-sonnet-4-6, claude-haiku-…, claude-opus-…) regardless of overrides.
  # Route them to the primary model so they don't 400.
  - model_name: "claude-*"
    litellm_params:
      model: nvidia_nim/{{PRIMARY_MODEL_ID}}
      api_key: os.environ/NVIDIA_NIM_API_KEY

litellm_settings:
  drop_params: true        # drop Anthropic-only params NIM rejects (cache_control, thinking, metadata…)
  num_retries: 2
  request_timeout: 600

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
```

`drop_params: true` is mandatory: Claude clients send Anthropic-specific fields with no NIM
equivalent. LiteLLM also serves `GET /v1/models` from `model_list` — used by test mode and
available for Claude Code's optional gateway model discovery.

### 6.2 `run.sh` (the launcher pm2 runs)

```bash
#!/bin/bash
set -euo pipefail
set -a; source "$HOME/.config/claude-conduit/litellm.env"; set +a
exec litellm \
  --config "$HOME/.config/claude-conduit/config.yaml" \
  --host 127.0.0.1 \
  --port {{PORT}}
```

- `exec` so pm2 supervises litellm itself, not a lingering bash parent.
- **`--host 127.0.0.1` always.** Never `0.0.0.0`: this proxy fronts a paid API key behind a
  static master key on a personal machine.
- Secrets enter only via the sourced `0600` env file — they appear in no pm2 file, no plist, no
  process argv.
- If `litellm` was installed via `uv tool`/`pipx`, PATH inside pm2's daemon may differ from the
  user's shell. Setup must resolve the absolute litellm path at generation time
  (`command -v litellm` equivalent from the wizard's own environment) and template it into
  `run.sh` instead of the bare name.

---

## 7. pm2 lifecycle

### 7.1 `ecosystem.config.cjs`

```js
module.exports = {
  apps: [{
    name: 'litellm-nim',
    script: '/Users/<user>/.config/claude-conduit/run.sh',
    interpreter: 'bash',
    autorestart: true,
    max_restarts: 10,
    restart_delay: 3000,
    kill_timeout: 10000,
    out_file: '/Users/<user>/.config/claude-conduit/logs/out.log',
    error_file: '/Users/<user>/.config/claude-conduit/logs/err.log',
    time: true,                     // timestamps in logs
  }],
};
```

(Absolute paths templated in; create `logs/` at setup.)

### 7.2 Start sequence (wizard Step 5)

1. If an app named `litellm-nim` already exists in `pm2 jlist` → `pm2 delete litellm-nim` first
   (idempotent re-setup).
2. `pm2 start ~/.config/claude-conduit/ecosystem.config.cjs`
3. Poll `GET http://127.0.0.1:<port>/health/liveliness` every 2 s, up to 60 s. LiteLLM cold start
   is slow (schema build); print a spinner/dots. Timeout → print
   `pm2 logs litellm-nim --lines 50 --nostream` output and exit 1.
4. `pm2 save` — persists the app list so a pm2 daemon restart resurrects it.
5. Boot persistence (optional, print-only): tell the user that surviving a **reboot** needs
   `pm2 startup` and to run the sudo command it prints. The wizard must **never run sudo itself**.

### 7.3 Operations (README + `status` output)

`pm2 status litellm-nim` · `pm2 logs litellm-nim` · `pm2 restart litellm-nim` (after any manual
edit of `config.yaml`) · `pm2 stop litellm-nim`. The `restart` subcommand is a thin wrapper.

#### 7.4 Proxy lifetime relative to the GUI (NCOW-4)

Closing the manager's window **hides** it and leaves the proxy running, so Claude Desktop
and Claude Code keep working while the manager is out of the way.

**Quitting stops the proxy.** Every exit route — the sidebar Quit button, the tray entry,
File → Exit / ⌘Q, the macOS dock's Quit, and a logout — funnels through the single
`before-quit` handler, which stops `litellm-nim` before the process exits. This is
unconditional; there is no preference to opt out of it. The consequence is intended and
must stay documented in the UI: once the manager is quit, Claude Desktop and the Claude
Code CLI have no proxy to route to until it is started again.

The pm2 **daemon** is never killed. It runs against the shared default `PM2_HOME`
(`~/.pm2`), so killing it would stop unrelated apps the user supervises with pm2. Only the
`litellm-nim` app is stopped, and the stop is bounded by a timeout so a wedged pm2 cannot
make the app unquittable.

**The daemon itself can still be running after quit — corrected by NCOW-24.** If
`ensureConnected()` (`pm2Control.js`) had to bootstrap a pm2 daemon itself (`spawnDaemon()`,
NCOW-22), that daemon is detached and long-lived by pm2's own design, independent of this
app's `before-quit` handling above — stopping `litellm-nim` does not, and should not, stop
the supervisor that (potentially) also supervises other things. NCOW-22 originally spawned
that daemon using `process.execPath` — this app's own installed binary — as its Node
interpreter (`ELECTRON_RUN_AS_NODE`), which meant the daemon kept that binary open for as
long as it ran, indefinitely. NCOW-24's wave-6 review found this live on both platforms:
on macOS the daemon reparented to pid 1 and `lsof` still showed it holding the app's own
Electron Framework binary; on Windows, `Win32_Process` showed the daemon running as
`electron.exe ...\node_modules\pm2\lib\Daemon.js` under the app's own exe.

On win32 this is not just a cosmetic surprise, though **the original characterization of
which half was blocked was wrong — corrected below (NCOW-24 fix pass #2) after an
independent reviewer re-verified both live against a real packaged NSIS build.**

- **Update: NOT blocked.** A silent NSIS reinstall (electron-updater's Windows update
  mechanism) *succeeds* even against a locked, running binary: NSIS renames the running
  image aside into `%TEMP%\ns*.tmp\old-install\` (Windows permits renaming a running image
  even though it refuses an in-place overwrite/delete) and queues its removal via
  `PendingFileRenameOperations`, then installs the new binary at the original path. The
  original "unchanged `LastWriteTime`" evidence for "blocked" was confounded: an unlocked,
  zero-process, same-version reinstall shows the identical unchanged mtime, because NSIS
  preserves archive timestamps regardless of locking — that observation carries no
  information about locking at all.
- **Uninstall: blocked, intermittently.** A silent uninstall exits 0, deregisters the
  Programs-and-Features entry (so Windows and the user both believe the app is gone), and
  deletes every *other* installed file, but leaves the locked, multi-hundred-MB binary
  behind — still running, with no UI path left to discover or stop it. This is
  intermittent: if a preceding update already moved the original binary aside (per the
  update mechanism above), a subsequent uninstall completes cleanly instead. Both halves
  were re-verified live on a real Windows VM for this fix pass: a fresh install (never
  updated) held locked via a running process showed the uninstall leave exactly one file
  behind — the locked `Claude Conduit.exe`, unchanged in size — while every other file and
  the registry entry were gone.

macOS was never observed to actually fail an update/uninstall from this (POSIX doesn't
block replacing or deleting a file a running process still holds open, unlike win32), only
to leave the lingering-process surprise noted above.

The fix (`resolveDaemonInterpreter()` in `pm2Control.js`, win32/linux only): before
spawning the daemon, copy the interpreter — and the handful of companion files Electron
needs alongside its own executable even in `ELECTRON_RUN_AS_NODE` mode
(`icudtl.dat`, `snapshot_blob.bin`, `v8_context_snapshot.bin`, and, Linux-only,
`libffmpeg.so` — added in fix pass #2 after a review found Electron's Linux binary has
`DT_NEEDED: libffmpeg.so` with `RPATH=$ORIGIN`, so a copy missing it fails `ld.so` outright;
live-verified in a real Ubuntu container against a genuine Electron Linux build) — into a
private location under `pm2Home`, and hand *that* copy to the daemon instead of the
installed binary itself. This directly fixes the real, reproduced uninstall-blocking case
above (the update half of the original motivation was wrong, but the fix is still worth
keeping for uninstall). Verified live on Windows, end-to-end, against the real packaged
NSIS installer/uninstaller: with a daemon-equivalent process running from the relocated
copy, the installed binary could be overwritten via the same rename-aside mechanism, and a
full silent uninstall removed every file (nothing left behind) while the still-running
process was completely unaffected. Skipped on darwin: the installed binary there is one
file deep inside a multi-file `.app` bundle, "copy the executable and its bundle" isn't the
same small, flat operation it is on win32/linux, and — per the paragraph above — macOS was
never the platform where this actually blocked anything. `resolveDaemonInterpreter()` falls
back to `process.execPath` unchanged on any failure (never a new way for bootstrap itself to
fail), and only applies to a daemon *this app* bootstraps — a pre-existing daemon this app
merely connects to and adopts is left exactly as it was, since this app has no way to know
(and no business assuming) what interpreter it was originally started with.

**Integrity (fix pass #2):** a copy is only treated as valid once the executable AND every
companion file present in the source have landed at the destination — not just an
exe-size match, which a live test showed can survive a partial/corrupted copy (e.g. a
crash mid-copy, disk-full, or an AV quarantine snatching one file) forever, with the broken
copy failing to boot every time it's reused thereafter. The copy is staged into a temp
directory under `pm2Home` and atomically renamed into place only once every file has
copied successfully, so a failure mid-copy leaves either a complete, working directory or
none at all — never a partial one masquerading as complete.

**Disk cost (documented, not fixed, in fix pass #2):** the relocated copy — measured live
at ~227 MiB (the executable plus its companion files) — is never removed by an uninstall on
any platform: `src/engine/uninstall.js` has no reliable way to know whether the daemon
currently listening at `pm2Home` is still using that exact copy as its running image, so
deleting it from there would risk exactly the locked-file problem this fix solves for the
app's own install directory, just relocated to `pm2Home` instead. See README.md's "Where
things live" table.

None of this changes whether the daemon can outlive the app — it still can, by design, on
every platform. What changed is that on win32/linux it no longer blocks *updating*, and no
longer blocks uninstalling except in the still-locked, never-previously-updated case above.
See README.md's "Closing vs. quitting" section for the user-facing version of this.

---

## 8. Claude Desktop instructions (printed by Step 6, saved as `DESKTOP-SETUP.md`)

Template — `{{MASTER_KEY}}`, `{{PORT}}` substituted; keep wording, it encodes verified behavior:

```markdown
## Connect Claude Desktop (and Cowork) to your local NIM proxy

1. Open Claude Desktop → menu bar → Help → Troubleshooting → **Enable Developer Mode**
   (the app restarts with a Developer menu).
2. Developer → **Configure Third-Party Inference…**
3. In the form, enter exactly:
   ┌──────────────────────────────┬─────────────────────────────────────────────┐
   │ Inference provider           │ Gateway                                     │
   │ Gateway base URL             │ http://127.0.0.1:{{PORT}}                   │
   │ Gateway API key              │ {{MASTER_KEY}}                              │
   │ Credential kind              │ Static API key                              │
   │ Gateway auth scheme          │ Bearer                                      │
   │ Models (inferenceModels)     │ [{"name":"claude-sonnet-4-5","anthropicFamilyTier":"sonnet"},
   │                              │  {"name":"claude-haiku-4-5","anthropicFamilyTier":"haiku"}]
   └──────────────────────────────┴─────────────────────────────────────────────┘
   The Models list must be set explicitly — auto-discovery only surfaces Claude-named
   models.
4. **Fully quit Claude Desktop (⌘Q) and reopen it.** The configuration is read only at launch.
5. Verify: the model picker should now show `claude-sonnet-4-5` (default) and `claude-haiku-4-5`.
   Start a Cowork session and give it a trivial task.

While third-party inference is active:
- Cowork runs in its local VM through your proxy. Cloud-hosted Cowork (claude.ai, mobile)
  still uses Anthropic and cannot be redirected.
- Anthropic-hosted cloud environments, the SSH environment picker, and Remote Control are
  unavailable. Disable third-party inference in the same Developer form to get them back.
```

---

## 9. Claude Code CLI configuration (optional path)

### 9.1 Env keys merged into `~/.claude/settings.json` `"env"`

| Variable | Value | Why |
|---|---|---|
| `ANTHROPIC_BASE_URL` | `http://127.0.0.1:{{PORT}}` | Gateway address. |
| `ANTHROPIC_AUTH_TOKEN` | `{{MASTER_KEY}}` | Bearer credential. |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-5` | Active model. |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | `claude-sonnet-4-5` | `/model` picker class entries resolve to NIM. |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | `claude-sonnet-4-5` | |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | `claude-haiku-4-5` | Current name for background-model override. |
| `ANTHROPIC_SMALL_FAST_MODEL` | `claude-haiku-4-5` | Deprecated predecessor; set for older CLI versions (harmless). |
| `API_TIMEOUT_MS` | `600000` | Large NIM models are slow. |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | `1` | Protects NIM's ~40 RPM free tier. Side effects: disables auto-update and gateway model discovery — README notes. |
| `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` | `1` | Suppresses pre-release request fields non-Anthropic upstreams 400 on. |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | `16384` | Keep ≤ the NIM model's output cap. |

Merge algorithm (implement exactly):

1. Read `~/.claude/settings.json`. Unparseable → **abort with error** (never overwrite what you
   can't parse). Missing → start from `{}`.
2. Set only the keys above inside `env`; preserve every other key in the file (`permissions`,
   `hooks`, `model`, `apiKeyHelper`, unrelated `env` entries) untouched.
3. Before writing: copy the original to `settings.json.bak.claude-conduit.<ISO-timestamp>`,
   record backup path + exact key list in `manifest.json`.
4. Write atomically (temp file + rename), pretty-printed 2-space JSON.

Note: a top-level `"model"` key in settings.json (users often have one) can make Claude Code
request Claude-named IDs — the `claude-*` wildcard (§6.1) absorbs those.

### 9.2 `status` subcommand

Prints one line each: pm2 app state (from `pm2 jlist`); port listening; `/health/liveliness`;
aliases served (`GET /v1/models` with master key); Claude Code settings pointing at the proxy
(yes/no/partially); desktop 3P config detected (best-effort read-only peek per §5.3 —
report "not detectable" rather than guessing).

### 9.3 `manifest.json`

```json
{
  "version": 1,
  "created_at": "2026-07-17T…",
  "port": 4000,
  "primary_model": "qwen/qwen3-coder-480b-a35b-instruct",
  "small_model": "meta/llama-3.1-8b-instruct",
  "nim_base_url": null,
  "litellm_path": "/Users/…/.local/bin/litellm",
  "litellm_version": "1.83.x",
  "pm2_app": "litellm-nim",
  "cli_configured": true,
  "settings_file": "/Users/…/.claude/settings.json",
  "settings_backup": "/Users/…/.claude/settings.json.bak.claude-conduit.2026-07-17T…",
  "env_keys_set": ["ANTHROPIC_BASE_URL", "…"]
}
```

### 9.4 `uninstall`

1. If `cli_configured`: remove exactly `env_keys_set` from the settings file (not a blind backup
   restore — that would clobber user edits made since install; the backup remains as a manual
   safety net).
2. `pm2 delete litellm-nim` (ignore "not found") + `pm2 save`.
3. Print desktop-removal instructions (Developer form → set Inference provider back / disable 3P;
   fully restart the app).
4. `--purge`: delete `~/.config/claude-conduit/` entirely (keys included). Without it, keep and
   print the path.
5. Remind: Claude Code returns to the saved claude.ai login; run `/login` if prompted.

---

## 10. Linux portability notes (not v1-blocking)

Everything is identical except: no Claude Desktop (CLI target only); `configLibrary` peek skipped;
paths use `~/.config` already. Document in README; CI can run the Linux flow headlessly with
`--yes --nim-api-key … --model … --small-model … --no-cli`.

---

## 11. Test mode (`claude-conduit test`)

Runs the full chain, prints a table, exit 0 iff all critical checks pass (else 4). Each failure
names the broken layer (client config / proxy / LiteLLM translation / NIM upstream) and one fix.
In the shipped app this table is the GUI's Diagnostics view (`src/renderer/views/diagnostics-view.js`,
implemented by `src/engine/diagnostics.js`'s `runDiagnostics()`) rather than a separate CLI binary —
no `claude-conduit` executable exists in this repo; the section heading is v1-spec language kept
for the request/response shapes below, which the implementation still follows exactly.

**Timeouts (NCOW-16, NCOW-17).** Checks 1–3 and 9 are non-model calls and fail fast (proxy alive:
5s; NIM catalog reachability: 10s; auth-enforced: 30s; CLI config coherent: local file read, no
network wait). Checks 4, 5, 6, 7 and 8 each exercise a real model completion and share a 60s
**interactive-reasonable** timeout — confirmed live (NCOW-16) that simply raising this number (90s,
180s, even 300s were all tried) does not reliably out-wait a congested shared/free NIM endpoint, and
for an interactive coding-assistant proxy a model that takes minutes to answer isn't "slow but
fine". A check that hits its timeout reports an accurate *"Timed out after 60s — {{MODEL}} is
responding too slowly for interactive use right now..."* diagnosis rather than an opaque aborted-
request error. `{{MODEL}}` here is always the real model id the user picked in Setup
(`primaryModelId` for checks 4/5/6/8, `smallModelId` for check 7) — never the hardcoded
`claude-sonnet-4-5`/`claude-haiku-4-5`/`claude-sonnet-4-6` litellm routing alias each request body
actually sends (that alias is required for routing and appears in the check's own label, matching
the sample output below, but the user never chose it, so it never appears in the failure message).
Check 6 (Streaming) additionally bounds every individual stream read against the same remaining
budget, not just the gap between reads — `Promise.race([reader.read(), remainingBudgetTimer])` — so
an upstream that stops sending anything at all, not even an SSE keep-alive, without ever closing the
connection can't hang the check past its own 60s; its internal scan buffer is also capped (trimmed
to a bounded tail once a scan doesn't find `message_start`) so a long-running slow stream can't grow
it, and the cost of rescanning it, without bound. Check 10 keeps its own 120s timeout, unchanged.
Worst-case total wall time across all ten checks is therefore roughly 5×60s + 120s, ~7 minutes —
long enough that the Diagnostics view's Run Diagnostics button has a Cancel button next to it once a
run is in progress (`diagnostics:cancel` over IPC, aborting the `AbortSignal` threaded through the
in-progress run), rather than only the option to wait it out. Checks already completed when a run is
cancelled keep their real result; checks not yet started are simply omitted.

| # | Check | Method | Pass criteria | Timeout | Critical |
|---|---|---|---|---|---|
| 1 | Proxy alive | `GET /health/liveliness` | HTTP 200 | 5s | ✅ |
| 2 | Auth enforced | `POST /v1/messages` **without** key | 401/403 (proves master key required) | 30s | ✅ |
| 3 | NIM reachable & models exist | `GET {nim_base}/models` with NIM key | 200; both configured IDs present (absent → warn, not fail: catalog listings shift) | 10s | ✅ (401 ⇒ fail) |
| 4 | Anthropic-format completion | see request A below | 200; non-empty `content[0].text`; `stop_reason` present | 60s | ✅ |
| 5 | **Tool calling** | request B below | a `content` block `"type":"tool_use"` with parseable `input.city` | 60s | ✅ |
| 6 | Streaming | request A + `"stream": true` | SSE body contains `message_start` | 60s | ✅ |
| 7 | Small model works | request A with `"model":"claude-haiku-4-5"` | 200 | 60s | ✅ |
| 8 | `claude-*` wildcard | request A with `"model":"claude-sonnet-4-6"` | 200 | 60s | ✅ |
| 9 | CLI config coherent | read settings.json | base URL/token match manifest; warn on conflicting shell `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL` exports | n/a (local) | warn-only |
| 10 | Live CLI smoke | if `claude` on PATH: `claude -p 'Reply with exactly: OK'` (gateway env exported, 120 s timeout) | non-empty stdout | 120s | warn-only |

Request A (matches the official gateway smoke test shape):

```
POST http://127.0.0.1:{{PORT}}/v1/messages
Authorization: Bearer {{MASTER_KEY}}
anthropic-version: 2023-06-01
content-type: application/json

{"model":"claude-sonnet-4-5","max_tokens":64,
 "messages":[{"role":"user","content":"Reply with exactly: OK"}]}
```

Request B (add to A) — **the single most valuable check**: a NIM model without working function
calling manifests later as Claude "doing nothing", which users can't self-diagnose:

```json
"tools":[{"name":"get_weather","description":"Get weather for a city",
          "input_schema":{"type":"object",
            "properties":{"city":{"type":"string"}},"required":["city"]}}],
"messages":[{"role":"user","content":"What is the weather in Paris? Use the tool."}]
```

If check 5 fails but 4 passes, the verdict must say: *"Model {{PRIMARY_MODEL_ID}} does not
reliably support tool calling — rerun `claude-conduit setup` and pick a model from the
recommended list."*

Sample output:

```
claude-conduit test — 2026-07-17 09:12
  1. Proxy alive ................. ✅
  2. Auth enforced ............... ✅
  3. NIM upstream ................ ✅  (127 models; claude-sonnet-4-5=qwen/qwen3-coder-480b-a35b-instruct)
  4. Completion (claude-sonnet-4-5) ...... ✅  1.9s
  5. Tool calling ................ ✅
  6. Streaming ................... ✅
  7. Completion (claude-haiku-4-5) ...... ✅  0.8s
  8. claude-* wildcard ........... ✅
  9. Claude Code config .......... ✅
 10. Live claude CLI ............. ✅  "OK"
All checks passed. Claude Desktop steps: ~/.config/claude-conduit/DESKTOP-SETUP.md
```

---

## 12. Error handling & gotchas

### 12.1 Error cases the script must handle explicitly

| Situation | Behavior |
|---|---|
| pm2 present but daemon wedged (`pm2 jlist` hangs/garbage) | Suggest `pm2 kill`; exit 2 |
| Port in use | Name it, suggest `lsof -i :<port>` / `--port`; exit 2 |
| NIM 401 on key validation | Re-prompt up to 3× then exit 2 |
| NIM `/models` returns empty list | Exit 1: "key valid but no models — check account entitlements at build.nvidia.com" |
| `--model` not in live catalog | Error with up to 5 near-matches (substring); exit 1 |
| Health check timeout | Dump last 50 pm2 log lines; exit 1 |
| settings.json unparseable | Abort CLI-config step with path + parse error; rest of setup continues; final summary flags it |
| Ctrl-C at any prompt | Clean abort, nothing half-written (write config files only after all prompts complete); exit 3 |
| Re-run after partial failure | All steps idempotent: reuse master key, `pm2 delete` before start, regenerate files wholesale |

### 12.2 Gotchas (README content)

1. **Not "free Claude":** responses come from the chosen NIM model (Qwen/Kimi/DeepSeek/Llama…);
   agentic-coding quality differs from Claude models.
2. **Rate limits:** hosted NIM free tier ≈ 40 requests/min + limited credits.
   `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` and the cheap `claude-haiku-4-5` model protect the
   budget; NIM 429s surface through LiteLLM (`num_retries: 2` absorbs blips).
3. **No prompt caching:** `cache_control` is dropped; long sessions re-pay full input tokens
   every turn.
4. **Context windows:** many NIM models are ≤ 128k — big repos can exceed them, surfacing as
   provider-worded 400s. Remedies: `/compact`; optionally add `CLAUDE_CODE_AUTO_COMPACT_WINDOW`
   (clamped ≥ 100k) to the env block.
5. **Thinking/beta 400s:** if errors name `thinking`/`adaptive`, add
   `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1`; `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` (set by
   default) covers most other beta fields; `drop_params` catches stragglers at the proxy.
6. **Token counting:** `/v1/messages/count_tokens` falls back to approximate tokenization for
   NIM — harmless bookkeeping drift.
7. **Features lost while gatewayed:** CLI — Remote Control, voice dictation. Desktop 3P — cloud
   environments, SSH picker, Remote Control. Cloud-hosted Cowork can't use the gateway at all.
8. **Desktop restart:** 3P config loads only at app launch; ⌘Q and reopen after the form.
9. **Reboot persistence:** pm2 apps survive daemon restarts after `pm2 save`, but reboots need
   `pm2 startup` (user runs the printed sudo command themselves).
10. **Supply chain:** never litellm 1.82.7/1.82.8 (PyPI malware); install the pinned version.

---

## 13. Acceptance criteria & test plan

Acceptance criteria (all must hold):

1. Fresh machine with pm2 + litellm: `claude-conduit` with no flags completes the wizard with
   only two required inputs (API key, model picks), ends with test-mode all-green, and prints the
   Desktop block.
2. Fully non-interactive: `claude-conduit --yes --nim-api-key … --model … --small-model …
   --no-cli` succeeds with zero prompts (CI-runnable).
3. `pm2 kill && pm2 resurrect` (daemon restart) → proxy returns without re-running setup.
4. Re-running setup: master key unchanged; clients keep working without re-configuration; models
   can be swapped and only `config.yaml` + manifest change.
5. `uninstall`: settings.json equals pre-install content except the removed keys; pm2 app gone;
   `--purge` leaves no trace under `~/.config/claude-conduit/`.
6. `test` exits 4 (not 0) when: proxy stopped; wrong NIM key; primary model lacks tool calling.
   Each failure message names the layer and a fix.
7. No secret ever appears in: pm2 files, process argv (`ps axww` during run), logs, or any file
   with mode wider than 0600.
8. Script runs on stock Node 18 with zero npm installs.

Manual test matrix (engineer executes before sign-off):

| # | Scenario | Expected |
|---|---|---|
| T1 | Wizard happy path (hosted NIM, defaults) | All green; Desktop block printed & saved |
| T2 | Wrong key ×3 | Exit 2 after third rejection |
| T3 | Pick non-recommended model without tool support | Setup completes; test check 5 fails with model-swap guidance |
| T4 | Port 4000 occupied | Exit 2 naming the holder; `--port 4001` succeeds |
| T5 | settings.json with hooks/permissions/deny lists | Untouched except env keys; backup created |
| T6 | Invalid JSON settings.json | CLI step aborted + flagged; proxy still installed |
| T7 | Desktop end-to-end (manual) | Form filled per instructions → restart → picker shows claude-sonnet-4-5/claude-haiku-4-5 → Cowork completes a trivial task |
| T8 | `claude` CLI end-to-end | `claude -p` returns text through the proxy (pm2 logs show the request) |
| T9 | Uninstall → reinstall | Same master key only if config dir kept (no `--purge`); new key after `--purge` |

---

## 14. Sources (fetched 2026-07-16)

- Claude Code LLM gateway (env vars, precedence, verification curl, troubleshooting):
  https://code.claude.com/docs/en/llm-gateway-connect.md
- Claude Desktop 3P gateway (names LiteLLM; form fields; `inferenceModels`; restart-at-launch):
  https://claude.com/docs/third-party/claude-desktop/gateway
- Claude Desktop 3P configuration reference (storage paths, MDM precedence, value encoding):
  https://claude.com/docs/third-party/claude-desktop/configuration
- LiteLLM Anthropic-format `/v1/messages` for all providers: https://docs.litellm.ai/docs/anthropic_unified
- LiteLLM NVIDIA NIM provider (`nvidia_nim/` prefix, api_base, env var):
  https://docs.litellm.ai/docs/providers/nvidia_nim
- LiteLLM count_tokens routing: https://docs.litellm.ai/docs/anthropic_count_tokens
- LiteLLM ← Claude Code tutorials: https://docs.litellm.ai/docs/tutorials/claude_responses_api
- LiteLLM 1.82.8 PyPI malware advisory: https://github.com/BerriAI/litellm/issues/24512
- NVIDIA NIM OpenAI-compatible API: https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html
  and https://docs.api.nvidia.com/nim/reference/llm-apis
- pm2 process management: https://pm2.keymetrics.io/docs/usage/application-declaration/
