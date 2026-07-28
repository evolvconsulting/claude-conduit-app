# Handoff: implement `claude-nim-proxy`

## Context

Build the CLI wizard specified in **`DESIGN.md` at the root of this repo**
(`evolvconsulting/nvidia-cowork`, branch `dev`). It routes Claude Desktop / local Cowork and the
Claude Code CLI through a locally-run LiteLLM proxy to NVIDIA NIM, so a developer can point their
Claude clients at Qwen/Kimi/DeepSeek/Llama models behind the Anthropic Messages API. The repo
currently contains **only `DESIGN.md`** — every file you create is new.

`DESIGN.md` is the authoritative specification: §1–§14, implementation-ready. **Read it in full
before writing code.** Do not re-derive its decisions and do not treat this handoff as a replacement
for it.

**The spec is at rev 3 (2026-07-28) and the corrections below are already folded into it.** The
"Spec deltas" section is retained as a changelog so you can see what moved and why, not as a set of
overrides you must apply yourself. If a delta and `DESIGN.md` ever disagree, `DESIGN.md` rev 3 wins.
Full verification evidence: `VERIFICATION-2026-07-28.md` alongside this handoff.

## Tech Stack

- **Language**: Node.js ≥ 18, **single file, zero npm dependencies** (built-in `fetch`,
  `readline/promises`, `crypto`, `node:net`, `node:child_process`)
- **Module format**: ESM (`.mjs`), shebang `#!/usr/bin/env node`
- **Process manager**: pm2 (hard prerequisite, installed globally by the user)
- **Proxy**: LiteLLM `[proxy]` extra, pinned version, installed via `uv tool` / `pipx` / `pip --user`
- **Upstream**: NVIDIA NIM — hosted `https://integrate.api.nvidia.com/v1`, or a self-hosted NIM
  container via `--nim-base-url`
- **Clients configured**: Claude Code CLI (scripted), Claude Desktop + local Cowork (guided-manual)
- **Target OS**: macOS primary; Linux works with the CLI path only (spec §10)

## Project Location

```
/Users/tonyturner/projects/nvidia-cowork
```

Clone it first if absent: `gh repo clone evolvconsulting/nvidia-cowork` (private repo, `gh` is
authenticated). Work on a feature branch off `dev`; `dev` and `main` are currently identical at
`0528c915`.

## Requirements

Implement §1–§13 of `DESIGN.md` exactly, as three files (spec §2):

1. Create `claude-nim-proxy.mjs` — the whole CLI: `setup` (default), `test`, `status`, `restart`,
   `uninstall [--purge]`, with the flags and exit codes in §3 (`0` ok · `1` failure · `2` prereq
   missing · `3` user abort · `4` test check failed).
2. Implement the Step 1 prerequisite gate (§4) — Node ≥ 18, pm2 present, pm2 daemon parseable, litellm
   on PATH, litellm version safe, port free — each printing a one-line ✅/❌ and the exact fix on
   failure. **Plus the two new checks in delta E and F below.**
3. Implement Step 2 NVIDIA key intake (§4): flag → `NVIDIA_NIM_API_KEY` env → masked prompt; validate
   immediately against `GET {nim_base}/models`; 3 attempts then exit 2; never echo the key (log as
   `nvapi-…last4`).
4. Implement Step 3 interactive model selection (§4) — curated shortlist **intersected with the live
   catalog**, substring search over the full list, `more` paging, unverified-tool-calling warning,
   and `--model`/`--small-model` validated against the live list.
5. Implement Step 4 config generation (§2 table, §6) — `config.yaml`, `litellm.env` (**0600**),
   `run.sh` (0700), `ecosystem.config.cjs`, `manifest.json`, `DESKTOP-SETUP.md`, under
   `~/.config/claude-nim-proxy/` created `0700`. Reuse an existing master key when present.
6. Resolve the **absolute** litellm path at generation time and template it into `run.sh` (§6.2) —
   pm2's daemon PATH differs from the user's shell under `uv tool`/`pipx`.
7. Implement Step 5 pm2 lifecycle (§7) — `pm2 delete` if the app exists, start from the ecosystem
   file, poll `/health/liveliness` every 2s up to 60s with progress output, `pm2 save`, then
   **print-only** guidance about `pm2 startup`. **Never invoke sudo.**
