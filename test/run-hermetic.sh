#!/usr/bin/env bash
# run-hermetic.sh — the hermetic suite: drives claude-nim-proxy against mock-nim through every
# failure mode and asserts the exit codes and behaviours DESIGN.md promises.
#
# Designed to run inside the test container (mock-nim already listening) or anywhere mock-nim is
# reachable. Exit 0 = all assertions held.
#
#   bash test/run-hermetic.sh
#
# Assertions map 1:1 to DESIGN.md §11 (test-mode checks), §12.1 (error cases), and §13 (acceptance
# criteria + manual matrix T1-T9). Each case names the section it covers so a failure tells you
# which requirement regressed.

set -uo pipefail

MOCK_PORT="${MOCK_PORT:-8080}"
MOCK="http://127.0.0.1:${MOCK_PORT}"
NIM_BASE_URL="${NIM_BASE_URL:-${MOCK}/v1}"
CLI="${CLI:-node claude-nim-proxy.mjs}"
PRIMARY="${PRIMARY:-qwen/qwen3-coder-480b-a35b-instruct}"
SMALL="${SMALL:-meta/llama-3.1-8b-instruct}"
CONFIG_DIR="$HOME/.config/claude-nim-proxy"

pass=0; fail=0; skip=0
c_ok=$'\033[32m'; c_no=$'\033[31m'; c_sk=$'\033[33m'; c_off=$'\033[0m'

ok()   { pass=$((pass+1)); printf '  %s✅%s %s\n' "$c_ok" "$c_off" "$1"; }
no()   { fail=$((fail+1)); printf '  %s❌%s %s\n     %s\n' "$c_no" "$c_off" "$1" "${2:-}"; }
sk()   { skip=$((skip+1)); printf '  %s⊘%s  %s (%s)\n' "$c_sk" "$c_off" "$1" "${2:-skipped}"; }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

mode()  { curl -fsS -X POST "${MOCK}/__mode/$1" >/dev/null || { echo "cannot reach mock at $MOCK"; exit 1; }; }
reset() { curl -fsS -X POST "${MOCK}/__reset" >/dev/null; }

# expect_exit <expected> <label> <section> <cmd...>
expect_exit() {
  local want="$1" label="$2" sect="$3"; shift 3
  local out; out="$("$@" 2>&1)"; local got=$?
  if [ "$got" -eq "$want" ]; then ok "$label  [$sect]"
  else no "$label  [$sect]" "expected exit $want, got $got — last line: $(printf '%s' "$out" | tail -1)"
  fi
}

teardown() {
  pm2 delete litellm-nim >/dev/null 2>&1 || true
  rm -rf "$CONFIG_DIR"
}

printf '\033[1mclaude-nim-proxy — hermetic suite\033[0m  mock=%s\n' "$MOCK"
curl -fsS "${MOCK}/__state" >/dev/null 2>&1 || { echo "✗ mock-nim not reachable at $MOCK"; exit 1; }

# ─────────────────────────────────────────────────────────────────────────────
head_ "0. Preconditions"
command -v pm2   >/dev/null && ok "pm2 present  [§4 Step 1]"      || no "pm2 present  [§4 Step 1]" "install: npm i -g pm2"
command -v litellm >/dev/null && ok "litellm on PATH  [§4 Step 1]" || sk "litellm on PATH  [§4 Step 1]" "expected if you narrowed PATH deliberately"
lv="$(litellm --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
case "$lv" in
  1.82.7|1.82.8) no "litellm not a compromised release  [§4 Step 1]" "found $lv — uninstall and rotate credentials" ;;
  '')            sk "litellm version readable  [§4 Step 1]" "could not parse" ;;
  *)             ok "litellm $lv not a compromised release  [§4 Step 1]" ;;
esac

# ─────────────────────────────────────────────────────────────────────────────
head_ "1. Failure paths (the reason the mock exists)"
teardown

mode unauthorized
expect_exit 2 "NIM 401 on key validation exits 2" "§12.1" \
  $CLI setup --yes --nim-base-url "$NIM_BASE_URL" --nim-api-key nvapi-bad --model "$PRIMARY" --small-model "$SMALL" --no-cli

