#!/usr/bin/env bash
# Entrypoint for the claude-nim-proxy test container.
# Starts mock-nim in the background, waits for it, then runs whatever you asked for
# (default: an interactive bash).
set -euo pipefail

MOCK_PORT="${MOCK_PORT:-8080}"
MOCK_MODE="${MOCK_MODE:-ok}"
MOCK_LOG_FILE="${MOCK_LOG_FILE:-/tmp/mock-nim.log}"

export NIM_BASE_URL="http://127.0.0.1:${MOCK_PORT}/v1"

PORT="$MOCK_PORT" MOCK_MODE="$MOCK_MODE" \
  node /home/tester/mock-nim.mjs > "$MOCK_LOG_FILE" 2>&1 &
MOCK_PID=$!

cleanup() { kill "$MOCK_PID" 2>/dev/null || true; }
trap cleanup EXIT

for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${MOCK_PORT}/__state" >/dev/null 2>&1; then break; fi
  sleep 0.25
done

if ! curl -fsS "http://127.0.0.1:${MOCK_PORT}/__state" >/dev/null 2>&1; then
  echo "✗ mock-nim failed to start. Log:" >&2
  cat "$MOCK_LOG_FILE" >&2
  exit 1
fi

cat <<BANNER
──────────────────────────────────────────────────────────────────────────────
 claude-nim-proxy test container
──────────────────────────────────────────────────────────────────────────────
 mock NIM     http://127.0.0.1:${MOCK_PORT}/v1   (mode: ${MOCK_MODE}, log: ${MOCK_LOG_FILE})
 litellm      $(command -v litellm || echo 'NOT ON PATH — intentional if you narrowed PATH')
 node         $(node --version)
 pm2          $(pm2 --version 2>/dev/null | tail -1)
 \$HOME        ${HOME}   (throwaway — your real ~/.claude is untouched)

 Run the wizard:
   node claude-nim-proxy.mjs setup --nim-base-url "\$NIM_BASE_URL" --nim-api-key nvapi-mock \\
     --model qwen/qwen3-coder-480b-a35b-instruct --small-model meta/llama-3.1-8b-instruct \\
     --no-cli --yes

 Switch failure modes without restarting:
   curl -sX POST http://127.0.0.1:${MOCK_PORT}/__mode/no-tools      # trips test check 5
   curl -sX POST http://127.0.0.1:${MOCK_PORT}/__mode/unauthorized  # trips key validation
   curl -sX POST http://127.0.0.1:${MOCK_PORT}/__mode/empty-catalog # trips entitlements path
   curl -sX POST http://127.0.0.1:${MOCK_PORT}/__mode/rate-limit    # trips 429 handling
   curl -sX POST http://127.0.0.1:${MOCK_PORT}/__mode/flaky         # proves num_retries absorbs blips
   curl -s http://127.0.0.1:${MOCK_PORT}/__state | jq

 Full scripted suite:
   bash test/run-hermetic.sh
──────────────────────────────────────────────────────────────────────────────
BANNER

exec "$@"
