---
id: NCOW-21
title: >-
  Harden cmd.exe launcher escaping against embedded quotes; fix doc-comment
  wording
status: To Do
assignee: []
created_date: '2026-08-02 14:12'
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