8. Implement Step 6 client configuration (§8, §9.1) — always print + save the Desktop block; prompt
   for the Claude Code settings merge unless `--configure-cli`/`--no-cli` was passed.
9. Implement the settings-merge algorithm in §9.1 **exactly**: abort on unparseable JSON, set only the
   listed keys inside `env`, preserve every other key, timestamped backup before writing, atomic
   temp-file + rename, 2-space pretty JSON, record backup path and key list in `manifest.json`.
10. Implement Step 7 / the `test` subcommand (§11) — all 10 checks, the sample-output table format,
    exit 0 only when every critical check passes, and each failure naming the broken layer plus one
    fix. Check 5 (tool calling) must produce the model-swap verdict in §11 verbatim.
11. Implement `status` (§9.2) and `uninstall` (§9.4) — including the key-subtraction uninstall
    (remove exactly `env_keys_set`, do **not** blind-restore the backup) and the read-only Desktop
    3P peek that reports "not detectable" rather than guessing.
12. Write `README.md` covering the install one-liner, prerequisites, §7.3 operations, all §12.2
    gotchas **plus the new ones in delta H**, troubleshooting, and uninstall.
13. Write `package.json` — `bin: {"claude-nim-proxy": "./claude-nim-proxy.mjs"}`,
    `engines: {"node": ">=18"}`, **no dependencies**. `node claude-nim-proxy.mjs` must always work
    standalone.

## Spec deltas — changelog of what rev 3 changed (already in `DESIGN.md`)

Verified 2026-07-28. Evidence and source URLs in `VERIFICATION-2026-07-28.md`.

### A. Set `<PINNED>` to `1.93.0`, and keep the malware check (§4 Step 1)

`DESIGN.md` says the pin "must be ≥ 1.83." Latest stable on PyPI today is **`1.93.0`** (2026-07-19).
Use that. Separately: **`1.82.7` and `1.82.8` have been removed from PyPI**, so the check now guards
against an *already-installed or locally-cached* compromised build — keep it and reword the message
accordingly: uninstall, rotate every credential this machine has touched, and check site-packages
for `litellm_init.pth`. Still refuse to proceed on those two versions.

### B. Add the `fable` tier and pin the subagent model (§9.1)

The Claude tier enum is now `sonnet | opus | haiku | fable | mythos`. Add to the env block:

| Variable | Value | Why |
|---|---|---|
| `ANTHROPIC_DEFAULT_FABLE_MODEL` | `nim-large` | Bare `fable` alias otherwise resolves to nothing routable |
| `CLAUDE_CODE_SUBAGENT_MODEL` | `nim-small` | Subagents/agent teams/workflows otherwise fan out onto the expensive primary — material against NIM's ~40 RPM free tier |

### C. Fix the MCP tool-search reference (§5.2, README)

There is no `toolSearchEnabled` key. The documented control is the environment variable
**`ENABLE_TOOL_SEARCH=true`**, and the docs explicitly name **LiteLLM in passthrough mode** as a
gateway that *does* forward `tool_reference` blocks. Keep it **off by default**, but document it in
the README as a supported opt-in for this gateway rather than something to avoid.

### D. Make `nim-large` selectable in the `/model` picker (§9.1)

`ANTHROPIC_MODEL=nim-large` routes fine (model-name validation is skipped behind a gateway), but the
alias never appears in `/model`, so a user can silently switch away from the working config. Add:

| Variable | Value |
|---|---|
| `ANTHROPIC_CUSTOM_MODEL_OPTION` | `nim-large` |
| `ANTHROPIC_CUSTOM_MODEL_OPTION_NAME` | `NIM (primary)` |

Do **not** use `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1` for this — the spec's
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` explicitly turns discovery off. The two conflict.

### E. New prereq check — Claude Code managed settings can hard-block gateway credentials

Read `/Library/Application Support/ClaudeCode/managed-settings.json`. If it contains
`forceLoginMethod` or `forceLoginOrgUUID`, gateway credentials **cannot** be used (v2.1.146+;
symptom: `This machine's managed settings require a first-party login`) and only an administrator can
resolve it. Warn loudly, **skip the Claude Code configuration step**, and continue with the proxy +
Desktop path. Do not exit 2 — the Desktop path still works.

