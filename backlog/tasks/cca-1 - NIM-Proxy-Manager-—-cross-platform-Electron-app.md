---
id: CCA-1
title: NIM Proxy Manager — cross-platform Electron app
status: Done
assignee: []
created_date: '2026-07-31 15:25'
updated_date: '2026-07-31 20:03'
labels: []
dependencies: []
type: feature
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
GUI (Electron; macOS/Windows/Linux) that implements the wizard/lifecycle described in DESIGN.md's claude-nim-proxy spec: set an NVIDIA NIM API key, generate LiteLLM+pm2 config, start/stop/monitor the local proxy, and point Claude Desktop (automated write with manual fallback) and optionally the Claude Code CLI at it or back to Anthropic default. Full architecture in the approved plan at /Users/jdnewhouse/.claude/plans/read-the-design-and-expressive-kazoo.md — deviations from DESIGN.md's Node CLI (bundled pm2 via programmatic API, auto-install of litellm, a cross-platform run.js launcher replacing run.sh, Electron safeStorage for the API key, and a consent-gated direct Claude Desktop config writer) are documented there and in each subtask.
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
All ten subtasks complete and independently verified. Delivered a cross-platform Electron app that sets up and supervises a local LiteLLM proxy routing Claude Desktop and the Claude Code CLI to NVIDIA NIM models: a plain-Node engine layer with injected dependencies (paths, platform shims, prerequisite checks with litellm auto-install and the 1.82.7/1.82.8 malware-release block, safeStorage-backed secret storage, live model catalog, LiteLLM/pm2 config generation, proxy lifecycle, NVIDIA key/model validation, a 10-check diagnostics suite, Claude Code settings.json integration, a best-effort Claude Desktop 3P config writer with an always-visible manual fallback, and uninstall); an Electron main process with a hardened IPC bridge, status poller and tray; a no-bundler HTML/CSS/ES-module renderer covering the full Setup wizard, Dashboard, both client-config pages, Diagnostics and Uninstall; and electron-builder packaging producing six artifacts across macOS, Windows and Linux.

Verified by 101 unit tests plus three consecutive clean full end-to-end runs (50/50 assertions, 0 failures) driving the real UI against the real NVIDIA API, a real litellm+pm2 proxy and a sandboxed fake home, and by a smoke test of the packaged macOS app that reproduced the Gatekeeper rejection, cleared it with the documented workaround, and started a genuine proxy from inside the bundle. Live testing was decisive throughout — it caught defects unit tests missed, including one unit test that masked a real bug by inventing a manifest field that never exists in reality.

Not yet done and deliberately left to the user: nothing in this effort has been committed to git (the working tree is entirely untracked apart from the initial DESIGN.md commit), and the Windows and Linux artifacts were built but never launch-tested for want of those machines. See doc-1 for the session handover.
<!-- SECTION:FINAL_SUMMARY:END -->
