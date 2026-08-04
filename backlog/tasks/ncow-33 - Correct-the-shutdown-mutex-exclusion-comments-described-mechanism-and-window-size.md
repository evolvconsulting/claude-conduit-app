---
id: NCOW-33
title: >-
  Correct the shutdown-mutex-exclusion comment's described mechanism and window
  size
status: In Progress
assignee: []
created_date: '2026-08-04 19:29'
updated_date: '2026-08-04 21:06'
labels: []
dependencies:
  - NCOW-31
ordinal: 46000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-31's fix pass 1 corrected engine-context.js's comment on why shutdown.js's before-quit proxy stop is deliberately excluded from the new proxy mutex, to say the proxy can outlive the quit (contradicting NCOW-4) rather than merely 'a Stop that doesn't stick'. That conclusion is right, but review pass 2 found the corrected comment describes the wrong mechanism and understates the window: shutdown.js's stop() calls getStatus() FIRST and returns early on anything but 'running' -- in the delete-to-start gap inside pm2Control.startOrRestart(), getStatus() reports 'not-installed', so stop() is skipped entirely (nothing errors, nothing is swallowed), not 'errors on an app pm2 no longer knows about' as currently written. The real risk window is also wider than the comment's 'a millisecond-wide window' framing: a stop landing BEFORE deleteAppIfPresent() also succeeds and is then undone by the subsequent pm2.start(), and the window spans a full getStatus+delete round-trip against the pm2 daemon -- autoUpdate.js's own comments elsewhere note proxy.getStatus can take 1s+ to connect, not milliseconds.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 engine-context.js's comment on the deliberate shutdown-mutex exclusion accurately describes the mechanism (stop() is skipped via its own getStatus() precondition, not an error-and-swallow) and the real window size (a getStatus+delete round-trip against the pm2 daemon, not literally milliseconds)
- [ ] #2 No behavior change -- this is a comment-only correction
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read engine-context.js's existing "Deliberately NOT covered" comment block.
2. Read shutdown.js's stopProxyForShutdown() -- confirm it calls getStatus() first and only calls pm2Control.stop() when status is 'running'; anything else returns early, no error path.
3. Read pm2Control.js's startOrRestart()/getStatus() -- confirm getStatus() reports 'not-installed' during the delete-to-start gap, not an error.
4. Read autoUpdate.js's comment on proxy.getStatus() taking 1s+ to connect, to ground the "not milliseconds" correction.
5. Rewrite the comment to describe: stop() skipped via its own getStatus() precondition (not error-and-swallow); the symmetric case of a stop landing just before deleteAppIfPresent() succeeding but being undone by the following pm2.start(); and the real window size (a full getStatus+delete round trip, potentially 1s+, not millisecond-wide).
6. Run npm test to confirm no behavior change; commit and push.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Worker implementation complete on branch fix/NCOW-33-shutdown-mutex-comment-accuracy (commit 10c2b9e), pushed to origin.

Evidence:
- npm test: 333/333 passed (CLAUDE.md's "178 tests" figure is stale relative to this worktree's current state).
- git diff -- src/main/engine-context.js: comment-only change (18 insertions, 9 deletions, all within // lines), no executable code touched.
- Before (wrong claims): "it errors on an app pm2 no longer knows about -- an error createProxyShutdown() already swallows by design"; "This is a millisecond-wide window".
- After (corrected): stop() calls getStatus() first and is skipped via its own precondition when status is 'not-installed' (nothing errors/gets caught); added the symmetric case of a stop landing just before deleteAppIfPresent() succeeding but being undone by the following pm2.start(); window described as a full getStatus+delete round trip against the pm2 daemon, can run well over a second, citing autoUpdate.js's own 1s+ getStatus comment.

Status: implemented, ready for review.

Review verdict: approve. Both AC #1 and AC #2 independently confirmed.

AC #1 (mechanism/window accuracy): reviewer independently verified every technical claim against real code -- shutdown.js's stopProxyForShutdown() genuinely checks getStatus() first and returns early on non-'running' (pm2Control.stop() never reached); pm2Control.js's startOrRestart()/deleteAppIfPresent()/getStatus() confirm 'not-installed' is reported during the delete-to-start gap; the added symmetric race (stop landing before deleteAppIfPresent(), later undone by pm2.start()) is real; autoUpdate.js:166-167 genuinely documents getStatus() taking 1s+ to connect, grounding the "not milliseconds" correction.

AC #2 (comment-only, no behavior change): git diff --stat shows engine-context.js only (18 insertions/9 deletions). Reviewer went further -- stripped all full-line // comments from both revisions and confirmed byte-identical output (17544 bytes each), i.e. zero executable change. Reviewer independently re-ran npm test: 333/333 passed.

Findings: three non-blocking nits only (inherited "stop()" vs actual stopProxyForShutdown() naming, a minor tension in retained lead-in phrasing, window described as narrower than the true full span) -- none require changes.

Approved for merge. Reviewer confirmed dev has moved 3 commits ahead (backlog-handover bookkeeping only, no src/ touched) -- merge will be clean, not fast-forward.
<!-- SECTION:NOTES:END -->