### F. New prereq check — a Desktop MDM profile makes the in-app form read-only

Check for `/Library/Managed Preferences/com.anthropic.claudefordesktop.plist` (and the per-user
variant under `/Library/Managed Preferences/<user>/`). When a managed source is present it wins and
locally-entered values are ignored, so the §8 instruction block is un-followable. Print a different
message in that case: the configuration must come from MDM, and give the key/value pairs
(`inferenceProvider`, `inferenceGatewayBaseUrl`, `inferenceGatewayApiKey`,
`inferenceGatewayAuthScheme`, `inferenceCredentialKind`, `inferenceModels`) for the admin to deploy.

### G. Mention the Desktop **Export** button in `DESKTOP-SETUP.md`

The in-app configuration window now exports `.mobileconfig` (macOS) / `.reg` (Windows). Add one line
after the form-filling steps: Export produces a reproducible artifact for a second machine instead of
retyping the master key — with the caveat from delta F that an installed profile makes the form
read-only. **This does not change the §5.3 decision: the wizard still must not write
`configLibrary/` or install managed preferences.**

### H. Add two gotchas to §12.2 / README

- **`/fast` misreports under a bearer token.** With `ANTHROPIC_AUTH_TOKEN` set, Claude Code reports
  *"Fast mode has been disabled by your organization"* without sending the check. Fix:
  `CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK=1`. Also note `DISABLE_NONESSENTIAL_TRAFFIC=1` suppresses the
  availability check, so `/fast` reports unavailable. Users will read both as "the proxy broke
  Claude Code."
- **WebFetch still calls `api.anthropic.com`.** Its domain-safety preflight is not covered by
  `DISABLE_NONESSENTIAL_TRAFFIC`. Harmless on an open network; set `skipWebFetchPreflight: true` on
  restricted egress.

### I. ~~Re-read one source before implementing `--nim-base-url`~~ — RESOLVED by spike, 2026-07-28

Measured, not read. `api_base` **must include the `/v1` suffix**: LiteLLM appends
`/chat/completions` to it verbatim (observed `POST /v1/chat/completions` upstream). No open research
items remain.

### J. §11 check 2 was wrong — do not implement the old wording

The spike found that LiteLLM returns **neither 401 nor 403** for a bad credential:

| Probe | Observed (litellm 1.93.0) |
|---|---|
| correct key, `Authorization: Bearer` | `200` |
| correct key, `x-api-key` | `200` — either header works, so Desktop may use either auth scheme |
| **wrong** key | `400 {"error":{"message":"No connected db.","type":"no_db_connection"}}` |
| **no** `Authorization` header | `500` |

So implement check 2 as: **probe with a deliberately wrong key, and assert the response is not a 2xx
completion.** A missing header can crash an auth path; only a wrong key answered with `200` proves
there is no auth. On failure the message must be *"the proxy accepted a bad key — anything on this
machine can spend your NVIDIA credits"*, not "expected 401".

Also add gotcha §12.2 #14 to the README: **`400 No connected db.` means "wrong gateway key"**, not a
missing database. It's what a user sees when the Desktop form key is mistyped or `ANTHROPIC_AUTH_TOKEN`
drifts out of sync with `litellm.env`. `status` and `test` must translate it; nobody should attach a
database to "fix" it.

### K. The premise is proven — build with confidence in §6.1

The spike confirmed empirically that LiteLLM translates `nvidia_nim/*` into Anthropic format with
tool use (`type:"tool_use"` + parseable input) and streaming (`message_start`) intact, that the
`claude-*` wildcard absorbs concrete Anthropic ids, and that `master_key: os.environ/…` is honoured
(so `config.yaml` stays `0644` and secrets stay only in `litellm.env`). §6.1's config shape is
validated as written — reproduce it faithfully rather than redesigning it.

## Architecture & Design Decisions

Settled in `DESIGN.md`. Restated because breaking any of them silently breaks the tool:

- **Node, not Python.** pm2 makes Node guaranteed-present; Python adds a second runtime and
  pyenv/system version ambiguity. Rejected deliberately (§2).
