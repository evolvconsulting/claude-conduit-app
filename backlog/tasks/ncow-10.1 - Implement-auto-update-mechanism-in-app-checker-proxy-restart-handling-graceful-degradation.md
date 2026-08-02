---
id: NCOW-10.1
title: >-
  Implement auto-update mechanism: in-app checker, proxy-restart handling,
  graceful degradation
status: To Do
assignee: []
created_date: '2026-08-02 01:07'
labels: []
dependencies: []
references:
  - docs/distribution.md
parent_task_id: NCOW-10
priority: high
type: feature
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the core auto-update mechanism for shipped builds: choose and document the update mechanism (electron-updater backed by a GitHub Releases feed, per NCOW-10s own research — electron-builder already emits latest.yml/latest-mac.yml/latest-linux.yml into dist/ per NCOW-9, no extra config needed there), wire an in-app update checker into the app, and define/implement how the running LiteLLM proxy behaves across an app update/restart.

Per the campaign tracker (doc-4, Confirmed at init 2026-08-01): ship this UNSIGNED for now. macOS Squirrel.Mac auto-update requires real code-signing certs, which are not yet available — document macOS as notify-only fallback (link to the release) until certs land. This explicitly supersedes NCOW-10s own earlier implementation note about a fully signed macOS path; the user re-confirmed "queue it now, unsigned" at this campaign rounds init and it is not to be re-litigated. Windows NSIS and Linux AppImage do not strictly require signing for electron-updater to function, so they should get a real working silent-update path (verified separately in the follow-on verification subtask).

Update check failures (offline, rate-limited, GitHub API error, no release found) must degrade gracefully and never block or delay app startup.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Update mechanism chosen and documented (electron-updater + GitHub Releases feed), including a per-platform support matrix and known limitations — explicitly stating macOS is notify-only pending code-signing certificates
- [ ] #2 In-app update check exists and tells the user when a newer version is available
- [ ] #3 On platforms where silent/auto-update is not available (macOS, until signed), the app notifies the user with a link to the GitHub Release instead of failing silently or doing nothing
- [ ] #4 Update check failures (offline, rate-limited, no release found, API error) degrade gracefully and never block or delay app startup
- [ ] #5 Behaviour of the running LiteLLM proxy across an app update/restart is defined and implemented
<!-- AC:END -->
