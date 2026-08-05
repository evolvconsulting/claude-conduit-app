---
id: NCOW-45
title: >-
  Serialize Uninstall against the config and claudeCode mutex domains it also
  touches
status: In Progress
assignee: []
created_date: '2026-08-05 11:43'
updated_date: '2026-08-05 12:11'
labels: []
dependencies:
  - NCOW-32
ordinal: 58000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The wave-5 integration review of NCOW-32 found that src/engine/uninstall.js touches three shared-state domains, not just proxy: line 24 removeClaudeCodeSettings() writes the same claudeCode:configure/claudeCode:remove-guarded settings.json (the claudeCode domain, which already has its own mutex), line 28 pm2Control.remove() is the proxy domain NCOW-32 already serialized, and line 50 fs.rmSync(configDir, {recursive:true, force:true}) on purge touches the same directory config:generate writes (the config domain, which already has its own mutex). src/main/ipc.js DOMAIN_MUTEX_ALIASES only maps uninstall -> proxy (a single string value), so the claudeCode and config paths remain completely unserialized against uninstall -- Uninstall (with purge) can interleave with an in-flight claudeCode:configure or config:generate the same way it could interleave with a background restart before NCOW-32. Not a regression: uninstall had zero locking before NCOW-32, which strictly improved the proxy-domain case and was correctly scoped to just that per its own ACs. This is a distinct, previously-unsurveyed gap the merged view made visible. Fixing it requires either changing DOMAIN_MUTEX_ALIASES value type to support multiple aliases per domain (e.g. uninstall -> [proxy, config, claudeCode]) with multi-lock acquisition in resolveDomainLock(), or an equivalent mechanism -- with a deliberate, documented lock-acquisition order to avoid introducing a new deadlock risk for any handler that ends up needing more than one domain lock at once.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Uninstall's config-directory purge (fs.rmSync(configDir) when purge:true) is serialized against the same mutex config:generate uses, so it cannot interleave with an in-flight config regeneration
- [ ] #2 Uninstall's removeClaudeCodeSettings() call is serialized against the same mutex claudeCode:configure/claudeCode:remove use, so it cannot interleave with either
- [ ] #3 The existing NCOW-32 serialization of Uninstall against the proxy mutex (background restart) continues to hold unchanged
- [ ] #4 No lock-ordering deadlock is introduced for any handler that must now acquire more than one domain lock -- the acquisition order is deliberate and documented
- [ ] #5 A regression test demonstrates Uninstall can no longer interleave with config:generate or claudeCode:configure/claudeCode:remove
- [ ] #6 npm test passes
<!-- AC:END -->
