#!/usr/bin/env bash
# step0-spike.sh — prove the load-bearing premise of DESIGN.md before writing any wizard code.
#
#   cd /path/to/nvidia-cowork
#   bash test/step0-spike.sh
#
# THE QUESTION: does LiteLLM's /v1/messages endpoint really translate an `nvidia_nim/*` provider
# into Anthropic wire format, with tool use and streaming intact? Every decision in DESIGN.md rests
# on that (§1 "verified load-bearing facts" #1). The docs say all providers are supported; nobody has
# watched it happen against NIM. If it doesn't hold, the architecture needs rework — and any wizard
# code written first is wasted.
#
# This needs NO claude-nim-proxy.mjs, no NVIDIA key, and no credits. It hand-writes the minimal
# config.yaml from §6.1, runs litellm directly, and asserts four things:
#
#   1. Anthropic-format completion   -> content[0].text, stop_reason   (§11 check 4)
#   2. Tool calling                  -> a content block type:"tool_use" with input.city  (§11 check 5)
#   3. Streaming                      -> "message_start" in the SSE body  (§11 check 6)
#   4. claude-* wildcard              -> a concrete Anthropic model id routes  (§11 check 8)
#
# It also settles the one open research item in §14 — the `api_base` override for a non-hosted NIM —
# because pointing nvidia_nim at the mock IS that override path.
#
# Exit 0 = the design is sound, proceed to implementation. Exit 1 = stop and rethink §6.1.

set -uo pipefail

MOCK_PORT="${MOCK_PORT:-8080}"
PROXY_PORT="${PROXY_PORT:-4111}"          # deliberately not 4000, so this can't collide with a real install
PRIMARY="${PRIMARY:-qwen/qwen3-coder-480b-a35b-instruct}"
SMALL="${SMALL:-meta/llama-3.1-8b-instruct}"
SPIKE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nim-spike.XXXXXX")"
MASTER_KEY="sk-litellm-spike-$(date +%s)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

c_ok=$'\033[32m'; c_no=$'\033[31m'; c_wa=$'\033[33m'; c_dim=$'\033[2m'; c_b=$'\033[1m'; c_off=$'\033[0m'
pass=0; fail=0; warn=0
ok() { pass=$((pass+1)); printf '  %s✅%s %s\n' "$c_ok" "$c_off" "$1"; }
no() { fail=$((fail+1)); printf '  %s❌%s %s\n     %s%s%s\n' "$c_no" "$c_off" "$1" "$c_dim" "${2:-}" "$c_off"; }
# Bonus observations are NOT the premise. They must never gate the verdict — a proxy-config
# question is a follow-up, not grounds to rethink the architecture.
wa() { warn=$((warn+1)); printf '  %s⚠%s  %s\n     %s%s%s\n' "$c_wa" "$c_off" "$1" "$c_dim" "${2:-}" "$c_off"; }

MOCK_PID=""; LITELLM_PID=""; STARTED_MOCK=0
cleanup() {
  [ -n "$LITELLM_PID" ] && kill "$LITELLM_PID" 2>/dev/null
  [ "$STARTED_MOCK" = 1 ] && [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null
  printf '\n%sArtifacts kept for inspection: %s%s\n' "$c_dim" "$SPIKE_DIR" "$c_off"
}
trap cleanup EXIT

printf '%sStep 0 spike — does LiteLLM translate nvidia_nim into Anthropic format?%s\n\n' "$c_b" "$c_off"

# ── 0. prerequisites ────────────────────────────────────────────────────────────────────────────
LITELLM_BIN="$(command -v litellm || true)"
[ -n "$LITELLM_BIN" ] || { echo "✗ litellm not on PATH. See PREREQ-INSTALL.md"; exit 2; }
LITELLM_VER="$(litellm --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
case "$LITELLM_VER" in
  1.82.7|1.82.8) echo "✗ litellm $LITELLM_VER is a known-compromised release. Uninstall and rotate credentials."; exit 2 ;;
esac
printf 'litellm %s at %s\n' "$LITELLM_VER" "$LITELLM_BIN"
printf 'node    %s\n\n' "$(node --version)"

