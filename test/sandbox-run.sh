#!/usr/bin/env bash
# sandbox-run.sh — run claude-nim-proxy (or anything else) against a THROWAWAY $HOME, then prove
# that nothing outside the sandbox was touched.
#
#   cd /path/to/nvidia-cowork
#   bash test/sandbox-run.sh -- node claude-nim-proxy.mjs setup --yes \
#        --nim-base-url http://127.0.0.1:8080/v1 --nim-api-key nvapi-mock \
#        --model qwen/qwen3-coder-480b-a35b-instruct --small-model meta/llama-3.1-8b-instruct \
#        --configure-cli
#
#   bash test/sandbox-run.sh --inspect     # what's inside the sandbox
#   bash test/sandbox-run.sh --verify      # re-check the real HOME without running anything
#   bash test/sandbox-run.sh --reset       # wipe the sandbox and start clean
#
# WHY: the wizard's only reach into your real machine is the `env` block of ~/.claude/settings.json.
# Overriding $HOME moves that — and ~/.config/claude-nim-proxy, and pm2's daemon directory — into a
# throwaway tree the process cannot escape. That makes it safe to exercise the delicate parts
# (§9.1 settings merge, §9.4 uninstall) against a REAL settings.json without risking yours.
#
# Note `--configure-cli` in the example above: inside the sandbox that is the interesting path, not
# the dangerous one.
#
# Written for macOS's stock bash 3.2 — no associative arrays, no mapfile.

set -uo pipefail

SANDBOX="${SANDBOX:-/tmp/nim-sandbox}"
REAL_HOME="${REAL_HOME:-$HOME}"
STATE_DIR="${SANDBOX}/.sandbox-meta"
BEFORE="${STATE_DIR}/before.txt"
AFTER="${STATE_DIR}/after.txt"

c_ok=$'\033[32m'; c_no=$'\033[31m'; c_wa=$'\033[33m'; c_dim=$'\033[2m'; c_b=$'\033[1m'; c_off=$'\033[0m'

# Everything in your real home the wizard could plausibly reach. Order matters only for readability.
#
# Note ~/.pm2/dump.pm2 rather than the whole ~/.pm2 directory: dump.pm2 is what `pm2 save` writes,
# so it is the artifact that answers "did this run register an app in my REAL pm2 daemon?". Watching
# the whole directory would false-positive constantly, because a running pm2 daemon rewrites its
# logs and pids on its own schedule with no help from us.
WATCH="
${REAL_HOME}/.claude/settings.json
${REAL_HOME}/.claude/settings.local.json
${REAL_HOME}/.claude.json
${REAL_HOME}/.config/claude-nim-proxy
${REAL_HOME}/.pm2/dump.pm2
${REAL_HOME}/.pm2/module_conf.json
${REAL_HOME}/Library/Application Support/Claude-3p
${REAL_HOME}/Library/Preferences/com.anthropic.claudefordesktop.plist
"

# fingerprint <outfile> — one line per watched path: "<sha>  path" | "DIR:<sha>  path" | "ABSENT  path"
#
# Directories are hashed by CONTENT (every file's sha) plus the full path listing. An earlier version
# hashed name+size+mtime via `stat`, which needed a BSD/GNU branch and — because the format string
# was word-split into stat's operands — silently degenerated to names only. That made the guard blind
# to edits of existing files while still catching new ones: the worst kind of failure, a green check
# that means nothing. Content hashing is slower and has no platform branch, no format string, and no
# way to be quietly wrong.
fingerprint() {
  local out="$1" p
  : > "$out"
  printf '%s\n' "$WATCH" | while IFS= read -r p; do
    [ -n "$p" ] || continue
    if [ -f "$p" ]; then
      printf '%s  %s\n' "$(shasum -a 256 "$p" 2>/dev/null | awk '{print $1}')" "$p" >> "$out"
    elif [ -d "$p" ]; then
      printf 'DIR:%s  %s\n' \
        "$( { find "$p" -print 2>/dev/null | sort
              find "$p" -type f -print0 2>/dev/null | xargs -0 shasum -a 256 2>/dev/null | sort
            } | shasum -a 256 | awk '{print $1}' )" \
        "$p" >> "$out"
    else
      printf 'ABSENT  %s\n' "$p" >> "$out"
    fi
  done
}