- **Secrets live in exactly one file**: `litellm.env`, mode `0600`, sourced by `run.sh`. They appear
  in no pm2 file, no plist, no `process.argv`, no log (§6.2).
- **`--host 127.0.0.1`, always.** Never `0.0.0.0` — this fronts a paid API key behind a static master
  key on a personal machine (§6.2).
- **`exec litellm`** in `run.sh` so pm2 supervises litellm itself, not a bash parent (§6.2).
- **`drop_params: true`** is mandatory, not a nicety — Claude clients send Anthropic-only fields
  (`cache_control`, `thinking`, `metadata`) that NIM rejects (§6.1).
- **Stable aliases `nim-large` / `nim-small`** so swapping the underlying NIM model never touches
  client config; plus a **`claude-*` wildcard** absorbing concrete Anthropic IDs that clients request
  regardless of overrides (§6.1).
- **Desktop is guided-manual, by design.** Local 3P config lives in a directory documented as written
  by the in-app form; the only supported programmatic path is MDM, which a user wizard must not
  install (§5.3). Re-verified 2026-07-28 — still correct.
- **Claude Code env goes in `~/.claude/settings.json`, never project settings.** A project-scoped
  `env` block applies only *after* the first-run wizard and trust prompt, which produces a login
  prompt despite a working gateway. This is load-bearing (§9.1).
- **Master key is reused across re-runs** so idempotent setup doesn't invalidate already-configured
  clients (§4 Step 4).
- **Test-mode check 5 (tool calling) is the authoritative capability check** — the NIM `/v1/models`
  endpoint doesn't advertise function-calling support, and a model without it manifests as Claude
  "doing nothing," which users cannot self-diagnose (§3, §11).

## File Structure

```
nvidia-cowork/
├── DESIGN.md                  # the spec — read, do not edit
├── claude-nim-proxy.mjs       # the entire CLI: wizard + test/status/restart/uninstall
├── package.json               # bin entry, engines >=18, zero deps
└── README.md                  # install, prereqs, ops, gotchas, troubleshooting, uninstall
```

Generated at runtime (never committed) under `~/.config/claude-nim-proxy/` (dir `0700`):

```
~/.config/claude-nim-proxy/
├── config.yaml                # 0644  LiteLLM proxy config (§6.1)
├── litellm.env                # 0600  NVIDIA_NIM_API_KEY + LITELLM_MASTER_KEY — the only secrets file
├── run.sh                     # 0700  sources litellm.env, execs litellm at an absolute path
├── ecosystem.config.cjs       # 0644  pm2 app "litellm-nim" → run.sh, no secrets
├── manifest.json              # 0644  everything the tool changed (§9.3)
├── DESKTOP-SETUP.md           # 0644  the printed Desktop instructions (§8 + delta G)
└── logs/
    ├── out.log
    └── err.log
```

## What NOT to Do

- Do **NOT** add npm dependencies. Zero-dependency is an acceptance criterion (§13.8). No commander,
  no chalk, no inquirer, no yaml library — hand-roll the prompts and template the YAML.
- Do **NOT** write to `~/Library/Application Support/Claude-3p/configLibrary/`, and do NOT install
  managed preferences or a `.mobileconfig`. Desktop is instructions-only (§5.3).
- Do **NOT** bind the proxy to `0.0.0.0` or any non-loopback interface, and do not add a
  `--host` flag that would let a user do it.
- Do **NOT** run `sudo`, or shell out to anything that would prompt for it. `pm2 startup` is
  print-only guidance (§7.2 step 5).
- Do **NOT** pass secrets on a command line, put them in `ecosystem.config.cjs`, or echo the NVIDIA
  key or master key back to the terminal or logs.
- Do **NOT** blind-restore the settings backup on uninstall — subtract exactly `env_keys_set`, so
  edits the user made since install survive (§9.4.1).
- Do **NOT** overwrite an unparseable `~/.claude/settings.json`. Abort that step, flag it in the
  final summary, and let the rest of setup continue (§12.1).
- Do **NOT** write any config file before all prompts have completed — Ctrl-C must leave nothing
  half-written (§12.1).
