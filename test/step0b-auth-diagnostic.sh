#!/usr/bin/env bash
# step0b-auth-diagnostic.sh — settle the one open question from the Step 0 spike.
#
#   cd /path/to/nvidia-cowork
#   bash test/step0b-auth-diagnostic.sh
#
# THE QUESTION: the spike's unauthenticated probe returned HTTP 500 instead of 401/403. Two very
# different explanations, with opposite consequences:
#
#   (a) BENIGN — the master key IS enforced, but LiteLLM's no-Authorization-header path raises
#       rather than returning a clean 401. Consequence: DESIGN.md §11 check 2 is written wrong
#       ("401/403 proves the master key is required") and would fail against a correct proxy.
#
#   (b) SERIOUS — general_settings.master_key never took effect, so the proxy is open. Anything on
#       the machine can spend the NVIDIA key. Consequence: §6.1 needs fixing before anything ships.
#
# The distinguishing probe is a WRONG key, not a missing one. A missing header can crash an auth
# path; a wrong key that gets a 200 means there is no auth at all.
#
# This also tests whether `master_key: os.environ/LITELLM_MASTER_KEY` (the §6.1 form) behaves the
# same as a literal value, which is the most likely mechanism if (b) turns out to be true.

set -uo pipefail

MOCK_PORT="${MOCK_PORT:-8080}"
PRIMARY="${PRIMARY:-qwen/qwen3-coder-480b-a35b-instruct}"
DIAG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nim-auth-diag.XXXXXX")"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MASTER_KEY="sk-litellm-diag-$(date +%s)"

c_ok=$'\033[32m'; c_no=$'\033[31m'; c_wa=$'\033[33m'; c_dim=$'\033[2m'; c_b=$'\033[1m'; c_off=$'\033[0m'

MOCK_PID=""; STARTED_MOCK=0; LITELLM_PID=""
cleanup() {
  [ -n "$LITELLM_PID" ] && kill "$LITELLM_PID" 2>/dev/null
  [ "$STARTED_MOCK" = 1 ] && [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null
  printf '\n%sArtifacts: %s%s\n' "$c_dim" "$DIAG_DIR" "$c_off"
}
trap cleanup EXIT

LITELLM_BIN="$(command -v litellm || true)"
[ -n "$LITELLM_BIN" ] || { echo "✗ litellm not on PATH"; exit 2; }

printf '%sAuth diagnostic — is the proxy actually open?%s\n\n' "$c_b" "$c_off"

# ── mock ────────────────────────────────────────────────────────────────────────────────────────
if curl -fsS "http://127.0.0.1:${MOCK_PORT}/__state" >/dev/null 2>&1; then
  printf 'mock NIM already on :%s\n' "$MOCK_PORT"
else
  PORT="$MOCK_PORT" MOCK_LOG=1 node "${HERE}/mock-nim.mjs" > "${DIAG_DIR}/mock.log" 2>&1 &
  MOCK_PID=$!; STARTED_MOCK=1
  for _ in $(seq 1 40); do curl -fsS "http://127.0.0.1:${MOCK_PORT}/__state" >/dev/null 2>&1 && break; sleep 0.25; done
  printf 'mock NIM started on :%s\n' "$MOCK_PORT"
fi

# probe <port> <label> <curl-args...>  -> echoes ONLY the status code on stdout.
# The human-readable line goes to stderr on purpose: an earlier version printed both to stdout, so
# `c=$(probe ...)` swallowed the display text into the variable and every comparison then ran against
# a multi-line string. If you touch this function, keep the two streams separate.
probe() {
  local port="$1" label="$2"; shift 2
  local out code body
  out="$(curl -s -w '\n%{http_code}' --max-time 30 -X POST "http://127.0.0.1:${port}/v1/messages" \
    -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' "$@" \
    -d '{"model":"nim-large","max_tokens":8,"messages":[{"role":"user","content":"hi"}]}' 2>&1)"
  code="$(printf '%s' "$out" | tail -1)"
  body="$(printf '%s' "$out" | sed '$d' | tr -d '\n' | cut -c1-150)"
  printf '    %-22s -> %-4s %s%s%s\n' "$label" "$code" "$c_dim" "$body" "$c_off" >&2
  printf '%s' "$code"
}

# run_case <name> <master_key_yaml_value> <extra-env>
run_case() {
  local name="$1" mk="$2" port="$3"
  printf '\n%s%s%s\n' "$c_b" "$name" "$c_off"

  cat > "${DIAG_DIR}/${name}.yaml" <<YAML
model_list:
  - model_name: nim-large
    litellm_params:
      model: nvidia_nim/${PRIMARY}
      api_key: os.environ/NVIDIA_NIM_API_KEY
      api_base: http://127.0.0.1:${MOCK_PORT}/v1

litellm_settings:
  drop_params: true

general_settings:
  master_key: ${mk}
YAML

  NVIDIA_NIM_API_KEY='nvapi-mock-not-a-real-credential' \
  LITELLM_MASTER_KEY="$MASTER_KEY" \
    "$LITELLM_BIN" --config "${DIAG_DIR}/${name}.yaml" --host 127.0.0.1 --port "$port" \
    > "${DIAG_DIR}/${name}.log" 2>&1 &
  LITELLM_PID=$!

  local up=0
  for _ in $(seq 1 60); do
    curl -fsS "http://127.0.0.1:${port}/health/liveliness" >/dev/null 2>&1 && { up=1; break; }
    kill -0 "$LITELLM_PID" 2>/dev/null || break
    sleep 2
  done
  [ "$up" = 1 ] || { printf '  %s✗ litellm did not start — see %s.log%s\n' "$c_no" "$name" "$c_off"; return 1; }

  local c_none c_wrong c_right c_xapi
  c_none="$(probe  "$port" 'no auth header')"
  c_wrong="$(probe "$port" 'wrong bearer key' -H 'Authorization: Bearer sk-definitely-wrong')"
  c_right="$(probe "$port" 'correct bearer key' -H "Authorization: Bearer ${MASTER_KEY}")"
  c_xapi="$(probe  "$port" 'correct x-api-key' -H "x-api-key: ${MASTER_KEY}")"

  printf '\n  Reading:\n'
  # The verdict rests on ONE question: was a wrong key answered with a completion?
  # Any non-2xx means it was rejected. LiteLLM's specific code is not the point — measured
  # behaviour is 400 "No connected db." (it rejects the key, then fails to resolve it as a virtual
  # key in a database that does not exist). Confusing wording, correct outcome.
  case "$c_wrong" in
    2*)
      printf '    %s✗ OPEN PROXY%s — a wrong key was ANSWERED (%s). master_key did not take effect.\n' "$c_no" "$c_off" "$c_wrong"
      printf '      Anything on this machine can spend the NVIDIA key. Fix §6.1 before shipping.\n' ;;
    *)
      printf '    %s✓ auth IS enforced%s — a wrong key was rejected (%s).\n' "$c_ok" "$c_off" "$c_wrong"
      case "$c_wrong" in
        400) printf '      %s"No connected db." is LiteLLM rejecting the key then failing to resolve it as a\n      virtual key. Expected. Document it as a gotcha (§12.2 #14) — users will hit it.%s\n' "$c_dim" "$c_off" ;;
        401|403) : ;;
        *) printf '      %sUnexpected code — worth reading %s/%s.log.%s\n' "$c_dim" "$DIAG_DIR" "$name" "$c_off" ;;
      esac
      case "$c_none" in
        401|403) : ;;
        *) printf '    %s⚠ a MISSING header returns %s, not 401/403.%s\n' "$c_wa" "$c_none" "$c_off"
           printf '      => §11 check 2 must assert "not a 2xx", never a specific 401/403.\n' ;;
      esac ;;
  esac

  case "$c_right" in
    2*) printf '    %s✓%s the correct key works (%s) — the happy path is intact.\n' "$c_ok" "$c_off" "$c_right" ;;
    *)  printf '    %s✗%s the correct key returned %s — something else is wrong.\n' "$c_no" "$c_off" "$c_right" ;;
  esac
  case "$c_xapi" in
    2*) printf '    %sℹ%s the master key is also accepted in x-api-key — so Desktop may use EITHER\n       inferenceGatewayAuthScheme (§8 specifies bearer; both work).\n' "$c_dim" "$c_off" ;;
    *)  printf '    %sℹ%s x-api-key returned %s — Desktop must use auth scheme "bearer" (as §8 specifies).\n' "$c_dim" "$c_off" "$c_xapi" ;;
  esac

  # `wait` after `kill` suppresses bash's "Terminated: 15" job-control noise.
  { kill "$LITELLM_PID" 2>/dev/null; wait "$LITELLM_PID" 2>/dev/null; } || true
  LITELLM_PID=""; sleep 2
}

