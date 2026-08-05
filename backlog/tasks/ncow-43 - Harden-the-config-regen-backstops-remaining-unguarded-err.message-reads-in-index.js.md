---
id: NCOW-43
title: >-
  Harden the config-regen backstop's remaining unguarded err.message reads in
  index.js
status: In Progress
assignee: []
created_date: '2026-08-05 03:59'
updated_date: '2026-08-05 12:11'
labels: []
dependencies:
  - NCOW-42
ordinal: 56000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wave-4's integration review of NCOW-42 (auto-update chain hardening) found a previously-unsurveyed sibling site in a DIFFERENT chain: src/main/index.js's config-regen backstop. Line ~97 reads `.catch((err) => console.warn('[config-regen] stale-config regeneration failed unexpectedly:', err.message));` -- the identical shape, identical rationale ('this should never fire'), and identical failure mode as the auto-update startup backstop NCOW-42 just fixed at a different line in the same file. A second, milder instance sits at line ~94: `result.error?.message` -- optional chaining guards nullish but not a throwing getter or Proxy get-trap, exactly the class safeReadProperty() (src/engine/configGen.js) was introduced to close (NCOW-37).

Reachability: engine-context.js already wraps the underlying configRegeneration call in its own .catch((err) => ({regenerated:false, reason:'error', error: err})), so index.js's own catch at ~97 can only fire if the .then() handler itself throws (e.g. destructuring/reading a property off a hostile Proxy result, or line 94's own optional-chained read itself throwing via a hostile getter) -- the same reachability argument NCOW-42 accepted for its own site. If it fires with a null/undefined/hostile value, it produces an unhandled rejection in the main process instead of the safe log line it's assumed to be.

Provenance: NOT a regression from NCOW-41 or NCOW-42. NCOW-37 explicitly scoped itself away from index.js; NCOW-42 scoped itself to the auto-update backstop only. This site belongs to the config-regen/NCOW-30/31 lineage, not the auto-update chain, and has never been surveyed by any task in the NCOW-36/37/40/42 error-guarding chain. Follow the same fix pattern already established there (safeReadProperty()/describeThrownValue() from src/engine/configGen.js) rather than inventing a new one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 src/main/index.js's config-regen backstop (~line 97) no longer interpolates err.message directly; it uses the existing safe-stringification helpers so it cannot itself throw regardless of what rejects into it
- [ ] #2 src/main/index.js's line ~94 result.error?.message read is hardened through the same safe-stringification helpers so a throwing getter or hostile Proxy result cannot make the .then() handler itself throw
- [ ] #3 A regression test demonstrates a hostile/malformed error surfacing from the config-regen path does not produce an unhandled rejection at this backstop, mirroring NCOW-42's own adversarial test rigor
- [ ] #4 npm test passes
<!-- AC:END -->
