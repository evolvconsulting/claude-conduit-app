---
id: NCOW-32
title: >-
  Serialize Uninstall and auto-update's proxy-stop against the shared proxy
  mutex
status: To Do
assignee: []
created_date: '2026-08-04 19:29'
labels: []
dependencies:
  - NCOW-31
ordinal: 45000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-31 gave engine-context.js's background config-regeneration restart and ipc.js's user-initiated proxy start/stop/restart a shared mutex (src/main/mutex.js, MUTEX_DOMAINS: proxy/config/claudeDesktop/claudeCode). Its review pass 2 found, while sweeping for any remaining unlocked caller, that this coverage is incomplete: the 'uninstall' and 'update' IPC domains have no mutex at all. Two real callers reach pm2Control without taking any lock: uninstall.run() -> runUninstall() -> pm2Control.remove() (src/engine/uninstall.js), and update.install() -> installUpdateAndRestart() -> stopProxyForShutdown() (src/main/autoUpdate.js). Clicking Uninstall inside a background restart's up-to-60s health-check window is not serialized against it -- pm2Control.remove()'s deleteAppIfPresent()+save() could run concurrently with the restart's own deleteAppIfPresent()->pm2.start(), and the in-flight restart's pm2.start() could re-register and start litellm against a config directory Uninstall is concurrently deleting, leaving a running proxy behind after 'uninstall complete'. The auto-update path reaches the same unserialized stopProxyForShutdown() used by the (deliberately unserialized, and separately reviewed/accepted) before-quit shutdown path -- but auto-update's caller is an ordinary IPC handler on an unmutexed domain, not a quit path, so the shutdown-carve-out's justification (never make the app unquittable) does not apply to it and it should very plausibly be serialized.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Uninstall's call into pm2Control.remove() is serialized against the same proxy mutex the background config-regeneration restart uses, so an Uninstall click can never run concurrently with an in-flight restart
- [ ] #2 The auto-update install path's proxy-stop (installUpdateAndRestart -> stopProxyForShutdown) is likewise serialized against the same mutex, distinct from the deliberately-unserialized before-quit shutdown path (which stays as-is)
- [ ] #3 A regression test demonstrates a background restart and an Uninstall (or auto-update install) attempt can no longer interleave
- [ ] #4 npm test passes
<!-- AC:END -->