# ── 1. mock NIM ─────────────────────────────────────────────────────────────────────────────────
if curl -fsS "http://127.0.0.1:${MOCK_PORT}/__state" >/dev/null 2>&1; then
  printf 'mock NIM already listening on :%s\n' "$MOCK_PORT"
else
  # MOCK_LOG=1 — request logging must stay ON here, it is how the api_base question gets answered.
  PORT="$MOCK_PORT" MOCK_LOG=1 node "${HERE}/mock-nim.mjs" > "${SPIKE_DIR}/mock.log" 2>&1 &
  MOCK_PID=$!; STARTED_MOCK=1
  for _ in $(seq 1 40); do curl -fsS "http://127.0.0.1:${MOCK_PORT}/__state" >/dev/null 2>&1 && break; sleep 0.25; done
  curl -fsS "http://127.0.0.1:${MOCK_PORT}/__state" >/dev/null 2>&1 \
    || { echo "✗ mock-nim failed to start:"; cat "${SPIKE_DIR}/mock.log"; exit 1; }
  printf 'mock NIM started on :%s (pid %s)\n' "$MOCK_PORT" "$MOCK_PID"
fi
curl -sX POST "http://127.0.0.1:${MOCK_PORT}/__mode/ok" >/dev/null

# ── 2. the minimal config from DESIGN.md §6.1 ───────────────────────────────────────────────────
# api_base is the §14 open question. The mock answers on BOTH /v1/chat/completions and
# /chat/completions, so this succeeds whether LiteLLM appends /v1 or not — which is the point:
# it isolates "does the translation work" from "is the URL shape right". If the spike passes,
# check mock.log to see which path LiteLLM actually called, and match api_base in §6.1 to that.
cat > "${SPIKE_DIR}/config.yaml" <<YAML
model_list:
  - model_name: nim-large
    litellm_params:
      model: nvidia_nim/${PRIMARY}
      api_key: os.environ/NVIDIA_NIM_API_KEY
      api_base: http://127.0.0.1:${MOCK_PORT}/v1

  - model_name: nim-small
    litellm_params:
      model: nvidia_nim/${SMALL}
      api_key: os.environ/NVIDIA_NIM_API_KEY
      api_base: http://127.0.0.1:${MOCK_PORT}/v1

  - model_name: "claude-*"
    litellm_params:
      model: nvidia_nim/${PRIMARY}
      api_key: os.environ/NVIDIA_NIM_API_KEY
      api_base: http://127.0.0.1:${MOCK_PORT}/v1

litellm_settings:
  drop_params: true
  num_retries: 2
  request_timeout: 600

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
YAML

# ── 3. run litellm ──────────────────────────────────────────────────────────────────────────────
printf 'starting litellm on :%s ' "$PROXY_PORT"
NVIDIA_NIM_API_KEY='nvapi-mock-not-a-real-credential' \
LITELLM_MASTER_KEY="$MASTER_KEY" \
  "$LITELLM_BIN" --config "${SPIKE_DIR}/config.yaml" --host 127.0.0.1 --port "$PROXY_PORT" \
  > "${SPIKE_DIR}/litellm.log" 2>&1 &
LITELLM_PID=$!

# Cold start is slow (schema build) — DESIGN.md §7.2 allows 60s; give it 120 here.
alive=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PROXY_PORT}/health/liveliness" >/dev/null 2>&1; then alive=1; break; fi
  kill -0 "$LITELLM_PID" 2>/dev/null || break
  printf '.'; sleep 2
done
printf '\n'
if [ "$alive" != 1 ]; then
  no "litellm came up" "see ${SPIKE_DIR}/litellm.log"
  printf '\n%s--- last 40 lines of litellm.log ---%s\n' "$c_dim" "$c_off"
  tail -40 "${SPIKE_DIR}/litellm.log"
  exit 1
fi
ok "litellm answered /health/liveliness"

msg() { # msg <json-body>
  curl -s --max-time 60 -X POST "http://127.0.0.1:${PROXY_PORT}/v1/messages" \
    -H "Authorization: Bearer ${MASTER_KEY}" \
    -H 'anthropic-version: 2023-06-01' \
    -H 'content-type: application/json' \
    -d "$1"
}

