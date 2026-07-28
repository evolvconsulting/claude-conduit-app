# Installing the two prerequisites (macOS, this machine)

Verified state before you start: Node **v26.5.0** ✅ · `uv` at `/opt/homebrew/bin/uv` ✅ ·
Claude Code **2.1.204** ✅ · **pm2 missing** ❌ · **litellm missing** ❌

Run the two installs below, then re-check. Nothing here needs `sudo` except the optional
boot-persistence step at the very end, which you run yourself.

---

## 1. pm2

```bash
npm install -g pm2
pm2 --version            # expect 6.x or later
pm2 ls                   # first run boots the daemon; expect an empty table, not an error
```

If `npm install -g` fails on permissions, your Node came from a system package rather than a
user-writable prefix. Don't `sudo npm`. Either install Node via Homebrew (`brew install node`) or set
a user prefix:

```bash
npm config set prefix ~/.npm-global
export PATH="$HOME/.npm-global/bin:$PATH"     # add to ~/.zshrc
npm install -g pm2
```

## 2. litellm (pinned)

`uv` is already installed, so use it — `uv tool` gives litellm its own isolated environment and puts
the binary on your PATH without touching system Python.

```bash
uv tool install 'litellm[proxy]==1.93.0'
litellm --version        # expect 1.93.0
command -v litellm       # note this absolute path — the wizard templates it into run.sh
```

**The version pin is a security control, not hygiene.** litellm 1.82.7/1.82.8 shipped a credential
stealer (`litellm_init.pth`, executed on every Python interpreter start). Both are now removed from
PyPI, so a fresh install can't land on them — but never relax the pin downward.

If `uv tool install` puts it somewhere not on your PATH:

```bash
uv tool update-shell      # adds ~/.local/bin to your shell profile
exec zsh                  # reload
```

## 3. Confirm both, together

```bash
node --version && pm2 --version && litellm --version && command -v litellm
```

All four lines should print. Then the wizard's Step 1 gate should pass and reach the API-key prompt
instead of exiting 2.

## 4. Get an NVIDIA API key

https://build.nvidia.com → pick any model → **Get API Key**. The key starts with `nvapi-`. Free tier
is roughly 40 requests/minute plus limited credits — enough to prove the chain, not enough for a
working day of agentic coding.

Export it so the wizard skips the prompt:

```bash
export NVIDIA_NIM_API_KEY='nvapi-...'
```

## 5. Optional: survive a reboot

pm2 restores saved apps when its daemon restarts, but a full reboot needs a launch agent:

```bash
pm2 startup               # prints a sudo command
# then run the command it printed, yourself
pm2 save
```

The wizard will never run `sudo` for you — by design.

---

## Uninstalling cleanly

```bash
pm2 delete litellm-nim && pm2 save
uv tool uninstall litellm
npm uninstall -g pm2
rm -rf ~/.config/claude-nim-proxy        # only after `claude-nim-proxy uninstall`
```

Use `claude-nim-proxy uninstall --purge` rather than deleting the config directory by hand — it also
subtracts the env keys it added from `~/.claude/settings.json`.
