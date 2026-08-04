---
id: NCOW-33
title: >-
  Correct the shutdown-mutex-exclusion comment's described mechanism and window
  size
status: To Do
assignee: []
created_date: '2026-08-04 19:29'
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