verify() {
  local rc=0
  if [ ! -f "$BEFORE" ]; then
    printf '%sNo baseline recorded.%s Run a sandboxed command first, or:\n  bash %s --baseline\n' \
      "$c_wa" "$c_off" "$0"
    return 2
  fi
  fingerprint "$AFTER"
  printf '\n%sIntegrity check — did anything outside the sandbox change?%s\n' "$c_b" "$c_off"
  local changed=0 line path
  # Compare line by line so the report names the offending path.
  while IFS= read -r line; do
    path="$(printf '%s' "$line" | sed 's/^[^ ]*  //')"
    if ! grep -qxF "$line" "$AFTER"; then
      printf '  %s✗ CHANGED%s  %s\n' "$c_no" "$c_off" "$path"
      changed=$((changed+1)); rc=1
    fi
  done < "$BEFORE"
  if [ "$changed" -eq 0 ]; then
    printf '  %s✅ clean%s — every watched path in %s is byte-identical to the baseline.\n' "$c_ok" "$c_off" "$REAL_HOME"
    # Print the ACTUAL watch list, never a hardcoded summary of it — a stale label on a security
    # guard tells you it checked something it didn't.
    printf '  %swatched %s paths:%s\n' "$c_dim" "$(grep -c . "$BEFORE")" "$c_off"
    sed 's/^[^ ]*  //' "$BEFORE" | sed "s|^${REAL_HOME}/|    ~/|;s|^|$c_dim|;s|$|$c_off|"
  else
    printf '\n  %s%d watched path(s) changed.%s Diff the fingerprints:\n    diff %s %s\n' \
      "$c_no" "$changed" "$c_off" "$BEFORE" "$AFTER"
  fi
  return $rc
}

inspect() {
  printf '\n%sSandbox contents%s  %s\n' "$c_b" "$c_off" "$SANDBOX"
  [ -d "$SANDBOX" ] || { printf '  (does not exist yet)\n'; return 0; }
  find "$SANDBOX" -maxdepth 4 -not -path "*/.sandbox-meta/*" 2>/dev/null \
    | sed "s|^${SANDBOX}|  .|" | head -60
  if [ -f "${SANDBOX}/.claude/settings.json" ]; then
    printf '\n%sSandboxed ~/.claude/settings.json env block%s\n' "$c_b" "$c_off"
    if command -v jq >/dev/null; then
      jq '.env // {}' "${SANDBOX}/.claude/settings.json" | sed 's/^/  /'
    else
      sed 's/^/  /' "${SANDBOX}/.claude/settings.json" | head -40
    fi
  fi
}

case "${1:-}" in
  --reset)
    rm -rf "$SANDBOX"
    printf '%sWiped%s %s\n' "$c_ok" "$c_off" "$SANDBOX"
    exit 0 ;;
  --inspect) inspect; exit 0 ;;
  --verify)  verify;  exit $? ;;
  --baseline)
    mkdir -p "$STATE_DIR"; fingerprint "$BEFORE"
    printf '%sBaseline recorded%s (%s paths) -> %s\n' "$c_ok" "$c_off" "$(grep -c . "$BEFORE")" "$BEFORE"
    exit 0 ;;
  --help|-h|'')
    sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
    exit 0 ;;
  --) shift ;;
  *) : ;;   # allow calling without the -- separator
esac

[ "$#" -gt 0 ] || { echo "nothing to run — see: bash $0 --help"; exit 64; }

# ── set up ──────────────────────────────────────────────────────────────────────────────────────
mkdir -p "$SANDBOX/.claude" "$SANDBOX/.config" "$STATE_DIR"

printf '%sSandboxed run%s\n' "$c_b" "$c_off"
printf '  real HOME     %s  %s(read-only from here on)%s\n' "$REAL_HOME" "$c_dim" "$c_off"
printf '  sandbox HOME  %s\n' "$SANDBOX"
printf '  command       %s\n' "$*"