mode empty-catalog
expect_exit 1 "empty model list exits 1" "§12.1" \
  $CLI setup --yes --nim-base-url "$NIM_BASE_URL" --nim-api-key nvapi-mock --model "$PRIMARY" --small-model "$SMALL" --no-cli

mode ok
expect_exit 1 "unknown --model exits 1 with near-matches" "§12.1 / T-model" \
  $CLI setup --yes --nim-base-url "$NIM_BASE_URL" --nim-api-key nvapi-mock --model bogus/not-a-model --small-model "$SMALL" --no-cli

# ─────────────────────────────────────────────────────────────────────────────
head_ "2. Happy path, fully non-interactive"
reset; mode ok; teardown
expect_exit 0 "non-interactive setup completes with zero prompts" "§13.2" \
  $CLI setup --yes --nim-base-url "$NIM_BASE_URL" --nim-api-key nvapi-mock --model "$PRIMARY" --small-model "$SMALL" --no-cli

# ─────────────────────────────────────────────────────────────────────────────
head_ "3. Generated artifacts"
if [ -d "$CONFIG_DIR" ]; then
  m() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null; }
  [ "$(m "$CONFIG_DIR")"            = 700 ] && ok "config dir is 0700  [§2]"       || no "config dir is 0700  [§2]" "got $(m "$CONFIG_DIR")"
  [ "$(m "$CONFIG_DIR/litellm.env")" = 600 ] && ok "litellm.env is 0600  [§2]"      || no "litellm.env is 0600  [§2]" "got $(m "$CONFIG_DIR/litellm.env")"
  [ "$(m "$CONFIG_DIR/run.sh")"      = 700 ] && ok "run.sh is 0700  [§2]"           || no "run.sh is 0700  [§2]" "got $(m "$CONFIG_DIR/run.sh")"
  for f in config.yaml litellm.env run.sh ecosystem.config.cjs manifest.json DESKTOP-SETUP.md; do
    [ -f "$CONFIG_DIR/$f" ] && ok "generated $f  [§2]" || no "generated $f  [§2]" "missing"
  done
  grep -q 'drop_params: true'   "$CONFIG_DIR/config.yaml" && ok "drop_params: true present  [§6.1]"   || no "drop_params: true present  [§6.1]" "mandatory"
  grep -q 'host 127.0.0.1\|--host 127.0.0.1' "$CONFIG_DIR/run.sh" && ok "run.sh binds 127.0.0.1  [§6.2]" || no "run.sh binds 127.0.0.1  [§6.2]" "must never be 0.0.0.0"
  # Strip comments first: run.sh legitimately CONTAINS the string 0.0.0.0 in the comment explaining
  # why it must never bind to it. A naive grep fails a correct file, and an assertion that cries
  # wolf on correct code is worse than no assertion.
  if grep -v '^[[:space:]]*#' "$CONFIG_DIR/run.sh" | grep -q '0\.0\.0\.0'; then
    no "run.sh never binds 0.0.0.0  [§6.2]" "found 0.0.0.0 outside a comment"
  else
    ok "run.sh never binds 0.0.0.0  [§6.2]"
  fi
  grep -qE '^exec .*/litellm|^exec /' "$CONFIG_DIR/run.sh" && ok "run.sh execs an absolute litellm path  [§6.2]" || no "run.sh execs an absolute litellm path  [§6.2]" "bare name breaks under pm2's PATH"
  MASTER="$(grep -oE 'sk-litellm-[0-9a-f]+' "$CONFIG_DIR/litellm.env" | head -1 || true)"
  [ -n "$MASTER" ] && ok "master key generated  [§4 Step 4]" || no "master key generated  [§4 Step 4]" "not found in litellm.env"
else
  no "config dir exists  [§2]" "setup did not produce $CONFIG_DIR"
  MASTER=""
fi