printf '\n%sThe four assertions%s\n' "$c_b" "$c_off"

# ── A1. Anthropic-format completion (§11 check 4) ───────────────────────────────────────────────
r="$(msg '{"model":"nim-large","max_tokens":64,"messages":[{"role":"user","content":"Reply with exactly: OK"}]}')"
printf '%s' "$r" > "${SPIKE_DIR}/a1-completion.json"
if printf '%s' "$r" | grep -q '"stop_reason"' && printf '%s' "$r" | grep -q '"type":[[:space:]]*"text"'; then
  txt="$(printf '%s' "$r" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["content"][0].get("text",""))' 2>/dev/null)"
  ok "Anthropic-format completion  [§11.4]  content=\"${txt}\""
else
  no "Anthropic-format completion  [§11.4]" "$(printf '%s' "$r" | head -c 300)"
fi

# ── A2. Tool calling (§11 check 5) — the single most valuable check ──────────────────────────────
r="$(msg '{"model":"nim-large","max_tokens":128,
 "tools":[{"name":"get_weather","description":"Get weather for a city","input_schema":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}],
 "messages":[{"role":"user","content":"What is the weather in Paris? Use the tool."}]}')"
printf '%s' "$r" > "${SPIKE_DIR}/a2-tool-use.json"
city="$(printf '%s' "$r" | python3 -c '
import sys,json
try:
    d=json.load(sys.stdin)
    for b in d.get("content",[]):
        if b.get("type")=="tool_use":
            print(b.get("input",{}).get("city","")); break
except Exception: pass' 2>/dev/null)"
if [ -n "$city" ]; then
  ok "tool_use block with parseable input.city  [§11.5]  city=\"${city}\""
else
  no "tool_use block with parseable input.city  [§11.5]" "$(printf '%s' "$r" | head -c 300)"
fi

# ── A3. Streaming (§11 check 6) ──────────────────────────────────────────────────────────────────
s="$(curl -s -N --max-time 60 -X POST "http://127.0.0.1:${PROXY_PORT}/v1/messages" \
  -H "Authorization: Bearer ${MASTER_KEY}" -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' \
  -d '{"model":"nim-large","max_tokens":32,"stream":true,"messages":[{"role":"user","content":"Reply with exactly: OK"}]}')"
printf '%s' "$s" > "${SPIKE_DIR}/a3-stream.sse"
if printf '%s' "$s" | grep -q 'message_start'; then
  ok "streaming emits message_start  [§11.6]  ($(printf '%s' "$s" | grep -c '^event:\|^data:') SSE lines)"
else
  no "streaming emits message_start  [§11.6]" "$(printf '%s' "$s" | head -c 300)"
fi

# ── A4. claude-* wildcard (§11 check 8) ──────────────────────────────────────────────────────────
r="$(msg '{"model":"claude-sonnet-4-6","max_tokens":32,"messages":[{"role":"user","content":"Reply with exactly: OK"}]}')"
printf '%s' "$r" > "${SPIKE_DIR}/a4-wildcard.json"
if printf '%s' "$r" | grep -q '"content"' && ! printf '%s' "$r" | grep -qi '"error"'; then
  ok "claude-* wildcard absorbs a concrete Anthropic id  [§11.8]"
else
  no "claude-* wildcard absorbs a concrete Anthropic id  [§11.8]" "$(printf '%s' "$r" | head -c 300)"
fi

# ── bonus observations — informational only, never gate the verdict ──────────────────────────────
printf '\n%sBonus observations%s %s(do not gate the premise)%s\n' "$c_b" "$c_off" "$c_dim" "$c_off"

# Auth. Two distinct probes, because "no header" and "wrong key" exercise different LiteLLM paths and
# only the second one proves whether the proxy is actually open. A 500 on the no-header path is a
# LiteLLM quirk, not evidence of an open proxy — see step0b-auth-diagnostic.sh.
no_hdr="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 -X POST "http://127.0.0.1:${PROXY_PORT}/v1/messages" \
  -H 'content-type: application/json' -d '{"model":"nim-large","max_tokens":8,"messages":[{"role":"user","content":"hi"}]}')"
