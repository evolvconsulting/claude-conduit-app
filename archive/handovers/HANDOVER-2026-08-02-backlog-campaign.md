# Handover — NCOW-10 epic closed + pm2 cold-bootstrap fixed (waves: 3, tasks: NCOW-22, NCOW-10.3, NCOW-10; filed NCOW-23..26)

**Date**: 2026-08-02 | **Grounded against**: `dev` @ `bc7df99b498473c912c92ce4069a052a3c8054e0`,
clean, 0 ahead / 0 behind `origin/dev` | **Tracker**: doc-4

## Paste-ready prompt for the next session

```
Run /backlog-handover restore in /Volumes/_data/repos/claude-conduit. Same
campaign round (doc-4). Three waves ran last session: wave 6 merged NCOW-22
(pm2 cold-bootstrap fix, PR #13 -> e4b517c), wave 7 was blocked purely by
winvm being offline, wave 8 verified NCOW-10.3's AC#3 and closed BOTH
NCOW-10.3 and the whole NCOW-10 auto-update epic. Tests are at 244/244 on dev.

FIRST ACTION: check winvm reachability (`~/.scripts/winvm.sh "hostname"`).
It gates most of the ready set and it went offline mid-session once already
on 2026-08-02 (the user powered it back on when asked).

Five tasks are queued, none blocked by a dependency:
- NCOW-21 (LOW, cmd.exe embedded-quote escaping) -- needs live Windows
- NCOW-23 (HIGH, win32 NIM_PROXY_TEST_HOME does not protect the config dir)
  -- needs live Windows
- NCOW-24 (HIGH, bootstrapped pm2 daemon outlives the app and holds its own
  binary; may block NCOW-10 update/uninstall on Windows) -- needs live Windows
- NCOW-25 (MEDIUM, Linux release is x86_64-only vs all-aarch64 hardware) --
  needs Linux; `linuxvm` is reachable and already provisioned
- NCOW-26 (LOW, spawnDaemon timeout can kill a slow-but-healthy daemon) --
  pure code + tests, needs NO VM at all

Shared Machine State still limits any wave to ONE live-Windows task at a time.
If winvm is down, NCOW-26 and NCOW-25 are still fully runnable -- do not stall
the session on Windows availability.

The ready set is recomputed live at restore -- do NOT hardcode a next-wave
list. Queue order confirmed by the user across prior sessions; do not re-ask
about repo visibility, release versioning, or the two permanently-published
releases.
```

## State

| Item | Status |
| --- | --- |
| Campaign tracker | doc-4. Resolved now holds NCOW-10.1, 10.2, 10.3, NCOW-10, NCOW-20, NCOW-22. Queue holds NCOW-21, 23, 24, 25, 26. |
| `dev` / `origin/dev` | In sync at `bc7df99`. `npm test` **244/244** verified on merged dev. |
| Merged this session | PR #13 (NCOW-22) squash-merged → `e4b517c`. No other code changes; waves 7 and 8 produced zero commits. |
| Worktrees / treehouse | Both slots in pool `claude-conduit-163fa4` released and available. |
| Branches / PRs | No campaign branches (local or remote), no open campaign PRs. |
| Real GitHub Releases | `v0.1.0` and `v0.1.1` still published permanently, untouched. **No new release was published** — the campaign authorized exactly these two. |
| `winvm` | Reachable as of session end. v0.1.1 installed, app not running. Config in the real `%APPDATA%\claude-conduit` verified untouched (mtimes all predate the wave). Port 4000 free. **A pre-started pm2 daemon (node.exe pid 8832) was deliberately left running** — see traps. |
| `linuxvm` | Ubuntu 26.04 aarch64, reachable, now provisioned with Node 22, Xvfb, pip and a real litellm venv (left as reusable infra). No pm2 daemon running. |
| This dev Mac | Its own long-running pm2 daemon (pid 1479) was never touched all session. |

## This session's in-flight wave

(clean — nothing in flight. All three waves fully settled, both worktrees released, all branches deleted.)

## Next steps

1. `/backlog-handover restore`. R2/R3 should find no drift.
2. Check winvm first (above). Then build a wave from {NCOW-21, 23, 24, 25, 26}, at most one
   live-Windows task in it.
