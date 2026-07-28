# Test harness for `claude-nim-proxy`

Tier 1 of [`../docs/TESTING-STRATEGY.md`](../docs/TESTING-STRATEGY.md): a hermetic environment that is
**not your daily driver**, needs **no NVIDIA API key**, and can trigger every failure path in
`DESIGN.md` on demand.

## What's here

| File | Purpose |
|---|---|
| `step0-spike.sh` | **Run this first.** Proves the load-bearing premise of the spec before any implementation exists. |
| `step0b-auth-diagnostic.sh` | Settles whether the proxy's master key is actually enforced. |
| `mock-nim.mjs` | Zero-dependency fake NVIDIA NIM upstream with seven failure modes. |
| `run-hermetic.sh` | The assertion suite. Every check is labelled with the `DESIGN.md` section it covers. |
| `sandbox-run.sh` | Runs the wizard against a throwaway `$HOME`, then proves your real config was untouched. |
| `Dockerfile` + `docker-entrypoint.sh` | Isolated Linux container with pm2, litellm, and the mock preinstalled. |

CI lives at [`.github/workflows/hermetic.yml`](../.github/workflows/hermetic.yml).

## Order of operations

1. `bash test/step0-spike.sh` — is the architecture sound? (Already run: **yes**, 2026-07-28.)
2. Build `claude-nim-proxy.mjs` per [`../docs/HANDOFF-claude-nim-proxy.md`](../docs/HANDOFF-claude-nim-proxy.md).
3. `bash test/sandbox-run.sh -- node claude-nim-proxy.mjs setup …` — first run of the new CLI, safely.
4. `bash test/run-hermetic.sh` — the full suite, once there's something to assert against.

## Quick start

```bash
# from the repo root
docker build -t claude-nim-proxy-test -f test/Dockerfile .
docker run --rm -it claude-nim-proxy-test
# inside the container:
bash test/run-hermetic.sh
```

Your real `~/.claude/settings.json`, pm2 daemon, and Claude Desktop config are untouched — the
container has its own `$HOME` as a non-root user.

## Running safely on your own machine — `sandbox-run.sh`

If you don't have a spare machine and don't want to disturb your working Claude Code setup, you don't
need a VM. The wizard's only reach into your real home is the `env` block of
`~/.claude/settings.json`; overriding `$HOME` moves that — plus `~/.config/claude-nim-proxy` and
pm2's daemon directory — into a throwaway tree the process cannot escape.

```bash
bash test/sandbox-run.sh -- node claude-nim-proxy.mjs setup --yes \
  --nim-base-url http://127.0.0.1:8080/v1 --nim-api-key nvapi-mock \
  --model qwen/qwen3-coder-480b-a35b-instruct --small-model meta/llama-3.1-8b-instruct \
  --configure-cli

bash test/sandbox-run.sh --inspect   # what landed in the sandbox
bash test/sandbox-run.sh --verify    # re-check the real HOME
bash test/sandbox-run.sh --reset     # wipe and start clean
```

Note `--configure-cli` above: inside the sandbox that's the *interesting* path, not the dangerous
one — it's how you exercise the §9.1 settings merge against a real `settings.json` (the script seeds
one with `model` / `permissions` / `hooks` / unrelated `env` so the merge has something to preserve)
without risking yours.

It fingerprints seven paths in your real home before and after — `settings.json`,
`settings.local.json`, `.claude.json`, `.config/claude-nim-proxy`, `.pm2/dump.pm2`,
`.pm2/module_conf.json`, `Claude-3p/`, and the Desktop plist — and fails if any of them changed. It
also fails if the run creates `Claude-3p/` **anywhere**, sandbox included, since §5.3 forbids writing
Desktop 3P config at all.

`.pm2/dump.pm2` is watched rather than the whole `~/.pm2` directory on purpose: `dump.pm2` is what
`pm2 save` writes, so it answers "did this register an app in my *real* daemon?" without
false-positiving every time a running daemon rotates its own logs.

**What it does not cover:** Claude Desktop. Desktop reads its 3P configuration as the logged-in macOS
user regardless of what `$HOME` a shell has. For that, use a second macOS user account — separate
`~/Library/Application Support/Claude-3p/`, same hardware, no VM, and Cowork's local VM runs natively
rather than nested. See `../TESTING-STRATEGY.md`.

### Verified behaviour

The guard was tested against six cases, two of which it originally failed:

| Case | Result |
|---|---|
| Append to an existing file in a watched directory | ✗ CHANGED (correctly caught — **originally missed**) |
| Add a new file to a watched directory | ✗ CHANGED |
| Delete a file from a watched directory | ✗ CHANGED |
| Clobber a watched file | ✗ CHANGED |
| Well-behaved sandbox-only run | ✅ clean (no false positive) |
| Writes `Claude-3p/` inside the sandbox | ✅ clean + **SPEC VIOLATION** flagged |

The first version hashed directories by `name+size+mtime` via `stat`, which needed a BSD/GNU branch
and — because the format string got word-split into `stat`'s operands — quietly degenerated to names
only. It caught *added* files but not *edited* ones: a green check that meant nothing. It now hashes
file contents, which has no platform branch and no way to be silently wrong.

## The mock

`mock-nim.mjs` is a zero-dependency OpenAI-compatible stub. Two routes matter (`GET /v1/models`,
`POST /v1/chat/completions`); the rest is a control plane on `/__*` that lets one running instance
drive the whole failure matrix without a restart.