bad_key="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 -X POST "http://127.0.0.1:${PROXY_PORT}/v1/messages" \
  -H 'Authorization: Bearer sk-definitely-not-the-master-key' -H 'anthropic-version: 2023-06-01' \
  -H 'content-type: application/json' -d '{"model":"nim-large","max_tokens":8,"messages":[{"role":"user","content":"hi"}]}')"

printf '  %sℹ%s  no auth header -> %s   wrong key -> %s\n' "$c_dim" "$c_off" "$no_hdr" "$bad_key"
case "$bad_key" in
  401|403)
    if [ "$no_hdr" = 401 ] || [ "$no_hdr" = 403 ]; then
      ok "master key is enforced  [§11.2]  (both probes rejected)"
    else
      wa "master key IS enforced, but the no-header path returns $no_hdr not 401/403" \
         "§11 check 2 as written would fail against a correctly-configured proxy. Assert on the wrong-key probe instead, or accept $no_hdr."
    fi ;;
  200)
    no "master key is enforced  [§11.2]" "a WRONG key was accepted — the proxy is genuinely open. Do not proceed until §6.1's master_key works." ;;
  *)
    wa "auth status inconclusive (wrong key -> $bad_key)" "run: bash test/step0b-auth-diagnostic.sh" ;;
esac

# Which upstream URL shape did LiteLLM actually call? This is the §14 open item.
if [ "$STARTED_MOCK" = 1 ] && [ -s "${SPIKE_DIR}/mock.log" ]; then
  paths="$(grep -oE '(GET|POST) /[^ ]+' "${SPIKE_DIR}/mock.log" | sort -u | tr '\n' ';' | sed 's/;/  /g')"
  if [ -n "$paths" ]; then
    printf '  %sℹ%s  LiteLLM called the mock at: %s\n' "$c_dim" "$c_off" "$paths"
    printf '     %sSet api_base in DESIGN.md §6.1 to match whichever /v1 shape appears here (§14 open item).%s\n' "$c_dim" "$c_off"
  else
    wa "could not determine the upstream URL shape" "mock.log had no request lines — is MOCK_LOG=1?"
  fi
elif [ "$STARTED_MOCK" != 1 ]; then
  wa "upstream URL shape not observed" "a mock was already running, so its log isn't in ${SPIKE_DIR}. Kill it and re-run to answer the §14 api_base question."
fi

# ── verdict ─────────────────────────────────────────────────────────────────────────────────────
printf '\n%sVerdict%s  %s%d passed%s  %s%d failed%s  %s%d warning%s\n' \
  "$c_b" "$c_off" "$c_ok" "$pass" "$c_off" "$c_no" "$fail" "$c_off" "$c_wa" "$warn" "$c_off"

if [ "$fail" -eq 0 ]; then
  printf '\n%s%sThe premise holds.%s LiteLLM translates nvidia_nim into Anthropic format with tool use\nand streaming intact. DESIGN.md §6.1 is sound and the architecture is safe to build on.\n' \
    "$c_ok" "$c_b" "$c_off"
  if [ "$warn" -gt 0 ]; then
    printf '\n%d warning(s) above — follow-ups, not blockers. Next: bash test/step0b-auth-diagnostic.sh\n' "$warn"
  fi
  printf '\nThen: commit rev 3 + the harness to a branch, and hand Phase 1 of\nHANDOFF-claude-nim-proxy.md to Claude Code.\n'
  exit 0
else
  cat <<EOF

${c_no}${c_b}A core assertion failed — stop and rethink §6.1.${c_off} Read ${SPIKE_DIR}/litellm.log and the
saved response bodies in that directory before writing wizard code.

Most likely causes, in order:
  1. api_base shape — check the paths LiteLLM called above; try with and without the /v1 suffix.
  2. The nvidia_nim provider not accepting a custom api_base at all (the §14 open item).
  3. Anthropic-format tool translation being provider-gated rather than universal, which would
     contradict the docs and invalidate load-bearing fact #1 in §1.
EOF
  exit 1
fi