- Do **NOT** put the Claude Code env block in a project `.claude/settings.json` or
  `settings.local.json` (see Architecture, above).
- Do **NOT** use `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1` alongside
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` — the second disables the first (delta D).
- Do **NOT** rewrite Python or add a second runtime (§2, explicitly rejected).
- Do **NOT** show a model in the picker that isn't in the live catalog — always intersect the curated
  shortlist against what the account can actually call (§3).
- Do **NOT** edit `DESIGN.md` as part of implementation. It is at rev 3 and is the reference, not a
  working document. If you find a genuine spec error, note it in the PR description instead.

## Environment Variables

Written by the wizard into the `env` block of `~/.claude/settings.json` (spec §9.1 + deltas B and D):

```
ANTHROPIC_BASE_URL                          = http://127.0.0.1:{{PORT}}
ANTHROPIC_AUTH_TOKEN                        = {{MASTER_KEY}}
ANTHROPIC_MODEL                             = nim-large
ANTHROPIC_DEFAULT_SONNET_MODEL              = nim-large
ANTHROPIC_DEFAULT_OPUS_MODEL                = nim-large
ANTHROPIC_DEFAULT_FABLE_MODEL               = nim-large      # delta B
ANTHROPIC_DEFAULT_HAIKU_MODEL               = nim-small
ANTHROPIC_SMALL_FAST_MODEL                  = nim-small      # deprecated predecessor, harmless
CLAUDE_CODE_SUBAGENT_MODEL                  = nim-small      # delta B
ANTHROPIC_CUSTOM_MODEL_OPTION               = nim-large      # delta D
ANTHROPIC_CUSTOM_MODEL_OPTION_NAME          = NIM (primary)  # delta D
API_TIMEOUT_MS                              = 600000
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC    = 1
CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS      = 1
CLAUDE_CODE_MAX_OUTPUT_TOKENS               = 16384
```

Read from the environment by the wizard itself: `NVIDIA_NIM_API_KEY` (optional, skips the prompt).

Documented in the README as opt-in fixes, **not written by default** — note which surface each one
belongs to, they are not interchangeable:

| Opt-in | Kind | Surface |
|---|---|---|
| `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` | env var | Claude Code |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW=<n>` | env var | Claude Code (clamped ≥ 100k) |
| `CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK=1` | env var | Claude Code |
| `skipWebFetchPreflight: true` | **settings key**, not an env var — top level of `settings.json`, not inside `env` | Claude Code |
| `ENABLE_TOOL_SEARCH=true` | env var | **Claude Desktop 3P**, not Claude Code (delta C) |

## Dependencies to Install

None for the project itself. The **user's** prerequisites, which the wizard checks and never installs
on their behalf:

```bash
npm install -g pm2
uv tool install 'litellm[proxy]==1.93.0'      # preferred; else pipx, else pip --user
```

*On the machine this handoff was written for: Node v26.5.0 ✅, `uv` present ✅, Claude Code 2.1.204 ✅,
**pm2 not installed**, **litellm not installed**. Both hard prerequisites currently fail — that's the
first thing to test (see Phase 1 verify).*

## Phasing

Four phases. Each is independently verifiable; do not start the next until the previous verifies.

### Phase 1: Skeleton, prereqs, and key intake
- `package.json`, `claude-nim-proxy.mjs` scaffold, argument parsing for every §3 flag and subcommand,
  exit-code discipline.
- Step 1 prereq gate (§4) including deltas A, E, F.
- Step 2 NVIDIA key intake + live validation (§4).
- **Verify**: on this machine (no pm2, no litellm) `node claude-nim-proxy.mjs` exits **2** and prints
  both install commands, no stack trace. `--help` lists every subcommand and flag. With pm2 and
  litellm installed, the gate passes and reaches the key prompt. A bad key re-prompts 3× then exits 2.

### Phase 2: Model selection and config generation
- Step 3 interactive picker: shortlist ∩ live catalog, substring search, `more` paging, unverified
  warning, flag validation with near-matches.
- Step 4: all six generated files with correct modes; master-key reuse; absolute litellm path
  templated into `run.sh`.
