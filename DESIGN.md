# Spec: `claude-nim-proxy` — Route Claude Desktop (Cowork) & Claude Code through LiteLLM → NVIDIA NIM

**Status:** Implementation-ready specification
**Audience:** Implementing engineer (or engineering agent). Every load-bearing external fact was
verified against primary sources on 2026-07-16 and **re-verified 2026-07-28**; source URLs in §14.
No further research required except the one item flagged in §14.
**Target platform:** macOS (Darwin) primary; Linux works with the same flow (§10 notes)
**Date:** 2026-07-28 (rev 3 — re-verification pass: litellm pin moved to **1.93.0**, `fable` tier and
subagent model added to §9.1, the MCP tool-search key corrected to `ENABLE_TOOL_SEARCH`, and two
managed-configuration prerequisite checks added to §4/§12.1. Rev 2, 2026-07-17: process manager is
pm2, model choice is interactive from the live NIM catalog, and the tool is a user-run setup wizard
rather than a system installer.)

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
| `claude-nim-proxy.mjs` | The entire CLI (wizard + subcommands). ESM, `#!/usr/bin/env node`. |
| `README.md` | Install one-liner, prerequisites, gotchas (§12), troubleshooting, uninstall. |
| `package.json` | `"bin": {"claude-nim-proxy": "./claude-nim-proxy.mjs"}`, `"engines": {"node": ">=18"}`, no deps. Publishing to npm optional; `node claude-nim-proxy.mjs` must always work standalone. |

Generated at runtime under `~/.config/claude-nim-proxy/` (created `0700`):

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
claude-nim-proxy [setup]            # default subcommand: the interactive wizard
    --nim-api-key <key>             # skip the key prompt
    --model <id>                    # skip primary-model picker
    --small-model <id>              # skip small-model picker
    --port <n>                      # default 4000
    --nim-base-url <url>            # self-hosted NIM (default https://integrate.api.nvidia.com/v1)
    --configure-cli | --no-cli      # skip the "configure Claude Code?" prompt (yes/no)
    --yes                           # accept all defaults; with --nim-api-key => fully non-interactive
claude-nim-proxy test               # end-to-end validation (§11); exit 0 = all pass
claude-nim-proxy status             # what's installed/running/configured (§9.2)
claude-nim-proxy restart            # pm2 restart litellm-nim (after manual config edits)
claude-nim-proxy uninstall [--purge]
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
| **Claude Code managed settings** | read `/Library/Application Support/ClaudeCode/managed-settings.json` | See "managed-configuration checks" below |
| **Desktop MDM profile** | stat `/Library/Managed Preferences/com.anthropic.claudefordesktop.plist` and `/Library/Managed Preferences/<user>/com.anthropic.claudefordesktop.plist` | See below |

litellm install guidance (printed verbatim on failure — pick the first tool present on PATH):

```
uv tool install 'litellm[proxy]==<PINNED>'      # preferred
pipx install 'litellm[proxy]==<PINNED>'
pip install --user 'litellm[proxy]==<PINNED>'
```

`<PINNED>` is a constant in the script. **Set it to `1.93.0`** — the latest stable as of 2026-07-28
(released 2026-07-19). The engineer refreshes it to the latest stable at build time; it must never be
set below 1.93.0.

**Security requirement, not a nicety:** LiteLLM **1.82.8** on PyPI contained credential-stealing
malware (`litellm_init.pth`, executed on every Python interpreter start, exfiltrating env vars / SSH
keys / cloud credentials). Both 1.82.7 and 1.82.8 have since been **removed from PyPI**, so this
check no longer guards a fresh install — it guards a machine that installed or cached a compromised
build while it was live, which is precisely the machine that most needs the warning. If the detected
installed version is 1.82.7 or 1.82.8, **refuse to proceed** and print:

```
✗ litellm <version> is a known-compromised release (credential stealer).
  1. Uninstall it now:  uv tool uninstall litellm   (or pipx uninstall / pip uninstall)
  2. Check for the dropper:  find "$(python3 -c 'import site;print(site.getsitepackages()[0])')" \
       -name 'litellm_init.pth'
  3. Rotate EVERY credential this machine has touched: cloud keys, SSH keys, API tokens,
     anything that was in your environment while that version was installed.
  4. Reinstall the pinned version and re-run setup.
```

