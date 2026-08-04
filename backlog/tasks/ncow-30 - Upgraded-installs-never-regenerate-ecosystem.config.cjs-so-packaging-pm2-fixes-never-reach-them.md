---
id: NCOW-30
title: >-
  Upgraded installs never regenerate ecosystem.config.cjs, so packaging/pm2
  fixes never reach them
status: Done
assignee: []
created_date: '2026-08-04 00:45'
updated_date: '2026-08-04 04:13'
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
- [x] #1 The app detects when its own generated ecosystem.config.cjs/run.js/manifest.json are stale relative to the currently-running app version (or otherwise out of date) and regenerates them, verified live: an install that completed setup on an older build and is then upgraded in place ends up with fresh, current-version generated files without the user re-running setup
- [x] #2 The regeneration is safe against a currently-running proxy: it does not corrupt or orphan a live litellm process, and any necessary restart to pick up the new config is handled the same way this app already handles other proxy-affecting changes
- [x] #3 Coordinate with NCOW-24 if the fix touches the same daemon-lifecycle code, and with NCOW-10's auto-update path if regeneration should be triggered by (or verified across) an auto-update rather than only at every app launch
- [x] #4 A regression test covers the stale-detection and regeneration logic
- [x] #5 npm test passes
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

Fix pass 1 (worker, wave 12), addressing review pass 1's request_changes.