# Case 1: the §6.1 form — master_key via os.environ indirection.
run_case 'env-indirection' 'os.environ/LITELLM_MASTER_KEY' 4121

# Case 2: a literal master_key. If case 1 is open and case 2 is closed, the bug is that
# `os.environ/` indirection is not honoured for general_settings.master_key — a one-line §6.1 fix
# (write the literal key into config.yaml, which then must be 0600 like litellm.env).
run_case 'literal-key' "$MASTER_KEY" 4122

# ── what LiteLLM actually called upstream (§14 open item) ───────────────────────────────────────
if [ -s "${DIAG_DIR}/mock.log" ]; then
  printf '\n%sUpstream URL shape (DESIGN.md §14 open item)%s\n' "$c_b" "$c_off"
  grep -oE '(GET|POST) /[^ ]+' "${DIAG_DIR}/mock.log" | sort | uniq -c | sed 's/^/    /'
  printf '    %sSet api_base in §6.1 to match. The mock answers both /v1/... and /... on purpose,%s\n' "$c_dim" "$c_off"
  printf '    %sso whichever appears here is what LiteLLM genuinely appends.%s\n' "$c_dim" "$c_off"
fi

cat <<EOF

${c_b}What to do with this${c_off}
  • wrong key rejected (any non-2xx) in BOTH cases -> the proxy is safe and os.environ/ indirection
    works. Keep §6.1 as written; config.yaml stays 0644 and secrets stay only in litellm.env.
  • wrong key ANSWERED in the env case but rejected in the literal case -> os.environ/ indirection is
    not honoured for general_settings.master_key. Inline the key in §6.1 AND tighten config.yaml from
    0644 to 0600, since it would then hold a secret.
  • wrong key ANSWERED in BOTH cases -> master_key is not being applied at all. Stop; §6.1 defect, and
    the proxy must not see a real NVIDIA key until it is fixed.

${c_dim}Result on this machine 2026-07-28 (litellm 1.93.0): first case — rejected with
400 "No connected db." in both configs. §6.1 confirmed, no change needed. Recorded in
VERIFICATION-2026-07-28.md §3b and as gotcha §12.2 #14.${c_off}
EOF