If the installed version is older than the pin but not one of the compromised two, warn and continue.

**Managed-configuration checks** (both are read-only; neither writes anything):

- **Claude Code managed settings.** If `managed-settings.json` exists and contains `forceLoginMethod`
  or `forceLoginOrgUUID`, gateway credentials cannot be used at all on this machine (Claude Code
  ≥ 2.1.146 refuses the combination; the symptom is `This machine's managed settings require a
  first-party login`). Only an administrator can resolve it. Print a prominent warning, **skip the
  Claude Code configuration step entirely** (Step 6.2), and continue — do *not* exit, because the
  proxy and the Claude Desktop path still work. Flag it in the final summary and in `manifest.json`
  as `cli_configured: false, cli_blocked_reason: "managed-settings-force-login"`.
- **Desktop MDM profile.** If an Anthropic managed-preferences profile is present, MDM wins and any
  locally-entered form values are ignored — the in-app form is read-only and the §8 instruction block
  is un-followable. Print the MDM variant of the instructions instead (see §8), listing the key/value
  pairs an administrator must deploy rather than telling the user to fill a form they cannot edit.

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
Anthropic-hosted cloud environments, no SSH picker, no Remote Control).

MCP tool search is **disabled by default on 3P** because most proxies don't forward `tool_reference`
content blocks. The control is the environment variable **`ENABLE_TOOL_SEARCH=true`** (there is no
`toolSearchEnabled` key — an earlier revision of this spec named one in error). LiteLLM in passthrough
mode *does* forward those blocks and is named in the docs as such, so this is a **supported opt-in for
this gateway**, not something to avoid. Leave it off by default — one less variable while proving the
chain out — and document it in the README as available.

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

```yaml
model_list:
  # Stable aliases: clients reference these, so re-running setup to swap the
  # underlying NIM model never requires touching client config.
  - model_name: nim-large            # primary — what Desktop's default + ANTHROPIC_MODEL point at
    litellm_params:
      model: nvidia_nim/{{PRIMARY_MODEL_ID}}
      api_key: os.environ/NVIDIA_NIM_API_KEY
      # api_base: {{NIM_BASE_URL}}   # emitted only when --nim-base-url was given.
      # MEASURED 2026-07-28: api_base must INCLUDE the /v1 suffix — LiteLLM appends
      # "/chat/completions" to it verbatim (observed: POST /v1/chat/completions upstream).
      # So http://host:8080/v1 is correct; http://host:8080 is not. Matches the hosted
      # default https://integrate.api.nvidia.com/v1. This closes the §14 open item.

  - model_name: nim-small            # background/haiku-class traffic
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

**`master_key: os.environ/LITELLM_MASTER_KEY` is confirmed working** (measured 2026-07-28, litellm
1.93.0): the `os.environ/` indirection *is* honoured for `general_settings.master_key`, and behaves
identically to a literal value. This matters because it is what keeps `config.yaml` free of secrets
and lets it stay `0644` while `litellm.env` alone is `0600`. If a future litellm release stops
honouring the indirection here, the fallback is to inline the key **and** tighten `config.yaml` to
`0600` — do not inline it without also changing the mode.

### 6.2 `run.sh` (the launcher pm2 runs)

```bash
#!/bin/bash
set -euo pipefail
set -a; source "$HOME/.config/claude-nim-proxy/litellm.env"; set +a
exec litellm \
  --config "$HOME/.config/claude-nim-proxy/config.yaml" \
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
    script: '/Users/<user>/.config/claude-nim-proxy/run.sh',
    interpreter: 'bash',
    autorestart: true,
    max_restarts: 10,
    restart_delay: 3000,
    kill_timeout: 10000,
    out_file: '/Users/<user>/.config/claude-nim-proxy/logs/out.log',
    error_file: '/Users/<user>/.config/claude-nim-proxy/logs/err.log',
    time: true,                     // timestamps in logs
  }],
};
```

(Absolute paths templated in; create `logs/` at setup.)

### 7.2 Start sequence (wizard Step 5)

1. If an app named `litellm-nim` already exists in `pm2 jlist` → `pm2 delete litellm-nim` first
   (idempotent re-setup).
2. `pm2 start ~/.config/claude-nim-proxy/ecosystem.config.cjs`
3. Poll `GET http://127.0.0.1:<port>/health/liveliness` every 2 s, up to 60 s. LiteLLM cold start
   is slow (schema build); print a spinner/dots. Timeout → print
   `pm2 logs litellm-nim --lines 50 --nostream` output and exit 1.