BLOCKING fix: src/main/engine-context.js's manifest read (getManifest()) was
called synchronously in the argument list building the
regenerateStaleConfig() call, outside the .catch() chain -- a corrupt/
truncated manifest.json threw a SyntaxError straight out of
createEngineContext(), which app.whenReady().then(...) has no catch for.
Wrapped that read in a local try/catch, falling back to null on failure
(same treatment needsRegeneration() already gives a genuinely missing
manifest). Verified live A/B with the same truncated-manifest scenario the
reviewer used: pre-fix reproduced the exact crash (0 renderers, the same
UnhandledPromiseRejectionWarning at the same call sites); post-fix launched
normally (1 renderer, landed at #setup, no unhandled rejection).

Non-blocking findings: (1) silent-failure logging -- addressed, index.js now
destructures configRegeneration and console.warns on a {reason:'error'}
resolution plus a .catch() backstop, mirroring the existing auto-update
startup-check pattern; (2) mutex serialization for the background restart --
deliberately left unaddressed and explicitly flagged rather than silently
dropped: the proxy mutex is constructed entirely inside ipc.js at handler-
registration time, with no reference engine-context.js can currently reuse;
sharing it would need exporting the mutex factory and restructuring both
modules' composition -- judged out of scope for a fix pass, worth a future
task if this ever manifests; (3) version-equality dev/nightly caveat --
addressed with a one-line doc comment on needsRegeneration(); (4) untested
branches -- addressed, 4 new tests covering the corrupt-manifest regression,
the no-litellm-path skip branch, a failed-restart-during-regeneration case
(configRegeneration resolves with reason:'error', never rejects), and a
static check that index.js observes/logs it.

npm test: 282/282 (278 baseline + 4 new). Committed separately as 0832188
(not amended onto 20f84bb), pushed to origin/fix/NCOW-30-regenerate-
configs-on-upgrade.

Review pass 2 (opus, wave 12): approve. AC indices independently
re-confirmed this pass with fresh live evidence: 1, 2, 4, 5 (AC#3 by
inspection, unchanged from pass 1 -- pm2Control.js still untouched).

Blocking fix from pass 1 confirmed FIXED and general, not overfit: reviewer
built its own A/B with two different corruption shapes (trailing garbage
after valid JSON; mid-string truncation) distinct from the fix-pass
worker's own truncation point -- both reproduced the exact pre-fix crash
(0 renderers, matching UnhandledPromiseRejectionWarning at getManifest/
createEngineContext/index.js:73) and confirmed the post-fix branch launches
cleanly (1 renderer, lands at #setup, no unhandled rejection) for both.
Also confirmed the null-fallback doesn't introduce a new problem: after a
corrupt-manifest launch, manifest.json/ecosystem.config.cjs/run.js/
litellm.env were all byte-identical to before (nothing discarded or
orphaned) -- the read simply retries next launch, same conservative
behavior as the pre-existing absent-manifest path.

Deferred finding #2 (mutex serialization) reviewed independently and its
deferral ACCEPTED: reviewer verified engine-context.js genuinely cannot
require ipc.js (which pulls ipcMain/app/shell from electron at module scope,
while engine-context.js is required directly by plain node --test suites),
so sharing the lock needs a new electron-free mutex module plus rewiring
both call sites -- correctly out of scope for this fix pass. The race also
needs three things to align (upgrade launch + proxy already running +
a Stop/Quit click inside the restart window) and is recoverable if it ever
fires. Recommended as a future follow-up task, not blocking here.

Two NEW non-blocking findings from this pass (neither reopens
request_changes): (1) the fix pass's new logging only fires on a genuine
throw from startOrRestart(); it does NOT inspect a health-check-timeout
style {ok:false, error} RETURN value from pm2Control.startOrRestart(), so a
timed-out restart still silently resolves as {regenerated:true} with no log
-- finding #1 from pass 1 is now partially, not fully, addressed; (2) a
failed restart is never retried, since generated_by_version is stamped
BEFORE the restart attempt, so a failed restart leaves the next launch
believing it's up-to-date and skipping both regeneration and the retry --
consistent with the documented fire-and-forget intent, but worth folding
into the same future follow-up as finding #2.

Own npm test: 282/282, exit 0. Scope/conventions confirmed clean: fix-pass
diff stays within its claimed findings, both commits carry Refs NCOW-30.
and Co-Authored-By trailers, 0832188 added on top of 20f84bb (not amended).
Housekeeping: reviewer's own test artifacts (fake homes, isolated
/tmp/n30pm2 pm2 daemon) fully removed; zero litellm-nim entries left on the
real shared pm2 daemon; real config dir untouched.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed the gap where an existing install never regenerated its generated
ecosystem.config.cjs/run.js/manifest.json across app upgrades, so
NCOW-27/28-class fixes silently never reached a user who had already
completed setup (true of both real published releases, v0.1.0 and v0.1.1).
manifest.json now records generated_by_version; configGen.js's
needsRegeneration()/regenerateStaleConfig() detect a version mismatch (or
absent/corrupt stamp) and re-render from the manifest's already-recorded
settings, restarting the proxy via the app's existing
getStatus()/startOrRestart() mechanism if it's currently running;
engine-context.js runs this once at every launch, fire-and-forget.

Two review passes (opus). Pass 1 (request_changes) found one blocking
regression via live A/B testing: a corrupt/truncated manifest.json (which
this task's own write path can itself produce on a crash/power-loss) threw
past createEngineContext()'s constructor, silently preventing the app from
ever opening a window. Fixed by making that read resilient (falls back to
null/absent, matching the existing missing-manifest treatment). Pass 2
(approve) independently re-verified the fix with two different corruption
shapes, re-confirmed AC#1/#2/#4/#5 live (an old-shaped install regenerates
on launch with all prior state and real keys preserved; a running proxy is
cleanly restarted onto the regenerated config, not corrupted or orphaned),
and reviewed AC#3 by inspection (pm2Control.js untouched, no NCOW-24
overlap; auto-update's relaunch-then-launch-time-regeneration satisfies the
AC's own wording). npm test 282/282 (261 baseline + 21 new), re-verified
after rebase onto dev. Squash-merged PR #20 -> dev @ 6485ff2.

Two non-blocking follow-up candidates recorded on the task, not yet filed
as a new task pending user approval: (1) the background restart isn't
serialized behind ipc.js's proxy-domain mutex (a narrow, recoverable race
requiring an upgrade launch + an already-running proxy + a Stop/Quit click
inside the restart window); (2) a failed restart's own error isn't
distinguished from a health-check-timeout-shaped {ok:false} return, and
generated_by_version is stamped before the restart attempt, so a failed
restart isn't retried on the next launch.
<!-- SECTION:FINAL_SUMMARY:END -->