```bash
node test/mock-nim.mjs                                  # port 8080, mode ok, 127 models
curl -sX POST http://127.0.0.1:8080/__mode/no-tools     # switch modes live
curl -s http://127.0.0.1:8080/__state | jq              # request counters
```

| Mode | Simulates | Requirement it exercises |
|---|---|---|
| `ok` | healthy upstream | §11 checks 1–8 |
| `unauthorized` | rejected API key | §12.1 → re-prompt ×3, exit 2 |
| `empty-catalog` | valid key, no entitlements | §12.1 → exit 1 with the entitlements message |
| `no-tools` | model without function calling | **§11 check 5** → the model-swap verdict; manual T3 |
| `rate-limit` | 429 on every call | §12.2 #2 |
| `flaky` | 429 twice, then 200 | proves `num_retries: 2` absorbs blips |
| `slow` | 90s delay | §7.2 health-poll timeout, `API_TIMEOUT_MS` |

The `no-tools` mode is the important one. A NIM model without working function calling manifests as
Claude "doing nothing" — the failure users cannot self-diagnose, and the reason check 5 exists. It is
effectively impossible to trigger on demand against real NVIDIA.

The first six catalog IDs are the spec's `RECOMMENDED_PRIMARY` / `RECOMMENDED_SMALL` constants (§3),
so the wizard's live-catalog intersection yields the full shortlist. **If you change those constants
in the spec, change `CURATED` in the mock to match** — otherwise the picker shows fewer options and
you'll think the intersection logic is broken.

## Two things the Dockerfile deliberately does

1. **litellm lives in `/opt/litellm` and is not symlinked into `/usr/local/bin`.** This mirrors how
   `uv tool` / `pipx` isolate it on a real machine. To reproduce the PATH-divergence bug §6.2 guards
   against — pm2's daemon not seeing a `uv`-installed litellm — narrow the PATH at run time:

   ```bash
   docker run --rm -it -e PATH=/usr/local/bin:/usr/bin:/bin claude-nim-proxy-test
   ```

   The wizard must still work, because it resolves the absolute litellm path at generation time. If
   it breaks under that flag, §6.2 is not implemented.

2. **Non-root (`tester`).** File-mode assertions (`0700` config dir, `0600` `litellm.env`) are
   meaningless as root.

The build also **fails** if the pinned litellm resolves to 1.82.7 or 1.82.8 — the releases that
shipped a credential stealer. The pin is a security control, not hygiene.

## What `run-hermetic.sh` asserts

Every assertion is labelled with the `DESIGN.md` section it covers, so a failure names the regressed
requirement rather than just a line number. Nine groups: prerequisites, failure paths, happy path,
generated artifacts and modes, **secret hygiene (§13.7, mechanised rather than eyeballed)**, proxy
behaviour, `test` exit semantics, the `settings.json` merge, and `uninstall`.

Two assertions worth calling out because they encode rules that are easy to violate silently:

- **`run.sh` must never contain `0.0.0.0`** (§6.2) — the proxy fronts a paid API key behind a static
  master key on a personal machine.
- **The wizard must never write `~/Library/Application Support/Claude-3p/configLibrary/`** (§5.3).
  Asserted in the macOS CI job.

## CI

`hermetic.yml` has four jobs:

| Job | Runner | Upstream | When |
|---|---|---|---|
| `hermetic` | ubuntu | mock | every PR |
| `interactive` | ubuntu | mock | every PR — pty tests for the prompt path CI otherwise skips |
| `macos-paths` | macos | mock | every PR — the mac file/mode assertions a container can't cover |
| `real-upstream` | ubuntu | **real NIM** | nightly, key gated behind a GitHub environment |

The `real-upstream` job self-skips when `NVIDIA_NIM_API_KEY` isn't configured, so the workflow is
safe to merge before anyone provisions a key. When you do: use a **dedicated throwaway key**, gate it
behind an environment with required reviewers, and rotate it on a schedule.

Two jobs reference files that don't exist yet and emit a `::notice::` instead of failing —
`test/golden-check.sh` + `test/fixtures/` (golden-file checks, strategy C2) and
`test/interactive.expect` (pty tests, C3). Implement them when you get there.

## Verification status of this harness

Smoke-tested on Node v22.22.3 — `mock-nim.mjs` passes `node --check` and all nine of its own contract
checks: 127-model catalog with the six curated IDs and no duplicates, auth enforcement (401 without a
header), `Reply with exactly: OK` honoured, tool call returning `{"city":"Paris"}` parsed out of the
prompt with `finish_reason: tool_calls`, SSE streaming frames, all four failure modes switching live,
`flaky` returning 429/429/200, unknown model → 404, and an invalid mode → 400.

**Not yet verified end to end:** the full mock → LiteLLM → Anthropic-format chain, i.e. that LiteLLM
translates these OpenAI-shaped responses into `message_start` SSE events and `type: "tool_use"`
blocks. Installing litellm in this session exceeded the available time budget. The mock emits standard
OpenAI wire format and LiteLLM's `/v1/messages` support for all providers is documented, so the
translation should hold — but **treat "run `run-hermetic.sh` once and confirm groups 5 and 6 pass" as
the first task**, not an afterthought. If they fail, the likely cause is the `nvidia_nim` provider
needing `api_base` in a shape the mock doesn't serve (see `DESIGN.md` §14, the one open research
item), not the mock's response bodies.