4. `pm2 save` — persists the app list so a pm2 daemon restart resurrects it.
5. Boot persistence (optional, print-only): tell the user that surviving a **reboot** needs
   `pm2 startup` and to run the sudo command it prints. The wizard must **never run sudo itself**.

### 7.3 Operations (README + `status` output)

`pm2 status litellm-nim` · `pm2 logs litellm-nim` · `pm2 restart litellm-nim` (after any manual
edit of `config.yaml`) · `pm2 stop litellm-nim`. The `restart` subcommand is a thin wrapper.

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
   │ Models (inferenceModels)     │ [{"name":"nim-large","anthropicFamilyTier":"sonnet"},
   │                              │  {"name":"nim-small","anthropicFamilyTier":"haiku"}]
   └──────────────────────────────┴─────────────────────────────────────────────┘
   The Models list must be set explicitly — auto-discovery only surfaces Claude-named
   models, and this proxy's aliases are intentionally provider-neutral.
4. **Fully quit Claude Desktop (⌘Q) and reopen it.** The configuration is read only at launch.
5. Verify: the model picker should now show `nim-large` (default) and `nim-small`.
   Start a Cowork session and give it a trivial task.

While third-party inference is active:
- Cowork runs in its local VM through your proxy. Cloud-hosted Cowork (claude.ai, mobile)
  still uses Anthropic and cannot be redirected.
- Anthropic-hosted cloud environments, the SSH environment picker, and Remote Control are
  unavailable. Disable third-party inference in the same Developer form to get them back.

Tip: once the form is filled, **Export** in the same window writes a `.mobileconfig` (macOS) or
`.reg` (Windows) you can reuse on a second machine instead of retyping the gateway key. Note that
installing it as a managed profile makes the in-app form read-only from then on.
```

**MDM variant.** When the Desktop MDM profile check in §4 Step 1 found a managed profile, the form is
read-only and the block above cannot be followed. Print this instead — the values an administrator
must deploy (each object-typed value is a **JSON string**, not a plist `<dict>` or `<array>`):

| Key | Value |
|---|---|
| `inferenceProvider` | `gateway` |
| `inferenceGatewayBaseUrl` | `http://127.0.0.1:{{PORT}}` |
| `inferenceGatewayApiKey` | `{{MASTER_KEY}}` |
| `inferenceGatewayAuthScheme` | `bearer` |
| `inferenceCredentialKind` | `static` |
| `inferenceModels` | `[{"name":"nim-large","anthropicFamilyTier":"sonnet"},{"name":"nim-small","anthropicFamilyTier":"haiku"}]` |

A localhost gateway URL in a fleet-wide MDM profile only makes sense for a single-machine or lab
profile — say so in the printed note, so nobody pushes `127.0.0.1:4000` to the whole org.

---

## 9. Claude Code CLI configuration (optional path)

### 9.1 Env keys merged into `~/.claude/settings.json` `"env"`