# ─────────────────────────────────────────────────────────────────────────────
head_ "4. Secret hygiene (§13.7 — mechanised, not eyeballed)"
if [ -n "${MASTER:-}" ]; then
  grep -rqs "$MASTER" "$HOME/.pm2" 2>/dev/null && no "master key absent from ~/.pm2  [§13.7]" "leaked into pm2 files" || ok "master key absent from ~/.pm2  [§13.7]"
  grep -rqs "nvapi-mock" "$HOME/.pm2" 2>/dev/null && no "NIM key absent from ~/.pm2  [§13.7]" "leaked into pm2 files" || ok "NIM key absent from ~/.pm2  [§13.7]"
  grep -qs "$MASTER" "$CONFIG_DIR/ecosystem.config.cjs" && no "no secret in ecosystem.config.cjs  [§13.7]" "leaked" || ok "no secret in ecosystem.config.cjs  [§13.7]"
  # Snapshot ps to a file FIRST, then search the file. Piping `ps axww | grep "$MASTER"` makes the
  # grep process itself carry the key in its own argv, so ps sees it and the check fails against a
  # perfectly clean system — the assertion detecting itself.
  ps axww > /tmp/cnp-ps-snapshot.$$ 2>/dev/null || true
  if grep -q "$MASTER" /tmp/cnp-ps-snapshot.$$ 2>/dev/null; then
    no "no secret in process argv  [§13.7]" "visible in ps axww"
  else
    ok "no secret in process argv  [§13.7]"
  fi
  rm -f /tmp/cnp-ps-snapshot.$$
  wide="$(find "$CONFIG_DIR" -type f -perm /066 2>/dev/null | grep -v -e 'config.yaml' -e 'ecosystem.config.cjs' -e 'manifest.json' -e 'DESKTOP-SETUP.md' || true)"
  [ -z "$wide" ] && ok "no secret-bearing file wider than 0600  [§13.7]" || no "no secret-bearing file wider than 0600  [§13.7]" "$wide"
else
  sk "secret hygiene block  [§13.7]" "no master key to search for"
fi

# ─────────────────────────────────────────────────────────────────────────────
head_ "5. Proxy behaviour"
PORT_N="$(grep -oE '"port": *[0-9]+' "$CONFIG_DIR/manifest.json" 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo 4000)"
PROXY="http://127.0.0.1:${PORT_N}"
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

[ "$(code "${PROXY}/health/liveliness")" = 200 ] && ok "proxy alive  [§11.1]" || no "proxy alive  [§11.1]" "no 200 from /health/liveliness"

# MEASURED 2026-07-28 (litellm 1.93.0): a wrong key returns 400 "No connected db.", a missing header
# returns 500 — never 401/403. Asserting 401/403 here would fail against a CORRECTLY secured proxy.
# What matters is that a bad key is not answered with a completion. See DESIGN.md §11 check 2 note.
badkey="$(code -X POST "${PROXY}/v1/messages" -H 'Authorization: Bearer sk-definitely-not-the-master-key' \
  -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' \
  -d '{"model":"nim-large","max_tokens":8,"messages":[{"role":"user","content":"hi"}]}')"
case "$badkey" in
  2*) no "a wrong key is rejected  [§11.2]" "got $badkey — THE PROXY IS OPEN; anything on this machine can spend the NVIDIA key" ;;
  *)  ok "a wrong key is rejected  [§11.2]  (got $badkey)" ;;
esac
nohdr="$(code -X POST "${PROXY}/v1/messages" -H 'content-type: application/json' \
  -d '{"model":"nim-large","max_tokens":8,"messages":[{"role":"user","content":"hi"}]}')"
case "$nohdr" in
  2*) no "a missing auth header is rejected  [§11.2]" "got $nohdr — the proxy answered an unauthenticated request" ;;
  *)  ok "a missing auth header is rejected  [§11.2]  (got $nohdr)" ;;
esac

msg() { # msg <model> <extra-json>
  curl -s -X POST "${PROXY}/v1/messages" \
    -H "Authorization: Bearer ${MASTER}" -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' \
    -d "{\"model\":\"$1\",\"max_tokens\":64,\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: OK\"}]${2:+,$2}}"
}

r="$(msg nim-large)"
printf '%s' "$r" | grep -q '"stop_reason"' && printf '%s' "$r" | grep -q '"text"' \
  && ok "Anthropic-format completion  [§11.4]" || no "Anthropic-format completion  [§11.4]" "$(printf '%s' "$r" | head -c 200)"