- **Verify**: `ls -l ~/.config/claude-nim-proxy/` shows `litellm.env` at `0600`, `run.sh` at `0700`,
  dir at `0700`. `config.yaml` contains the chosen model IDs and `drop_params: true`. Re-running
  setup leaves `LITELLM_MASTER_KEY` unchanged. `--model bogus/model` exits 1 with near-matches.

### Phase 3: pm2 lifecycle and client configuration
- Step 5 pm2 start, health poll, `pm2 save`, log dump on timeout, print-only `pm2 startup`.
- Step 6: `DESKTOP-SETUP.md` generation (§8 + delta G) and the §9.1 settings merge.
- `status` and `restart`.
- **Verify**: `pm2 status litellm-nim` shows online; `curl 127.0.0.1:4000/health/liveliness` returns
  200; `curl` without the master key returns 401/403. `pm2 kill && pm2 resurrect` brings the proxy
  back with no re-setup. A `~/.claude/settings.json` containing `hooks` + `permissions` + a top-level
  `model` comes back with those keys byte-identical and only the `env` keys added, with a timestamped
  backup present. Invalid JSON aborts only that step.

### Phase 4: Test mode, uninstall, README
- All 10 §11 checks with the sample-output table; exit 4 semantics; layer-naming failures; the check-5
  model-swap verdict.
- `uninstall [--purge]` with key subtraction.
- `README.md` with §12.2 gotchas plus delta H.
- **Verify**: the full §13 acceptance criteria and the T1–T9 manual matrix. Specifically:
  `claude-nim-proxy test` exits 4 (not 0) with the proxy stopped, with a wrong NIM key, and with a
  primary model that lacks tool calling. `ps axww` during a run shows no secret. `--purge` leaves
  nothing under `~/.config/claude-nim-proxy/`. Non-interactive
  `--yes --nim-api-key … --model … --small-model … --no-cli` completes with zero prompts.

## Deliverable Checklist

- [ ] `claude-nim-proxy.mjs` implements `setup`/`test`/`status`/`restart`/`uninstall` with §3 flags and exit codes
- [ ] Prereq gate covers Node, pm2, pm2 daemon, litellm presence, litellm version, port — plus deltas E and F
- [ ] `<PINNED>` is `1.93.0`; 1.82.7/1.82.8 refuse to proceed with credential-rotation guidance (delta A)
- [ ] NVIDIA key: flag → env → masked prompt, validated live, 3 attempts, never echoed
- [ ] Model picker intersects the curated shortlist with the live catalog; search + paging work; flags validated
- [ ] All six generated files present with the exact modes in §2; config dir `0700`; `litellm.env` `0600`
- [ ] `run.sh` uses an absolute litellm path, `exec`, and `--host 127.0.0.1`
- [ ] pm2 app starts, health-polls to 60s, `pm2 save` runs, `pm2 startup` is print-only, no sudo anywhere
- [ ] `DESKTOP-SETUP.md` matches §8 wording, includes the Export note (delta G), and the MDM variant (delta F)
- [ ] Settings merge is exact: abort-on-unparseable, key-scoped, backup, atomic write, 2-space JSON, manifest record
- [ ] Env block includes `ANTHROPIC_DEFAULT_FABLE_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL`, and the custom-model-option pair (deltas B, D)
- [ ] `test` runs all 10 checks, prints the §11 table, exits 0 only on all-critical-pass, names the broken layer on failure
- [ ] Check 5 failure emits the §11 model-swap verdict verbatim
- [ ] `uninstall` subtracts exactly `env_keys_set`; `--purge` removes the config dir
- [ ] `README.md` covers install, prereqs, §7.3 ops, all §12.2 gotchas + delta H, troubleshooting, uninstall
- [ ] `package.json` has the bin entry and `engines: >=18` with **zero dependencies**
- [ ] `node claude-nim-proxy.mjs` works standalone without `npm install`
- [ ] No secret in pm2 files, `process.argv`, logs, or any file with mode wider than `0600` (§13.7)
- [ ] All nine §13 acceptance criteria pass; T1–T9 manual matrix executed and recorded in the PR
- [ ] `DESIGN.md` unmodified by implementation (it is already at rev 3); any newly-found spec issues raised in the PR description instead
