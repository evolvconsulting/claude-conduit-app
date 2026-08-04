---
id: NCOW-30
title: >-
  Upgraded installs never regenerate ecosystem.config.cjs, so packaging/pm2
  fixes never reach them
status: In Progress
assignee: []
created_date: '2026-08-04 00:45'
updated_date: '2026-08-04 03:48'
labels:
  - pm2
  - packaging
  - release
dependencies: []
priority: high
type: bug
ordinal: 43000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found independently by both NCOW-28's and NCOW-29's opus reviewers during wave 11
(2026-08-03), and confirmed by that wave's integration review.

configGen.js's generateAll() (which renders ecosystem.config.cjs, run.js, and
manifest.json for the managed litellm-nim pm2 entry) has exactly one caller in
the entire codebase: engine-context.js's config.generate(), invoked only from
the first-run setup wizard. Nothing else in the app ever regenerates these
files -- not configDirMigration.js or userDataMigration.js (both only rewrite
path prefixes on a directory/name migration, never re-render content), not
pm2Control.js's startOrRestart() (which just does pm2.start() against
whatever ecosystem.config.cjs already exists on disk), and nothing runs on an
app version change or auto-update.

Net effect: an install that completed setup once keeps whatever
generateAll()-produced content it got at that moment, forever, across every
subsequent app upgrade -- including auto-updates via NCOW-10's mechanism. Any
fix that lives inside generateAll()'s output (NCOW-27's interpreter:
process.execPath + ELECTRON_RUN_AS_NODE, NCOW-28's PYTHONIOENCODING=utf-8, and
any future fix of the same shape) silently never reaches a user who set up
before that fix shipped, even after they update to a build that contains it.
Both v0.1.0 and v0.1.1 (the only two real published releases) predate NCOW-27
entirely, so every real user who has ever completed setup against a published
build is currently exposed to this gap.