| Variable | Value | Why |
|---|---|---|
| `ANTHROPIC_BASE_URL` | `http://127.0.0.1:{{PORT}}` | Gateway address. |
| `ANTHROPIC_AUTH_TOKEN` | `{{MASTER_KEY}}` | Bearer credential. |
| `ANTHROPIC_MODEL` | `nim-large` | Active model. |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | `nim-large` | `/model` picker class entries resolve to NIM. |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | `nim-large` | |
| `ANTHROPIC_DEFAULT_FABLE_MODEL` | `nim-large` | **Required.** The tier enum is now `sonnet\|opus\|haiku\|fable\|mythos`; without this, a bare `fable` alias — `/model fable`, subagent frontmatter, the Desktop Code tab — resolves to nothing routable. |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | `nim-small` | Current name for background-model override. |
| `ANTHROPIC_SMALL_FAST_MODEL` | `nim-small` | Deprecated predecessor; set for older CLI versions (harmless). |
| `CLAUDE_CODE_SUBAGENT_MODEL` | `nim-small` | Pins subagents, agent teams, and workflow agents to the cheap model. Without it they inherit normal resolution and every fan-out hits the primary — material against NIM's ~40 RPM free tier. Set to `inherit` to opt out. |
| `ANTHROPIC_CUSTOM_MODEL_OPTION` | `nim-large` | Puts the alias in the `/model` picker. Routing works without it (model-name validation is skipped behind a gateway), but the picker would otherwise show only built-in Claude entries and a user could silently switch off the working config. Validation is skipped for this variable's value. |
| `ANTHROPIC_CUSTOM_MODEL_OPTION_NAME` | `NIM (primary)` | Display name for the picker entry. |
| `API_TIMEOUT_MS` | `600000` | Large NIM models are slow. |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | `1` | Protects NIM's ~40 RPM free tier. Side effects: disables auto-update and gateway model discovery — README notes. |
| `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` | `1` | Suppresses pre-release request fields non-Anthropic upstreams 400 on. |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | `16384` | Keep ≤ the NIM model's output cap. |

Merge algorithm (implement exactly):

