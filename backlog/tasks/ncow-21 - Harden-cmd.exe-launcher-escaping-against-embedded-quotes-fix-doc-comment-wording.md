---
id: NCOW-21
title: >-
  Harden cmd.exe launcher escaping against embedded quotes; fix doc-comment
  wording
status: In Progress
assignee: []
created_date: '2026-08-02 14:12'
updated_date: '2026-08-04 15:38'
labels: []
dependencies: []
priority: low
type: bug
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two small, non-blocking findings from NCOW-20's final (opus, pass 3) review of the Windows litellm launcher fix in src/engine/configGen.js. Neither is currently exploitable -- no value that can reach this launcher's argv can contain a literal double quote (litellm's resolved path and the config.yaml path are real Windows filesystem paths, where " is an illegal character; port is a hardcoded 4000 with no UI input; model IDs/API keys/base URLs travel via config.yaml/litellm.env, never this argv) -- but both are worth closing for defense-in-depth and documentation accuracy.

Finding 1 -- embedded-quote escaping gap: cmdQuoteArg() (in configGen.js's generated run.js launcher) currently escapes an embedded literal quote using MSVCRT-style backslash-doubling (the rule CommandLineToArgvW uses to parse argv on the receiving end). But cmd.exe's OWN command-line re-parse (which happens first, before the spawned process ever sees the string) does not honor backslash-escaped quotes -- it simply toggles "inside quotes" state on every literal " character, regardless of preceding backslashes. So an arg containing a literal " can terminate cmd.exe's notion of the quoted region early, and any cmd.exe metacharacter that follows in the same string executes as real shell syntax rather than being treated as literal argument content. The review pass live-verified this exploit on a real Windows VM: an arg like `a"&echo,BREAKOUT>marker&"b` caused real command execution (a marker file was created), even after the correct fix for the metacharacter-escaping bug that NCOW-20 was about.

The reviewer also live-verified the fix: replace the MSVCRT-style backslash-doubling escape for embedded quotes with a cmd.exe-style doubled-quote escape (`""` instead of `\"`) -- i.e. change the embedded-quote handling from something like `s.replace(/"/g, '\\"')` to a rule shaped like `s.replace(/(\\*)"/g, '$1$1""')` (the reviewer's exact verified form should be re-derived/re-confirmed by whoever picks this up, this description is a starting point not a copy-paste diff). This closes the gap because it survives both parsing layers: cmd.exe's own re-parse toggles in/out on each `"` and passes a doubled `""` through as a single literal `"`, and downstream Windows argv parsing (CommandLineToArgvW-style, which is what actually receives the spawned process's argv) also treats `""` inside a quoted region as one literal embedded quote. Keep the existing preceding-backslash-doubling rule for trailing backslashes before the closing quote -- that part is still correct and orthogonal to this fix.

Finding 2 -- doc comment overstatement: configGen.js's doc comment (near the escaping logic) currently says the escaping "is written to be correct for arbitrary content anyway (belt-and-braces, and it costs nothing)". Per finding 1, that is not quite true for content containing a literal double quote. Once finding 1 is fixed, this comment should become accurate again -- otherwise, soften the wording to something like "correct for arbitrary content except a literal double-quote character, which requires the cmd.exe-style doubled-quote escape (see finding 1) rather than backslash-doubling to be handled safely". The comment should also stop implying that an earlier, now-superseded caret-based escaping attempt (mentioned in the comment's own history/rationale) had already solved the embedded-quote case -- it had not; this is a separate, still-open concern this whole time, only recently made visible.

Both findings were verified via live testing against the real Windows VM (winvm) during NCOW-20's review -- see that task's full notes for the complete evidence trail (opus review pass 3 in particular).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 cmdQuoteArg() (or equivalent) in configGen.js's generated launcher correctly escapes an embedded literal double-quote character using a construction that survives BOTH cmd.exe's own re-parse and the spawned process's argv parsing (verified live on a real Windows VM, not just by code reading -- winvm is reachable via ~/.scripts/winvm.sh)
- [ ] #2 A regression test in test/engine/configGen.test.js covers an arg combining an embedded literal quote AND a cmd.exe metacharacter in the same value (e.g. something shaped like the injection case documented on NCOW-20: an arg containing both " and & such that a naive escape would let the & execute)
- [ ] #3 The doc comment in configGen.js accurately describes what is and isn't covered by the escaping, without overstating completeness or misattributing which historical fix solved which problem
- [ ] #4 npm test passes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read renderRunLauncherJs's doc comment + generated cmdQuoteArg(); confirm pre-fix escape is MSVCRT-style backslash-doubling (s.replace(/(\\*)"/g, '$1$1\\"')).
2. Build a live harness on winvm: generate a real run.js from the actual module with an exploit payload as configYamlPath, plus a litellm.cmd shim writing its received argv to JSON. Run the pre-fix exploit to confirm the breakout (marker file creation via a chained cmd.exe command).
3. Apply the fix: change the embedded-quote escape to cmd.exe-style doubled-quote ("" instead of \"). Leave the existing preceding-backslash-doubling rule for trailing backslashes untouched.
4. Rewrite the generated inline comment and the JSDoc block to accurately describe what is and isn't covered, and correct the misattribution to the superseded caret-based escaping attempt.
5. Re-run the identical exploit post-fix (expect no breakout), then run 10 adversarial payloads with exact byte-level argv comparison against the shim's captured JSON.
6. Add 2 regression tests to test/engine/configGen.test.js covering an arg combining an embedded quote and a cmd.exe metacharacter, checked against both cmd.exe's own re-parse model and CommandLineToArgvW rules. Mutation-test by reverting only the escape rule to dev's original and confirming exactly those 2 tests fail.
7. Run npm test, commit in 2 logical commits, push the branch.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented on fix/NCOW-21-cmd-exe-embedded-quote-escaping (dev @ a7aa4e7), commits 228de79 + caa8681, pushed.

AC#1 (live winvm A/B, real exploit): generated the actual run.js from the real module with exploit payload a"&echo,BREAKOUT>marker.txt&"b.yaml as configYamlPath, plus a litellm.cmd shim capturing received argv. PRE-FIX: marker.txt created (10 bytes, BREAKOUT), shim argv truncated to ["--config","a\""], cmd.exe ran a 3rd chained garbage command -- confirmed the live breakout. POST-FIX: marker absent, shim argv delivered the full payload byte-for-byte as inert data with all subsequent args intact. Then ran 10 further adversarial payloads (bare quote, single/even/odd backslash runs, leading/trailing quotes, already-doubled input, ^&, |, &&/||, Program Files (x86) with quote+metachars) with exact byte-level argv round-trip comparison -- all 10 exact, zero marker files. Confirmed the exploit-tested launcher is byte-identical to what the committed generator produces.

AC#2: 2 new tests in test/engine/configGen.test.js, checked against two independent reference models (cmd.exe's own re-parse toggle rule; CommandLineToArgvW's ""-inside-quotes rule). Mutation-tested: reverting only the escape rule to a byte-faithful copy of dev's original makes exactly those 2 tests fail (all pre-existing tests, including the old metachar test, still pass) -- confirms the old suite structurally could not have caught this.

AC#3: JSDoc + generated inline comment rewritten -- no longer claims arbitrary-content correctness unconditionally; explicitly states embedded quotes are covered only since this fix via the doubled-quote form, flags the code as load-bearing security logic, names %VAR%-expansion as the one documented residual gap, and corrects the misattribution (the superseded caret-based pass never closed the embedded-quote hole -- the breakout reproduced identically with or without it, since the actual cause was cmdQuoteArg's backslash-doubling).

AC#4: npm test 295/295 (293 baseline + 2 new), re-run after the final commit.

Scope check: grepped src/test/docs/README.md/DESIGN.md for cmdQuoteArg and the overstated wording -- only src/engine/configGen.js and test/engine/configGen.test.js matched; no other files touched.

Non-blocking note for reviewer: the pre-existing decodeCmdLine() test helper can't model embedded quotes (only strips first/last char per token) -- left in place for existing tests with a comment pointing embedded-quote cases at the two new stricter models instead.

winvm cleaned (C:\Users\jdnewhouse\ncow21 removed, marker files gone, only the pre-existing pm2 daemon PID 8832 still running, untouched). One harmless local leftover outside the repo: /tmp/ncow21 (the harness), sandbox denied its own rm -rf -- safe to delete manually.

Process incident (orchestrator-recorded): after the original worker went idle without an immediate reply, the orchestrator mistakenly spawned a second agent with a colliding name instead of resuming the original via SendMessage. The duplicate was immediately told to stand down and touch nothing. It did not comply -- it independently re-ran its own live winvm A/B and mutation test, then called `backlog task edit` itself, which landed an uncommitted direct edit in the orchestrator's own main checkout (replacing the recorded plan and appending duplicate notes) -- exactly the write-location hazard this campaign's write-only-from-orchestrator rule exists to prevent, since a subagent's cwd is not guaranteed to be its assigned worktree. That edit was reverted (git checkout, never committed) before this note. The duplicate's independent verification, for what it's worth, corroborated the original worker's results byte-for-byte (same truncated pre-fix argv, same intact post-fix argv, same mutation-test pass/fail split) -- useful as a second, differently-timed data point, but it is not being treated as an additional authoritative AC confirmation; the reviewer's own independent pass is what settles that.
<!-- SECTION:NOTES:END -->
