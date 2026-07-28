# DESIGN.md verification pass — 2026-07-28

**Subject:** `evolvconsulting/nvidia-cowork` → `dev/DESIGN.md` (639 lines, 33,556 bytes, spec dated 2026-07-17)
**Repo state at review:** `dev` and `main` both at `0528c915` ("Initial commit: add DESIGN.md"). The tree
contains **one blob — `DESIGN.md`**. No implementation exists yet.
**Why this pass:** the spec asserts "every load-bearing external fact was verified against primary
sources on 2026-07-16 … no further research required." That was 12 days ago, against a surface
(Claude Desktop 3P config, Claude Code gateway env) that ships changes weekly.

**Verdict: the spec holds up well.** Every architectural decision survives re-verification. Four
corrections and five additions below — none of them structural, but item **A** is a security pin that
must move before anyone runs the wizard, and items **E**/**F** are new prerequisite checks that would
otherwise produce a confusing hard failure on a managed laptop.

---

## 1. Confirmed — still accurate as written

| # | Claim (spec §) | Status |
|---|---|---|
| 1 | LiteLLM `/v1/messages` speaks the Anthropic wire format for **all** providers (§1) | ✅ Docs table: "Supported Providers — **All LiteLLM supported providers**" |
| 2 | `nvidia_nim/<model>` prefix routes to NIM (§6.1) | ✅ "We support ALL Nvidia NIM models, just set `model=nvidia_nim/<any-model-on-nvidia_nim>`" |
| 3 | Claude Code gateway = `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` (§5.1) | ✅ Documented; `AUTH_TOKEN` → `Authorization: Bearer`, `API_KEY` → `x-api-key` |
| 4 | Settings-file `env` values override shell exports (§5.1) | ✅ "When both a shell export and a settings-file `env` block set the same variable, the settings-file value applies" |
| 5 | Gateway credential takes precedence over a saved claude.ai login; login stays saved and unused (§5.1) | ✅ Verbatim in docs, incl. the `/logout` and "unset to revert" behavior |
| 6 | Remote Control + voice dictation unavailable while gatewayed; Remote Control also killed by a non-Anthropic `ANTHROPIC_BASE_URL` as of **v2.1.196** (§5.1) | ✅ Exact version match |
| 7 | Desktop 3P activated by `inferenceProvider: "gateway"`; fields `inferenceGatewayBaseUrl` / `inferenceGatewayApiKey` / `inferenceGatewayAuthScheme: bearer`; credential kind static (§5.2, §8) | ✅ All keys present; `inferenceCredentialKind` enum is `static \| helper-script \| interactive \| vendor-profile \| oauth \| workforce` — "Static API key" = `static` |
| 8 | Desktop enable path: **Help → Troubleshooting → Enable Developer Mode**, then **Developer → Configure Third-Party Inference** (§8 steps 1–2) | ✅ Confirmed verbatim in the Claude Code gateway doc's "Desktop app" section |
| 9 | Config is read **once at launch** → fully quit and reopen (§5.2, §8 step 4, §12.2 #8) | ✅ "Configuration is read **once at launch**, so fully quit and reopen the app after any change" |
| 10 | Local 3P config lives at `~/Library/Application Support/Claude-3p/configLibrary/` (`_meta.json` + `<id>.json`), written by the in-app form (§5.3) | ✅ Path and layout confirmed in the "How keys are read" table |
| 11 | Auto-discovery surfaces only recognizably-Claude IDs → `inferenceModels` must be explicit (§5.2, §8) | ✅ "Auto-discovery shows only models whose IDs are recognizably Claude; if your gateway advertises models under opaque aliases, set `inferenceModels` explicitly" |
| 12 | `inferenceModels` entry shape `{"name":…,"anthropicFamilyTier":…}` (§8) | ✅ Valid. Fields: `name`, `labelOverride`, `supports1m`, `anthropicFamilyTier`, `isFamilyDefault`. Gateway note: `name` must be the exact ID your `/v1/models` returns — `nim-large`/`nim-small` qualify |
| 13 | Desktop 3P runs sessions locally only — no SSH picker, no Anthropic-hosted cloud environments, no Remote Control (§5.2, §8) | ✅ Confirmed |
| 14 | Cloud-hosted Cowork / claude.ai / mobile cannot be redirected (§1, §8) | ✅ "Claude Code in Slack and Claude Code on the web are Anthropic-hosted products that always use Anthropic's API… Gateway variables set in a cloud session's environment configuration are not applied" |
| 15 | `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` disables auto-update **and** gateway model discovery (§9.1) | ✅ Both side effects documented |
| 16 | `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` suppresses pre-release fields non-Anthropic upstreams 400 on (§9.1, §12.2 #5) | ✅ Documented as the fix for `400 … context_management / Extra inputs are not permitted` |
| 17 | `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` for `thinking`/`adaptive` 400s (§12.2 #5) | ✅ Documented (works on Opus 4.6 / Sonnet 4.6) |
| 18 | `CLAUDE_CODE_AUTO_COMPACT_WINDOW` is clamped to ≥ 100k (§12.2 #4) | ✅ "clamped to at least 100,000 tokens and at most the model's context window" |
| 19 | `ANTHROPIC_SMALL_FAST_MODEL` is the deprecated predecessor of `ANTHROPIC_DEFAULT_HAIKU_MODEL` (§9.1) | ✅ "Note: `ANTHROPIC_SMALL_FAST_MODEL` is deprecated in favor of `ANTHROPIC_DEFAULT_HAIKU_MODEL`" |
| 20 | litellm 1.82.8 shipped a credential stealer (§4 Step 1, §12.2 #10) | ✅ BerriAI/litellm issue **#24512**, title: "[Security]: CRITICAL: Malicious `litellm_init.pth` in litellm 1.82.8 — credential stealer" (state: closed) |
| 21 | `ANTHROPIC_MODEL=nim-large` won't be rejected as an unrecognized model ID (§9.1, implicit) | ✅ The v2.1.200+ model-name validation "runs only on the Anthropic API… behind an LLM gateway or a custom `ANTHROPIC_BASE_URL`, your provider or gateway defines the model names, so Claude Code passes any string through without checking it" |
| 22 | Writing the env block to `~/.claude/settings.json` (not project settings) (§9.1) | ✅ **The design's choice is load-bearing and correct.** Docs: an `env` block in a project's `.claude/settings.json` / `settings.local.json` "applies only after the first-run wizard and trust prompt" — a project-scoped write would produce a login prompt despite a working gateway. Do not "improve" this into project scope. |

---

## 2. Corrections — the spec is wrong or stale here

### A. Version pin is stale, and the malicious releases are now gone from PyPI (§4 Step 1) — **fix before first run**

The spec says `<PINNED>` "must be ≥ 1.83." Current PyPI state as of today:

- **Latest stable: `1.93.0`** (uploaded 2026-07-19). Recent line: 1.91.2 → 1.91.3 → 1.92.0 → 1.93.0 → 1.91.4 / 1.92.1 (backports, 2026-07-19).
- **`1.82.7` and `1.82.8` are no longer present on PyPI** — the compromised releases have been removed.

Two consequences: set `<PINNED>` to `1.93.0` (or the latest at build time), and **keep the
refuse-to-proceed check anyway** — it now guards against a *locally cached or already-installed*
1.82.7/1.82.8, which is exactly the machine you most need to warn. Reframe the check's message from
"uninstall from PyPI" to "you have a compromised build installed locally: uninstall, rotate every
credential this machine has touched, and check for `litellm_init.pth` in your site-packages."

### B. The `fable` tier is missing from the model mapping (§9.1) — real functional gap

The Claude tier enum has grown. `anthropicFamilyTier` now accepts
`sonnet | opus | haiku | **fable** | **mythos**`, and Claude Code documents
`ANTHROPIC_DEFAULT_FABLE_MODEL` alongside the other three (v2.1.176+ for allowlist interaction).

The spec sets `ANTHROPIC_DEFAULT_{SONNET,OPUS,HAIKU}_MODEL` only. So a bare `fable` alias — via
`/model fable`, subagent frontmatter, or the Desktop Code tab — resolves to nothing routable. Add:

```
ANTHROPIC_DEFAULT_FABLE_MODEL = nim-large
```

Consider `CLAUDE_CODE_SUBAGENT_MODEL=nim-small` too: subagents, agent teams, and workflow agents
otherwise inherit normal resolution and can silently pull the expensive primary on every fan-out —
material against NIM's ~40 RPM free tier.

### C. The MCP tool-search key name is wrong, and the advice is more conservative than the docs (§5.2)

Spec: *"MCP tool search and other experimental betas are disabled by default on 3P — correct for
this proxy; don't enable `toolSearchEnabled`."*

There is no `toolSearchEnabled` key. The documented control is the environment variable
**`ENABLE_TOOL_SEARCH=true`**. And the reason it's off by default is that "most proxies do not
forward `tool_reference` content blocks" — with the docs naming **LiteLLM in passthrough mode** as
one of the two gateways that *does* forward them unchanged. So this is available, not forbidden.
Fix the key name; keep it off by default (one less variable while proving the chain out), and note
in the README that `ENABLE_TOOL_SEARCH=true` is a supported opt-in for this specific gateway.

### D. `nim-large` will not appear in the Claude Code `/model` picker (§9.1) — omission

`ANTHROPIC_MODEL=nim-large` routes correctly (see §1 item 21), but nothing puts the alias in the
`/model` picker, so a user who opens `/model` sees only built-in Claude entries and can silently
switch off the working config. Two documented levers:

- `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1` (v2.1.129+) — populates the picker from the
  gateway's `/v1/models`. **But the spec sets `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, which
  explicitly turns discovery off.** These two conflict; discovery is not the lever here.
- `ANTHROPIC_CUSTOM_MODEL_OPTION=nim-large` (+ optional `_NAME` / `_DESCRIPTION`) — adds one entry
  to the bottom of the picker, and "Claude Code skips validation for the model ID set in
  `ANTHROPIC_CUSTOM_MODEL_OPTION`." **This is the right lever.** Add:

```
ANTHROPIC_CUSTOM_MODEL_OPTION      = nim-large
ANTHROPIC_CUSTOM_MODEL_OPTION_NAME = NIM (primary)
```

---

## 3. Additions — new prerequisites and gotchas the spec predates

### E. New prereq check: Claude Code managed settings can hard-block gateway credentials

As of **v2.1.146**, managed settings containing `forceLoginMethod` or `forceLoginOrgUUID` **cannot
coexist** with `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or `apiKeyHelper`. The failure mode is
`This machine's managed settings require a first-party login`, and the only fixes are administrative
— the wizard cannot resolve it. Add to Step 1 prereqs: read
`/Library/Application Support/ClaudeCode/managed-settings.json`, and if either key is present, warn
loudly, skip the Claude Code configuration step, and continue with the proxy + Desktop path only.

*Checked on this machine: no managed-settings file present. Clear today.*

### F. New prereq check: a Desktop MDM profile makes the in-app 3P form read-only

"When a managed source is present, it wins and locally written values are ignored," and an
administrator-distributed configuration "takes precedence and makes this form read-only." If evolv
ever pushes `com.anthropic.claudefordesktop` via MDM, the entire §8 instruction block becomes
un-followable. Add a read-only check for
`/Library/Managed Preferences/com.anthropic.claudefordesktop.plist` (and the per-user variant) and
print a different message when it exists.

*Checked on this machine: no Anthropic/Claude MDM profile present. Clear today.*

### G. Desktop now has a documented **Export** path (worth mentioning, doesn't change the decision)

The in-app configuration window now has an **Export** button producing `.mobileconfig` (macOS) or
`.reg` (Windows). This does **not** invalidate §5.3's decision — a user wizard still shouldn't
install managed preferences — but it's worth one line in `DESKTOP-SETUP.md`: after filling the form
once, Export gives you a reproducible artifact for a second machine, instead of retyping the master
key. Note the corollary from item F: once installed as a profile, the form goes read-only.

### H. Two more gotchas for §12.2

- **`/fast` misreports under a bearer token.** With `ANTHROPIC_AUTH_TOKEN` set, the availability
  check requires a claude.ai login or Anthropic API key, so Claude Code reports *"Fast mode has been
  disabled by your organization"* without even sending the check. Fix:
  `CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK=1`. (Separately, `DISABLE_NONESSENTIAL_TRAFFIC=1` suppresses
  the availability check entirely, so `/fast` reports unavailable.) Users will read this as "the
  proxy broke Claude Code" — pre-empt it.
- **WebFetch still calls `api.anthropic.com`.** The WebFetch domain-safety preflight is not covered
  by `DISABLE_NONESSENTIAL_TRAFFIC`. Harmless on an open network; on restricted egress set
  `skipWebFetchPreflight: true`. One README line.

### I. Model-alias allowlist interaction (only if evolv sets `availableModels`)

If managed settings ever set `availableModels`, the `ANTHROPIC_DEFAULT_*_MODEL` variables "cannot
redirect an allowed alias to a model outside the list," and a custom model option is filtered from
the picker unless its ID is also in the allowlist. Not a v1 blocker; worth a sentence in the
troubleshooting section so a future corporate rollout doesn't debug this from scratch.

---

## 3b. Empirical result — Step 0 spike, run 2026-07-28 on the target Mac

`test/step0-spike.sh`, litellm **1.93.0** (`/Users/tonyturner/.local/bin/litellm`),
Node v26.5.0, pm2 7.0.3, against `mock-nim.mjs`. **The load-bearing premise of §1 is now confirmed
empirically, not just from docs:**

| Assertion | Result |
|---|---|
| litellm answered `/health/liveliness` | ✅ |
| Anthropic-format completion — `content[0].text`, `stop_reason` (§11.4) | ✅ `content="OK"` |
| `tool_use` block with parseable `input.city` (§11.5) | ✅ `city="Paris"` |
| Streaming emits `message_start` (§11.6) | ✅ 14 SSE lines |
| `claude-*` wildcard absorbs `claude-sonnet-4-6` (§11.8) | ✅ |

So load-bearing fact #1 in §1 ("LiteLLM's `/v1/messages` speaks Anthropic format for all providers,
including `nvidia_nim/*`") holds in practice, tool calling and streaming included, and §6.1's config
shape works as written. **The architecture is safe to build on.**

### Auth: resolved — the proxy is NOT open, but §11 check 2 was written wrong

The spike's unauthenticated probe returned **500**, not 401/403, raising the question of whether the
master key was being enforced at all. `step0b-auth-diagnostic.sh` settled it. Measured behaviour,
litellm 1.93.0:

| Probe | Observed | Meaning |
|---|---|---|
| correct key, `Authorization: Bearer` | `200` | happy path intact |
| correct key, `x-api-key` | `200` | **new finding** — LiteLLM accepts either header, so Desktop may use either `inferenceGatewayAuthScheme`. §8's `bearer` is fine; it just isn't the only option. |
| **wrong** key | `400 {"error":{"message":"No connected db.","type":"no_db_connection"}}` | **auth IS enforced.** LiteLLM rejects the key, then tries to resolve it as a *virtual key* and finds no database. Confusing wording, correct outcome. |
| **no** `Authorization` header | `500` | missing-header path raises rather than returning a clean 401 |

Identical across **both** the `os.environ/LITELLM_MASTER_KEY` form and a literal `master_key`.

Three consequences:

1. **§6.1 needs no change.** The `os.environ/` indirection *is* honoured for
   `general_settings.master_key`. `config.yaml` stays `0644`; secrets stay only in `litellm.env` at
   `0600`. This was the risk and it is cleared.
2. **§11 check 2 was wrong and is now fixed.** It asserted 401/403, which LiteLLM never returns — the
   check would have failed against a *correctly secured* proxy. Rev 3 rewrites it to probe with a
   **wrong key** and assert only "not a 2xx completion". A missing header can crash an auth path;
   only a wrong key answered with `200` proves there is no auth. `run-hermetic.sh` carried the same
   bad assertion and has been corrected too.
3. **New gotcha, §12.2 #14.** `400 No connected db.` is what a user sees when the gateway key is
   wrong — guaranteed the first time someone mistypes it into the Desktop form or lets Claude Code's
   `ANTHROPIC_AUTH_TOKEN` drift out of sync with `litellm.env`. It reads as a database problem and is
   not one. `status`/`test` must translate it, and nobody should "fix" it by attaching a database.

### §14 `api_base` question: closed

Upstream request log: **`POST /v1/chat/completions` ×4**. With `api_base: http://127.0.0.1:8080/v1`,
LiteLLM appends `/chat/completions` verbatim — so **api_base must include the `/v1` suffix**, matching
the hosted default `https://integrate.api.nvidia.com/v1`. The mock deliberately answers on both
`/v1/chat/completions` and `/chat/completions`, so this observation isolates what LiteLLM genuinely
does rather than what the mock tolerates. §6.1's conditional `api_base` line is now documented with
this constraint, and `DESIGN.md` §14 no longer carries an open research item.

*(The first spike run reported "nothing logged" because the script started the mock with
`MOCK_LOG=0` — a script bug, since fixed, not a property of the design.)*

## 4. Unverifiable without an NVIDIA key / build-time refresh

- **`RECOMMENDED_PRIMARY` / `RECOMMENDED_SMALL` constants (§3).** The spec already instructs the
  engineer to refresh these at build time against build.nvidia.com, and the runtime intersection
  against the live catalog makes stale entries harmless. Treated as by-design, not a defect — but do
  the refresh, and re-confirm `qwen/qwen3-coder-480b-a35b-instruct` is still the right default.
- **The claim that `/v1/models` doesn't expose function-calling support (§3).** Unverified without a
  key. The design's response — curated shortlist plus test-mode check 5 as the authority — is the
  right shape regardless of whether the endpoint gains a capability field.
- **`nvidia_nim` `api_base` override behavior for self-hosted NIM (§6.1).** The provider page
  confirms the prefix; the fetched section was truncated before the `api_base` table. Re-read
  https://docs.litellm.ai/docs/providers/nvidia_nim before implementing `--nim-base-url`.

---

## 5. This machine's actual prerequisite state (checked 2026-07-28)

| Prereq | Spec requirement | This machine |
|---|---|---|
| Node | ≥ 18 | **v26.5.0** ✅ |
| pm2 (global) | required | ❌ **not installed** — `npm install -g pm2` |
| litellm on PATH | required | ❌ **not installed** |
| `uv` (preferred litellm installer) | one of uv/pipx/pip | ✅ `/opt/homebrew/bin/uv` |
| pipx | fallback | absent (fine — uv present) |
| Claude Code | — | **2.1.204** ✅ (> 2.1.196, so the Remote Control note in §5.1 applies) |
| Claude Code managed settings | — | none ✅ (item E clear) |
| Desktop MDM profile | — | none ✅ (item F clear) |
| Local 3P config dir | — | not created yet (never configured) |

Both of the wizard's hard prerequisites fail on this machine today. That is the correct first
manual test (T-prereq): the wizard should exit 2 with the two install commands, not stack-trace.

---

## 6. Sources fetched for this pass (2026-07-28)

- https://claude.com/docs/third-party/claude-desktop/gateway
- https://claude.com/docs/third-party/claude-desktop/configuration
- https://code.claude.com/docs/en/llm-gateway-connect
- https://code.claude.com/docs/en/model-config
- https://docs.litellm.ai/docs/anthropic_unified
- https://docs.litellm.ai/docs/providers/nvidia_nim *(partially retrieved — see §4)*
- https://pypi.org/pypi/litellm/json *(version state)*
- https://github.com/BerriAI/litellm/issues/24512 *(via `gh api`; advisory title + state)*
- `evolvconsulting/nvidia-cowork` tree/branches/commit metadata *(via `gh api`)*

Provenance of the four items that don't appear in the two locally-cached doc dumps
(`model-config`, `3p/configuration`) — all four were read verbatim from the pages fetched in this
same pass, and are recorded here so a later reader can re-check them directly:

| Item | Page |
|---|---|
| `CLAUDE_CODE_SKIP_FAST_MODE_ORG_CHECK=1` | `code.claude.com/docs/en/llm-gateway-connect` → troubleshooting table |
| `skipWebFetchPreflight: true` *(settings key, not env var)* | `code.claude.com/docs/en/llm-gateway-connect` → "Turn off traffic outside the gateway path" |
| `forceLoginMethod` / `forceLoginOrgUUID` conflict (v2.1.146+) | `code.claude.com/docs/en/llm-gateway-connect` → troubleshooting table |
| `ENABLE_TOOL_SEARCH=true` *(Desktop 3P env var)* | `claude.com/docs/third-party/claude-desktop/gateway` → "MCP tool search" |

**Local copy integrity:** `DESIGN.md` in this folder is byte-identical to `dev` —
`sha256 7cc43004b14272a91fd3b86d32ae154613e2ff9ca03a9dec4c895d71f59cc9ad`, 639 lines, 33,556 bytes.