1. Read `~/.claude/settings.json`. Unparseable → **abort with error** (never overwrite what you
   can't parse). Missing → start from `{}`.
2. Set only the keys above inside `env`; preserve every other key in the file (`permissions`,
   `hooks`, `model`, `apiKeyHelper`, unrelated `env` entries) untouched.
3. Before writing: copy the original to `settings.json.bak.claude-nim-proxy.<ISO-timestamp>`,
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
  "settings_backup": "/Users/…/.claude/settings.json.bak.claude-nim-proxy.2026-07-17T…",
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
4. `--purge`: delete `~/.config/claude-nim-proxy/` entirely (keys included). Without it, keep and
   print the path.
5. Remind: Claude Code returns to the saved claude.ai login; run `/login` if prompted.

---

## 10. Linux portability notes (not v1-blocking)

Everything is identical except: no Claude Desktop (CLI target only); `configLibrary` peek skipped;
paths use `~/.config` already. Document in README; CI can run the Linux flow headlessly with
`--yes --nim-api-key … --model … --small-model … --no-cli`.

---

## 11. Test mode (`claude-nim-proxy test`)

Runs the full chain, prints a table, exit 0 iff all critical checks pass (else 4). Each failure
names the broken layer (client config / proxy / LiteLLM translation / NIM upstream) and one fix.

| # | Check | Method | Pass criteria | Critical |
|---|---|---|---|---|
| 1 | Proxy alive | `GET /health/liveliness` | HTTP 200 | ✅ |
| 2 | Auth enforced | `POST /v1/messages` with a **deliberately wrong** key (not a missing one) | **any non-2xx** — assert the response is not a completion. Do **not** assert 401/403: see the note below | ✅ |
| 3 | NIM reachable & models exist | `GET {nim_base}/models` with NIM key | 200; both configured IDs present (absent → warn, not fail: catalog listings shift) | ✅ (401 ⇒ fail) |
| 4 | Anthropic-format completion | see request A below | 200; non-empty `content[0].text`; `stop_reason` present | ✅ |
| 5 | **Tool calling** | request B below | a `content` block `"type":"tool_use"` with parseable `input.city` | ✅ |
| 6 | Streaming | request A + `"stream": true` | SSE body contains `message_start` | ✅ |
| 7 | Small model works | request A with `"model":"nim-small"` | 200 | ✅ |
| 8 | `claude-*` wildcard | request A with `"model":"claude-sonnet-4-6"` | 200 | ✅ |
| 9 | CLI config coherent | read settings.json | base URL/token match manifest; warn on conflicting shell `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL` exports | warn-only |
| 10 | Live CLI smoke | if `claude` on PATH: `claude -p 'Reply with exactly: OK'` (gateway env exported, 120 s timeout) | non-empty stdout | warn-only |

> **Check 2 — measured behaviour, 2026-07-28 (litellm 1.93.0).** An earlier revision of this spec
> asserted 401/403 here. **LiteLLM returns neither**, and a check written that way fails against a
> correctly-secured proxy:
>
> | Probe | Observed | Meaning |
> |---|---|---|
> | correct key, `Authorization: Bearer` | `200` | happy path |
> | correct key, `x-api-key` | `200` | LiteLLM accepts either header — so Desktop may use either auth scheme (§8 specifies `bearer`; both work) |
> | **wrong** key | `400 {"error":{"message":"No connected db.","type":"no_db_connection"}}` | **auth IS enforced.** LiteLLM rejected the key, then tried to resolve it as a *virtual key* and found no database. Confusing wording, correct outcome. |
> | **no** `Authorization` header at all | `500` | the missing-header path raises rather than returning a clean 401 |
>
> Therefore: probe with a **wrong key**, and assert only that the response is **not a 2xx completion**.
> A missing header can crash an auth path; only a wrong key that returns `200` proves there is no auth.
> When this check fails, the message must say *"the proxy accepted a bad key — anything on this machine
> can spend your NVIDIA credits"*, not "expected 401".

Request A (matches the official gateway smoke test shape):

```
POST http://127.0.0.1:{{PORT}}/v1/messages
Authorization: Bearer {{MASTER_KEY}}
anthropic-version: 2023-06-01
content-type: application/json

{"model":"nim-large","max_tokens":64,
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
reliably support tool calling — rerun `claude-nim-proxy setup` and pick a model from the
recommended list."*

Sample output:

```
claude-nim-proxy test — 2026-07-17 09:12
  1. Proxy alive ................. ✅
  2. Auth enforced ............... ✅
  3. NIM upstream ................ ✅  (127 models; nim-large=qwen/qwen3-coder-480b-a35b-instruct)
  4. Completion (nim-large) ...... ✅  1.9s
  5. Tool calling ................ ✅
  6. Streaming ................... ✅
  7. Completion (nim-small) ...... ✅  0.8s
  8. claude-* wildcard ........... ✅
  9. Claude Code config .......... ✅
 10. Live claude CLI ............. ✅  "OK"
All checks passed. Claude Desktop steps: ~/.config/claude-nim-proxy/DESKTOP-SETUP.md
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
| Managed settings force first-party login (`forceLoginMethod` / `forceLoginOrgUUID`) | Warn; skip Step 6.2 entirely; continue with proxy + Desktop; record `cli_blocked_reason` in the manifest; do **not** exit |
| Desktop MDM profile present | Print the §8 MDM variant instead of the form instructions; note the form is read-only |
| litellm 1.82.7 / 1.82.8 detected | Refuse to proceed; print the uninstall + credential-rotation block from §4 Step 1; exit 2 |
| Ctrl-C at any prompt | Clean abort, nothing half-written (write config files only after all prompts complete); exit 3 |
| Re-run after partial failure | All steps idempotent: reuse master key, `pm2 delete` before start, regenerate files wholesale |

### 12.2 Gotchas (README content)

1. **Not "free Claude":** responses come from the chosen NIM model (Qwen/Kimi/DeepSeek/Llama…);
   agentic-coding quality differs from Claude models.
2. **Rate limits:** hosted NIM free tier ≈ 40 requests/min + limited credits.
   `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` and the cheap `nim-small` model protect the
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
10. **Supply chain:** never litellm 1.82.7/1.82.8 (PyPI malware); install the pinned version (1.93.0
    or later).
11. **`/fast` misreports, twice over.** With `ANTHROPIC_AUTH_TOKEN` set, the fast-mode availability
    check requires a claude.ai login or Anthropic API key, so Claude Code reports *"Fast mode has been
    disabled by your organization"* without even sending the check — fix with
    `CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK=1`. Separately,
    `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` (set by default) suppresses the availability check,
    so `/fast` reports unavailable. Both read to a user as "the proxy broke Claude Code" — say so
    here before they file it as a bug.
12. **WebFetch still calls `api.anthropic.com`.** Its domain-safety preflight is *not* covered by
    `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`. Harmless on an open network; on restricted egress set
    `skipWebFetchPreflight: true` — a **top-level settings key**, not an entry inside `env`.
13. **MCP tool search is available, not forbidden.** Off by default on 3P, opt in with the
    `ENABLE_TOOL_SEARCH=true` environment variable (Desktop 3P, not Claude Code). Safe here because
    LiteLLM passthrough forwards `tool_reference` blocks (§5.2).
14. **`400 No connected db.` means "wrong gateway key", not "database missing".** This is the single
    most confusing error a user will hit, and it is guaranteed to happen the first time someone
    mistypes the key into the Desktop form or lets Claude Code's `ANTHROPIC_AUTH_TOKEN` drift out of
    sync with `litellm.env`. LiteLLM rejects the unknown key, then tries to resolve it as a *virtual
    key* in a database that does not exist, and surfaces the database failure instead of an auth
    failure. Measured 2026-07-28. The README must say so verbatim, and `status`/`test` must translate
    it: *"the gateway rejected your key — re-copy the master key from
    `~/.config/claude-nim-proxy/litellm.env` (or re-run `claude-nim-proxy setup`)."* Do **not**
    attempt to fix this by attaching a database; there is nothing wrong.

---

## 13. Acceptance criteria & test plan

Acceptance criteria (all must hold):

1. Fresh machine with pm2 + litellm: `claude-nim-proxy` with no flags completes the wizard with
   only two required inputs (API key, model picks), ends with test-mode all-green, and prints the
   Desktop block.
2. Fully non-interactive: `claude-nim-proxy --yes --nim-api-key … --model … --small-model …
   --no-cli` succeeds with zero prompts (CI-runnable).
3. `pm2 kill && pm2 resurrect` (daemon restart) → proxy returns without re-running setup.
4. Re-running setup: master key unchanged; clients keep working without re-configuration; models
   can be swapped and only `config.yaml` + manifest change.
5. `uninstall`: settings.json equals pre-install content except the removed keys; pm2 app gone;
   `--purge` leaves no trace under `~/.config/claude-nim-proxy/`.
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
| T7 | Desktop end-to-end (manual) | Form filled per instructions → restart → picker shows nim-large/nim-small → Cowork completes a trivial task |
| T8 | `claude` CLI end-to-end | `claude -p` returns text through the proxy (pm2 logs show the request) |
| T9 | Uninstall → reinstall | Same master key only if config dir kept (no `--purge`); new key after `--purge` |

---

## 14. Sources

**Re-verification pass 2026-07-28** confirmed 22 load-bearing claims unchanged and produced the rev-3
edits above. Full evidence, including per-claim status and this machine's prerequisite state, is in
`VERIFICATION-2026-07-28.md`. Current doc URLs (the Desktop 3P pages moved to `claude.com/docs/…` and
the Claude Code gateway page to `code.claude.com/docs/en/…`):

- Claude Desktop 3P gateway: https://claude.com/docs/third-party/claude-desktop/gateway
- Claude Desktop 3P configuration reference: https://claude.com/docs/third-party/claude-desktop/configuration
- Claude Code LLM gateway: https://code.claude.com/docs/en/llm-gateway-connect
- Claude Code model configuration (tier defaults, custom model option): https://code.claude.com/docs/en/model-config

**The former open research item is CLOSED — measured, not read.** A spike on 2026-07-28
(`test/step0-spike.sh` + `step0b-auth-diagnostic.sh`, litellm 1.93.0, Node v26.5.0, against a
mock NIM) confirmed the whole §1 premise empirically rather than from documentation:

| Question | Answer |
|---|---|
| Does LiteLLM `/v1/messages` translate `nvidia_nim/*` into Anthropic format? | **Yes** — `content[0].text` + `stop_reason` returned |
| With tool use? | **Yes** — `type:"tool_use"` block with parseable `input.city` |
| With streaming? | **Yes** — `message_start` present, 14 SSE lines |
| Does the `claude-*` wildcard absorb concrete Anthropic ids? | **Yes** — `claude-sonnet-4-6` routed |
| What URL shape does `api_base` need? | **Include `/v1`.** LiteLLM appends `/chat/completions` verbatim (observed `POST /v1/chat/completions`) |
| Is `os.environ/` honoured for `general_settings.master_key`? | **Yes** — identical to a literal value |
| Is the master key actually enforced? | **Yes** — a wrong key is rejected (see the check-2 note in §11) |

No outstanding research items. §6.1's config shape is validated as written.

### Original source list (fetched 2026-07-16)

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