3. Suggested priority if winvm is up: **NCOW-23** (HIGH) — it is a hole in the safety mechanism
   every other Windows task depends on, so fixing it first makes NCOW-21/24 safer to run.
   If winvm is down: **NCOW-26** (self-contained) or **NCOW-25**.

## Critical context / traps

- **The pm2 daemon left running on winvm (pid 8832) MASKS NCOW-22's cold-bootstrap path** —
  exactly the way this dev Mac's own daemon masked the same defect for the entire campaign until
  wave 5 found it. Any fresh-install testing on winvm must account for it (stop the app *entry*,
  or use a throwaway `PM2_HOME`). **Never `pm2 kill` it** — and never kill any daemon you did not
  start. It was left deliberately because recreating it is expensive (see next trap).
- **A bare `ssh ... "pm2 ping"` spawns a daemon that dies the instant the SSH session ends**
  (Windows job-object teardown), so it never survives the invoking command. Launch it via a
  **scheduled task** to get a daemon that persists. This was newly discovered in wave 8 and is
  very likely part of why earlier waves could not get the proxy running on Windows.
- **`SetForegroundWindow` silently fails for background-launched processes** (Windows
  foreground-lock). Use direct `SendMessage(BM_CLICK)` on enumerated child button HWNDs to drive
  the NSIS wizard — more reliable than the `SetForegroundWindow`+`BM_CLICK` technique recorded in
  earlier waves.
- **On win32, `NIM_PROXY_TEST_HOME` does NOT protect the config dir.** `paths.js`'s
  `resolveConfigDir` ignores the injected homedir because `APPDATA` is always set. So on Windows
  you are operating against the REAL `%APPDATA%\claude-conduit`. This is confirmed live and is now
  NCOW-23. Until it is fixed, treat winvm's config as precious: prefer reading over regenerating,
  and re-verify it afterwards.
- **NCOW-22's fix is on `dev` but in NO published build.** Both `v0.1.0` and `v0.1.1` predate it,
  so anything tested against the installed app still needs the pre-started-daemon unblocker. A
  future `v0.1.2` built from current dev would be the first real proof of the fix in a packaged
  Windows release — the user has NOT authorized that; ask before publishing anything.
- **macOS auto-update is notify-only pending real signing certs.** That is the documented,
  intended answer, not a gap — but macOS silent update is genuinely unproven, and auto-update as a
  whole has only ever been exercised on Windows.
- **Subagents in this session repeatedly went idle WITHOUT returning their structured result.**
  Both wave-6 agents did it; each returned correctly when asked directly via SendMessage. Neither
  had actually failed — the commits and work were real and complete. Check branch state before
  assuming an idle agent failed, and just ask for the result.
- Diskutil guidance from wave 4 still stands: never `unmountDisk`/`eject` a whole disk identifier
  locally; a prior review pass unmounted this repo's own disk that way.

## Do not repeat

- Do not re-verify NCOW-10.3's AC#1/#2/#3, or anything under the NCOW-10 epic — all closed with
  reviewed live evidence. Re-running the Windows update test would be expensive and pointless.
- Do not credit the 15–18s slow Electron exit observed in wave 8 as evidence for NCOW-24. The
  reviewer disproved it: the daemon in that run was plain `node.exe` and no pm2 process was
  holding the Electron image. (This corrects an orchestrator speculation, so it is worth stating
  explicitly.)
- Do not assume cause #3 in NCOW-22's original description was real. It was **disproved** — the
  `asarUnpack`/`debug` gap does not reproduce against shipped code, because `require.resolve`
  returns the `app.asar` path and Electron's asar shim stays active in `ELECTRON_RUN_AS_NODE`
  children. `asarUnpack` is back to the narrow `**/node_modules/pm2/**` and `electron-builder.yml`
  is byte-identical to base. Do not "re-fix" it.
- Do not re-ask about repo visibility, release versioning, the two permanent releases, or the
  queue order — all settled in prior sessions and still valid.
- Do not publish a GitHub Release or push a tag without explicit user authorization.
- Do not trust an agent's self-report that it stopped/cleaned up a shared resource — verify.