printf '%s' "$(msg nim-small)"        | grep -q '"content"' && ok "small model works  [§11.7]"     || no "small model works  [§11.7]" "nim-small did not answer"
printf '%s' "$(msg claude-sonnet-4-6)" | grep -q '"content"' && ok "claude-* wildcard routes  [§11.8]" || no "claude-* wildcard routes  [§11.8]" "wildcard missing from config.yaml"

s="$(curl -s -N -X POST "${PROXY}/v1/messages" -H "Authorization: Bearer ${MASTER}" \
  -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' \
  -d '{"model":"nim-large","max_tokens":32,"stream":true,"messages":[{"role":"user","content":"Reply with exactly: OK"}]}')"
printf '%s' "$s" | grep -q 'message_start' && ok "streaming emits message_start  [§11.6]" || no "streaming emits message_start  [§11.6]" "no message_start in SSE body"

TOOLS='"tools":[{"name":"get_weather","description":"Get weather for a city","input_schema":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}]'
toolreq() {
  curl -s -X POST "${PROXY}/v1/messages" -H "Authorization: Bearer ${MASTER}" \
    -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' \
    -d "{\"model\":\"nim-large\",\"max_tokens\":128,${TOOLS},\"messages\":[{\"role\":\"user\",\"content\":\"What is the weather in Paris? Use the tool.\"}]}"
}
t="$(toolreq)"
printf '%s' "$t" | grep -q '"type":"tool_use"' && printf '%s' "$t" | grep -q 'Paris' \
  && ok "tool calling returns a parseable tool_use  [§11.5]" || no "tool calling returns a parseable tool_use  [§11.5]" "$(printf '%s' "$t" | head -c 200)"

# ─────────────────────────────────────────────────────────────────────────────
head_ "6. test subcommand exit semantics (§13.6)"
mode ok
expect_exit 0 "test exits 0 when everything is healthy" "§11 / §13.6" $CLI test

mode no-tools
expect_exit 4 "test exits 4 when the model lacks tool calling" "§11.5 / T3 / §13.6" $CLI test
out="$($CLI test 2>&1 || true)"
printf '%s' "$out" | grep -qi 'does not reliably support tool calling' \
  && ok "check-5 failure prints the model-swap verdict  [§11]" || no "check-5 failure prints the model-swap verdict  [§11]" "verdict wording missing"

mode unauthorized
expect_exit 4 "test exits 4 on a rejected NIM key" "§11.3 / §13.6" $CLI test

mode flaky
expect_exit 0 "num_retries absorbs transient 429s" "§12.2 #2" $CLI test

mode ok
pm2 stop litellm-nim >/dev/null 2>&1 || true
expect_exit 4 "test exits 4 when the proxy is stopped" "§11.1 / §13.6" $CLI test
pm2 start litellm-nim >/dev/null 2>&1 || true
sleep 5

# ─────────────────────────────────────────────────────────────────────────────
head_ "7. Idempotence and pm2 resurrection"
before="$MASTER"
$CLI setup --yes --nim-base-url "$NIM_BASE_URL" --nim-api-key nvapi-mock --model "$SMALL" --small-model "$SMALL" --no-cli >/dev/null 2>&1
after="$(grep -oE 'sk-litellm-[0-9a-f]+' "$CONFIG_DIR/litellm.env" | head -1 || true)"
[ -n "$before" ] && [ "$before" = "$after" ] && ok "re-running setup preserves the master key  [§13.4]" || no "re-running setup preserves the master key  [§13.4]" "key changed — clients would break"

pm2 kill >/dev/null 2>&1; pm2 resurrect >/dev/null 2>&1; sleep 8
[ "$(code "${PROXY}/health/liveliness")" = 200 ] && ok "proxy returns after pm2 daemon restart  [§13.3]" || no "proxy returns after pm2 daemon restart  [§13.3]" "pm2 save not persisting the app"

