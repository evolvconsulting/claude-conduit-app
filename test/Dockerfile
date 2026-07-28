# Hermetic test environment for claude-nim-proxy.
#
# Gives the wizard a machine that is NOT your daily driver: its own $HOME, its own
# ~/.claude/settings.json, its own pm2 daemon, its own ~/.config/claude-nim-proxy.
# Nothing it does can touch your real Claude Code or Claude Desktop configuration.
#
# Build:  docker build -t claude-nim-proxy-test -f test/Dockerfile .
# Run:    docker run --rm -it claude-nim-proxy-test
#
# Covers Leg A of TESTING-STRATEGY.md — everything except the Claude Desktop GUI form and the
# macOS-specific paths (~/Library/…, `defaults read`, .mobileconfig). Those need §3 A5 / §4.

FROM node:22-bookworm-slim

# LITELLM_PIN must match <PINNED> in DESIGN.md §4 Step 1. Never set it below 1.93.0:
# litellm 1.82.7/1.82.8 shipped a credential stealer. Both are gone from PyPI, but the pin is a
# security control, not hygiene — a floating version here would silently defeat it.
ARG LITELLM_PIN=1.93.0

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv python3-pip \
      curl ca-certificates procps lsof jq expect git \
    && rm -rf /var/lib/apt/lists/*

# litellm in its own venv, mirroring how `uv tool install` / `pipx install` isolate it on a real
# machine. Deliberately NOT symlinked into /usr/local/bin — see the PATH note below.
RUN python3 -m venv /opt/litellm \
    && /opt/litellm/bin/pip install --no-cache-dir "litellm[proxy]==${LITELLM_PIN}" \
    && /opt/litellm/bin/litellm --version

RUN npm install -g pm2@latest && pm2 --version

# Non-root, so $HOME is a throwaway and file-mode assertions (0700 config dir, 0600 litellm.env)
# are meaningful rather than trivially satisfied by root.
RUN useradd --create-home --shell /bin/bash tester
USER tester
WORKDIR /home/tester/app

# /opt/litellm/bin is on PATH for the interactive shell, which is what the Step 1 prereq check
# sees. To reproduce the PATH-divergence bug that DESIGN.md §6.2 guards against — pm2's daemon
# not seeing a uv/pipx-installed litellm — start the container with a narrowed PATH:
#     docker run --rm -it -e PATH=/usr/local/bin:/usr/bin:/bin claude-nim-proxy-test
# The wizard must still work, because it resolves the ABSOLUTE litellm path at generation time and
# templates that into run.sh. If it breaks under that flag, §6.2 is not implemented.
ENV PATH="/opt/litellm/bin:/home/tester/.npm-global/bin:${PATH}" \
    NVIDIA_NIM_API_KEY=nvapi-mock-key-not-a-real-credential \
    MOCK_PORT=8080 \
    MOCK_MODE=ok

# Project files. Copy the harness first so the layer caches independently of source churn.
COPY --chown=tester:tester test/mock-nim.mjs /home/tester/mock-nim.mjs
COPY --chown=tester:tester test/docker-entrypoint.sh /home/tester/entrypoint.sh
COPY --chown=tester:tester . /home/tester/app

# Fail the build if the pin drifted onto a compromised release.
RUN v="$(/opt/litellm/bin/litellm --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)" \
    && case "$v" in 1.82.7|1.82.8) echo "FATAL: litellm $v is a known-compromised release"; exit 1 ;; esac \
    && echo "litellm $v ok"

EXPOSE 4000 8080
ENTRYPOINT ["/bin/bash", "/home/tester/entrypoint.sh"]
CMD ["bash"]
