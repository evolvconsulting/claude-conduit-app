---
id: NCOW-34
title: Document the deliberate shutdown-mutex carve-out in README/DESIGN.md
status: In Progress
assignee: []
created_date: '2026-08-04 19:29'
updated_date: '2026-08-04 21:05'
labels: []
dependencies:
  - NCOW-31
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-31 deliberately excluded shutdown.js's before-quit proxy stop from the new proxy mutex (queueing it behind a background restart that can hold the lock for up to ~60s+ would risk making the app unquittable while wedged, which CLAUDE.md forbids outright). This was reviewed and accepted as the correct call across two review passes, and is documented in engine-context.js's own code comment (see also NCOW-33 for a comment-accuracy correction), but README.md and DESIGN.md section 7.4 -- which already document related pm2/shutdown/quit behavior in detail -- do not yet mention this carve-out at all.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 README.md and/or DESIGN.md section 7.4 record that the before-quit proxy stop is deliberately NOT serialized against the proxy mutex, and why (never make the app unquittable), consistent with engine-context.js's own comment
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read engine-context.js's "Deliberately NOT covered" comment block (lines 187-208) to get the exact mechanism/justification for the shutdown-mutex carve-out.
2. Read DESIGN.md section 7.4 and README.md's "Closing vs. quitting" section to find natural insertion points already discussing pm2 stop/timeout behavior.
3. Add a paragraph to each doc, right after the existing "stop is bounded by a timeout so a wedged pm2 cannot make the app unquittable" sentence, documenting that the before-quit stop deliberately skips the proxy mutex and why.
4. Run npm test to confirm no behavior change (docs-only).
5. Commit (docs(shutdown): ...) and push feat/NCOW-34-document-shutdown-mutex-carveout.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Worker implementation complete on branch feat/NCOW-34-document-shutdown-mutex-carveout (commit 850bf5c), pushed to origin.

Evidence:
- npm test: 333 passed, 0 failed.
- DESIGN.md: new paragraph inserted in section 7.4 immediately after the existing "bounded by a timeout so a wedged pm2 cannot make the app unquittable" sentence, citing mutexes.proxy in engine-context.js, shutdown.js's direct pm2Control call, the 60s+ hold risk, and pointing back to engine-context.js's own comment.
- README.md: new paragraph inserted in "Closing vs. quitting" immediately after the "Only the litellm-nim app is stopped..." paragraph, stating the quit path deliberately skips the Start/Stop/Restart lock and why.
- git diff confirmed docs-only, additive changes (20 insertions, 0 deletions) across DESIGN.md and README.md only.

Status: implemented, ready for review.

Review verdict: approve. AC #1 independently confirmed by the reviewer (verified DESIGN.md/README.md text against the actual engine-context.js "Deliberately NOT covered" comment, src/main/shutdown.js, src/main/index.js's tray mutex wiring, and src/main/ipc.js's UNSERIALIZED_METHODS -- all load-bearing claims in the new doc text checked out). Reviewer independently re-ran npm test: 333/333 passed.

Findings (non-blocking, reviewer chose approve despite these):
- minor: README.md:227's new paragraph ends "...as described above" but no earlier README text describes the timeout being referenced -- a dangling cross-reference for a README-only reader. DESIGN.md's analogous phrase is properly grounded. Not required to fix for this task's AC, but worth a one-clause tightening if convenient.
- nit: DESIGN.md says the background restart "can hold that lock for 60s+" vs the code comment's "up to 60s" -- defensible given the full critical section (delete + start + up to 60s health polling) can exceed 60s total, but slightly stronger phrasing than the source comment.

Approved for merge.
<!-- SECTION:NOTES:END -->