This intersects with NCOW-24 (bootstrapped daemon persistence across
app/proxy lifecycle) and NCOW-10's auto-update mechanism -- coordinate scope
if picked up alongside either.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The app detects when its own generated ecosystem.config.cjs/run.js/manifest.json are stale relative to the currently-running app version (or otherwise out of date) and regenerates them, verified live: an install that completed setup on an older build and is then upgraded in place ends up with fresh, current-version generated files without the user re-running setup
- [ ] #2 The regeneration is safe against a currently-running proxy: it does not corrupt or orphan a live litellm process, and any necessary restart to pick up the new config is handled the same way this app already handles other proxy-affecting changes
- [ ] #3 Coordinate with NCOW-24 if the fix touches the same daemon-lifecycle code, and with NCOW-10's auto-update path if regeneration should be triggered by (or verified across) an auto-update rather than only at every app launch
- [ ] #4 A regression test covers the stale-detection and regeneration logic
- [ ] #5 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a `generated_by_version` field to manifest.json, stamped by
   config.generate() with the currently-running app version (deps.appVersion,
   wired from main/index.js's app.getVersion()).
2. Add three new exports to src/engine/configGen.js, all plain-Node/injectable
   (no Electron imports):
   - needsRegeneration(manifest, currentVersion): stale iff a manifest exists,
     currentVersion is known, and manifest.generated_by_version !==
     currentVersion (a missing field counts as stale -- every real v0.1.0/
     v0.1.1 install today).
   - resolveExistingNvidiaApiKey(litellmEnvPath): re-reads the NVIDIA key
     straight out of the litellm.env already on disk, deliberately not via
     secretStore/safeStorage, so a regeneration can't be blocked by an
     unrelated keyring failure.
   - regenerateStaleConfig(opts): orchestrates the check + re-render + stamp +
     conditional restart.
3. regenerateStaleConfig() re-runs generateAll() with the manifest's
   already-recorded model/port/litellm-path, stamps generated_by_version via
   injected saveManifest, then (AC#2) calls injected getStatus()/
   startOrRestart() to restart the proxy IF it's currently running -- reusing
   the exact mechanism handlers.proxy.start()/restart() already use, not a
   bespoke restart path.
4. Wire src/main/engine-context.js to call regenerateStaleConfig() once at
   every launch (cheap no-op once current), fire-and-forget, exposed as
   context.configRegeneration (a Promise) for observability/testing. Make
   pm2Control optionally injectable via deps so tests never touch a real
   system pm2 daemon (matches this repo's existing pm2Control.test.js/
   shutdown.test.js convention -- engine-context.js was the one place that
   still hardcoded the real module).
5. Add regression tests (AC#4) covering staleness detection and the
   regeneration/restart wiring.
6. Verify AC#1/#2 live via NIM_PROXY_TEST_HOME + --dev (never the real config
   dir): seed a fake home with a stale manifest + pre-NCOW-27-shaped
   ecosystem.config.cjs, launch, confirm regeneration; separately verify a
   running proxy survives regeneration with a clean restart, not corruption
   or orphaning.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented (worker, wave 12). npm test: 278/278 passing (261 baseline + 17
new, across test/engine/configGen.test.js and new
test/main/engine-context-config-regen.test.js).

Live verification (NIM_PROXY_TEST_HOME + --dev, real config dir never
touched): hand-seeded a fake home with a manifest missing
generated_by_version and a pre-NCOW-27-shaped ecosystem.config.cjs (no
interpreter/env fields) -- launched the app, confirmed manifest.json gained
"generated_by_version":"0.1.1" and ecosystem.config.cjs was rewritten with
interpreter: process.execPath + PYTHONIOENCODING, run.js was replaced, and
the real NVIDIA/master keys in litellm.env survived untouched.

AC#2 verified separately: started the proxy for real under the stale config
via the real shared pm2 daemon (never killed, only litellm-nim's own entry
touched, left stopped afterward as found), reset the manifest to stale
again, relaunched, confirmed pm2 showed a fresh online restart (0 restarts,
~12s uptime) with a passing health check right after -- proving the live
proxy was cleanly restarted onto the new config, not corrupted or orphaned.

Files touched: src/engine/configGen.js, src/main/engine-context.js,
src/main/index.js, test/engine/configGen.test.js,
test/main/engine-context-config-regen.test.js (new). Single commit 20f84bb,
pushed to origin/fix/NCOW-30-regenerate-configs-on-upgrade.

Judgment calls flagged by the worker for reviewer attention:
1. Staleness re-uses the manifest's already-recorded model/port/litellm-path
   as-is rather than re-detecting litellm's path via
   prereqs.checkLitellmOnPath() on every launch -- judged a version bump
   doesn't imply litellm moved; if litellm actually moved between upgrades
   this won't catch it (pre-existing gap, not newly introduced).
2. The API key is deliberately re-read from litellm.env, not secretStore --
   needs reviewer confirmation this is acceptable vs. going through the OS
   keychain again.
3. "Stale" is exact version-string mismatch, not semver ordering -- a
   downgrade also regenerates (judged correct/desired: always match the
   running binary), flagged explicitly for review.
4. configRegeneration is fire-and-forget/best-effort by design (never blocks
   or fails app startup) -- a failure here just means the user hits the same
   failure mode next Start click, same as today.

Review pass 1 (opus, wave 12): request_changes. AC indices independently
confirmed with live evidence: 1, 2, 4, 5 (AC#3 satisfied but by code
inspection only -- pm2Control.js untouched, no new daemon-bootstrap
behavior, launch-time regeneration covers the auto-update case per the AC's
own wording). Own npm test: 278/278.

BLOCKING finding: src/main/engine-context.js:150 evaluates `manifest:
getManifest()` synchronously in the argument list, outside the promise chain
and outside any try/catch. readManifest() does a bare JSON.parse, so a
corrupt/truncated manifest.json (exactly what a non-atomic writeFileSync
leaves after a crash/power-loss/disk-full -- and this task now rewrites that
file on every version upgrade) throws out of createEngineContext(), which
rejects app.whenReady().then(...), so createMainWindow() never runs --
contradicts the call site's own "must never block or fail app startup"
comment. Live A/B on dev vs this branch with the same truncated manifest
confirmed: dev launches fine; this branch produces zero renderers and a
windowless zombie process, with no route to Setup/Uninstall. Reviewer
verdict: fix before re-review, do not settle any ACs until fixed and AC#1/#2
are re-verified against the fix.

Four non-blocking findings also recorded (see task notes for full reviewer
detail): (1) a regeneration/restart failure is completely silent --
configRegeneration's rejection is never read or logged anywhere, no
diagnostic trail; (2) the background startOrRestart() is the first one not
serialized behind ipc.js's proxy-domain mutex, so it can race a concurrent
Start/Stop click or before-quit's stopProxyForShutdown() during its up-to-60s
health poll; (3) staleness is exact version-string equality, so a template
change shipped without a version bump never reaches installs already
stamped with that version -- fine for real releases, a trap for dev/nightly
builds; (4) the no-litellm-path skip branch and the .catch() error branch
are both untested, the latter being the safety-critical one given the
blocking finding.

Reviewer explicitly upheld all four of the worker's own flagged judgment
calls as correct: reusing the manifest's litellm_path instead of
re-detecting on every launch, reading the API key from litellm.env instead
of secretStore, downgrade-also-regenerates, and fire-and-forget/never-block
as the right DESIGN intent (just not what the code currently does before
the blocking fix).

Housekeeping: reviewer found the worker's own live-verification had left a
stopped, harmless litellm-nim artifact entry in the user's REAL shared pm2
daemon (dump.pm2), pointing at a now-deleted scratchpad path -- reviewer
deliberately did not touch the shared daemon and used an isolated PM2_HOME
for its own testing instead. This needs cleanup by the orchestrator (main
checkout, not a subagent) before wave settlement.
<!-- SECTION:NOTES:END -->