# Resolve the tools we need to ABSOLUTE paths before HOME changes. PATH entries are already
# expanded in the environment, so this is belt-and-braces — but if anything lived under
# $HOME/.local/bin via an unexpanded ~, this is what keeps it reachable.
REAL_BINS="${REAL_HOME}/.local/bin:${REAL_HOME}/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin"
printf '  litellm       %s\n' "$(command -v litellm || echo 'NOT FOUND')"
printf '  pm2           %s\n\n' "$(command -v pm2 || echo 'NOT FOUND')"

fingerprint "$BEFORE"
printf '%sBaseline recorded: %s watched paths.%s\n\n' "$c_dim" "$(grep -c . "$BEFORE")" "$c_off"

# Seed a realistic settings.json so the §9.1 merge has something non-trivial to preserve. Only if
# the sandbox doesn't already have one — re-runs should exercise the idempotent path.
if [ ! -f "${SANDBOX}/.claude/settings.json" ]; then
  cat > "${SANDBOX}/.claude/settings.json" <<'JSON'
{
  "model": "sonnet",
  "permissions": { "deny": ["Bash(rm -rf *)"] },
  "hooks": { "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "echo sandbox" }] }] },
  "env": { "MY_UNRELATED_VAR": "keep-me" }
}
JSON
  printf '%sSeeded a sandbox settings.json with model/permissions/hooks/env so the §9.1 merge has\nsomething real to preserve.%s\n\n' "$c_dim" "$c_off"
fi

# ── run ─────────────────────────────────────────────────────────────────────────────────────────
printf '%s──────── command output ────────%s\n' "$c_dim" "$c_off"
env HOME="$SANDBOX" \
    PM2_HOME="${SANDBOX}/.pm2" \
    XDG_CONFIG_HOME="${SANDBOX}/.config" \
    PATH="${REAL_BINS}:${PATH}" \
    "$@"
RC=$?
printf '%s──────── exit %s ────────%s\n' "$c_dim" "$RC" "$c_off"

# ── verify ──────────────────────────────────────────────────────────────────────────────────────
verify
VRC=$?

# The wizard must never write Desktop 3P config — §5.3. Check the sandbox too: an "isolated" write
# there would still be a spec violation, just a harmless one this time.
if [ -d "${SANDBOX}/Library/Application Support/Claude-3p" ]; then
  printf '\n  %s✗ SPEC VIOLATION%s the run created Claude-3p/ inside the sandbox.\n' "$c_no" "$c_off"
  printf '    §5.3 forbids writing Desktop 3P config anywhere — it is instructions-only.\n'
  VRC=1
fi

printf '\n%sSandbox artifacts%s\n' "$c_b" "$c_off"
for p in .config/claude-nim-proxy .claude/settings.json .pm2; do
  [ -e "${SANDBOX}/${p}" ] && printf '  created  %s\n' "${SANDBOX}/${p}"
done
printf '\n  inspect: bash %s --inspect\n  reset:   bash %s --reset\n' "$0" "$0"

cat <<EOF

${c_dim}Notes
  • pm2 apps started here belong to the sandbox daemon (PM2_HOME). \`pm2 ls\` in a normal shell will
    not show them; use  PM2_HOME=${SANDBOX}/.pm2 pm2 ls
  • Test-mode check 10 shells out to \`claude -p\`. Under the sandbox HOME that CLI has no login, so
    the check will warn rather than pass. Expected — it is warn-only in §11.
  • This isolates the CLI leg completely. It does NOT isolate Claude Desktop: Desktop reads its 3P
    config as the logged-in macOS user regardless of what \$HOME this shell has. For Desktop, use a
    second macOS user account (see TESTING-STRATEGY.md).${c_off}
EOF

[ "$RC" -eq 0 ] && [ "$VRC" -eq 0 ] && exit 0
[ "$VRC" -ne 0 ] && exit 1
exit "$RC"
