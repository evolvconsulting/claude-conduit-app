---
id: NCOW-44
title: >-
  Widen NCOW-41's mutexes/handlers property-mutation guard to catch
  Object.assign/defineProperty/destructuring/logical-assignment spellings
status: To Do
assignee: []
created_date: '2026-08-05 03:59'
labels: []
dependencies:
  - NCOW-41
ordinal: 57000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
NCOW-41's identifierPropertyIsAssigned() (test/main/engine-context-config-regen.test.js) closes AC#2's canonical serialization-break shape (`mutexes.proxy = ...` / `mutexes['proxy'] = ...`) with a real text-only guard, verified by two independent review passes (one request_changes cycle, then approved) plus a fresh wave-4 integration-review re-probe against the merged src/main/index.js. But the detector is one property-access level deep only: it requires the `=` to appear immediately after the FIRST property access, so it does not catch equivalent serialization breaks spelled as `Object.assign(mutexes, { proxy: createDomainMutex() })`, `Object.defineProperty(mutexes, 'proxy', {...})`, destructuring-assignment (`({ proxy: mutexes.proxy } = ...)`), or logical-assignment (`??=`/`||=`/`&&=`) forms of the same mutation. This was explicitly flagged as non-blocking by NCOW-41's own reviewer on both review passes, and reconfirmed as a real (not yet covered) gap by the wave-4 integration review -- consistent with the rigor AC#6 already demanded of the sibling post-spread-override regex (which was itself widened for exactly this kind of spelling-exhaustiveness in NCOW-41).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The mutexes/handlers property-mutation guard catches Object.assign(mutexes, {...}) and Object.assign(handlers, {...}) forms mutating the .proxy property
- [ ] #2 The guard catches Object.defineProperty(mutexes, 'proxy', {...}) and the equivalent handlers form
- [ ] #3 The guard catches destructuring-assignment mutation of mutexes.proxy/handlers.proxy
- [ ] #4 The guard catches logical-assignment (??=, ||=, &&=) mutation of mutexes.proxy/handlers.proxy
- [ ] #5 The guard continues to NOT false-positive on the real call site's legitimate reads (mutexes.proxy.run(...), equality checks, property spreads) -- re-verify the existing non-vacuity meta-test still passes and extend it to cover the new spellings
- [ ] #6 npm test passes
<!-- AC:END -->