# ─────────────────────────────────────────────────────────────────────────────
head_ "8. settings.json merge (§9.1) — the delicate one"
SETTINGS="$HOME/.claude/settings.json"
mkdir -p "$HOME/.claude"
cat > "$SETTINGS" <<'JSON'
{
  "model": "sonnet",
  "permissions": { "deny": ["Bash(rm -rf *)"] },
  "hooks": { "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "echo hi" }] }] },
  "env": { "MY_UNRELATED_VAR": "keep-me" }
}
JSON
$CLI setup --yes --nim-base-url "$NIM_BASE_URL" --nim-api-key nvapi-mock --model "$PRIMARY" --small-model "$SMALL" --configure-cli >/dev/null 2>&1
if command -v jq >/dev/null; then
  [ "$(jq -r '.permissions.deny[0]' "$SETTINGS")" = 'Bash(rm -rf *)' ] && ok "permissions preserved  [§9.1.2]" || no "permissions preserved  [§9.1.2]" "clobbered"
  [ "$(jq -r '.hooks.PreToolUse[0].matcher' "$SETTINGS")" = 'Bash' ]   && ok "hooks preserved  [§9.1.2]"       || no "hooks preserved  [§9.1.2]" "clobbered"
  [ "$(jq -r '.env.MY_UNRELATED_VAR' "$SETTINGS")" = 'keep-me' ]       && ok "unrelated env preserved  [§9.1.2]" || no "unrelated env preserved  [§9.1.2]" "clobbered"
  [ "$(jq -r '.env.ANTHROPIC_BASE_URL' "$SETTINGS")" = "$PROXY" ]      && ok "ANTHROPIC_BASE_URL set  [§9.1]"   || no "ANTHROPIC_BASE_URL set  [§9.1]" "got $(jq -r '.env.ANTHROPIC_BASE_URL' "$SETTINGS")"
  for v in ANTHROPIC_DEFAULT_FABLE_MODEL CLAUDE_CODE_SUBAGENT_MODEL ANTHROPIC_CUSTOM_MODEL_OPTION; do
    [ "$(jq -r ".env.$v // empty" "$SETTINGS")" != '' ] && ok "$v set  [§9.1 rev3]" || no "$v set  [§9.1 rev3]" "missing — rev-3 delta not implemented"
  done
  ls "$HOME/.claude/settings.json.bak.claude-nim-proxy."* >/dev/null 2>&1 && ok "timestamped backup created  [§9.1.3]" || no "timestamped backup created  [§9.1.3]" "no backup found"
else
  sk "settings.json merge assertions  [§9.1]" "jq not installed"
fi

printf '{ this is not json' > "$SETTINGS"
out="$($CLI setup --yes --nim-base-url "$NIM_BASE_URL" --nim-api-key nvapi-mock --model "$PRIMARY" --small-model "$SMALL" --configure-cli 2>&1)"
if printf '%s' "$out" | grep -qi 'settings'; then ok "unparseable settings.json is flagged, not overwritten  [§12.1 / T6]"; else no "unparseable settings.json is flagged, not overwritten  [§12.1 / T6]" "no warning surfaced"; fi
printf '%s' "$(cat "$SETTINGS")" | grep -q 'this is not json' && ok "unparseable settings.json left untouched  [§9.1.1]" || no "unparseable settings.json left untouched  [§9.1.1]" "file was rewritten"
rm -f "$SETTINGS"

# ─────────────────────────────────────────────────────────────────────────────
head_ "9. uninstall (§9.4)"
$CLI uninstall --purge >/dev/null 2>&1
[ ! -d "$CONFIG_DIR" ] && ok "--purge removes the config dir  [§13.5]" || no "--purge removes the config dir  [§13.5]" "$CONFIG_DIR still present"
pm2 jlist 2>/dev/null | grep -q 'litellm-nim' && no "pm2 app removed  [§9.4.2]" "still registered" || ok "pm2 app removed  [§9.4.2]"

# ─────────────────────────────────────────────────────────────────────────────
printf '\n\033[1mSummary\033[0m  %s%d passed%s  %s%d failed%s  %s%d skipped%s\n' \
  "$c_ok" "$pass" "$c_off" "$c_no" "$fail" "$c_off" "$c_sk" "$skip" "$c_off"
[ "$fail" -eq 0 ] || exit 1
