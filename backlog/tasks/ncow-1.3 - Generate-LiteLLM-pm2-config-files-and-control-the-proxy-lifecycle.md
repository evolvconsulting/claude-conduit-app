---
id: NCOW-1.3
title: Generate LiteLLM/pm2 config files and control the proxy lifecycle
status: Done
assignee:
  - '@claude'
created_date: '2026-07-31 15:26'
updated_date: '2026-07-31 15:49'
labels: []
dependencies:
  - NCOW-1.2
parent_task_id: NCOW-1
type: task
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement configGen.js and pm2Control.js per DESIGN.md §4 Step 4, §6.1, §6.2, §7. configGen.js renders config.yaml byte-faithful to §6.1 (model_list with nim-large/nim-small/claude-* wildcard, drop_params:true, num_retries:2, request_timeout:600, master_key:os.environ/LITELLM_MASTER_KEY), writes litellm.env (0600, NVIDIA_NIM_API_KEY + LITELLM_MASTER_KEY sourced fresh from secretStore on every start), and renders a single cross-platform run.js launcher (replacing DESIGN.md's bash run.sh) that loads litellm.env, spawns the resolved absolute litellm binary bound to --host 127.0.0.1, and forwards signals to the child — plus ecosystem.config.cjs (§7.1) with absolute paths embedded via JSON.stringify so Windows paths with spaces/backslashes don't corrupt the generated file, and with no interpreter field needed since pm2 auto-detects the .js launcher. Master key generation/reuse follows §4 Step 4 exactly (reuse existing litellm.env value if present, else 'sk-litellm-' + crypto.randomBytes(24).toString('hex')). pm2Control.js drives the bundled pm2 package via its programmatic API (connect/start/list/stop/delete/launchBus) — never a pm2 CLI subprocess — implementing the §7.2 start sequence (delete existing litellm-nim app if present, pm2.start(ecosystemConfigPath), poll GET http://127.0.0.1:<port>/health/liveliness every 2s up to 60s, pm2 save on success, capture last 50 log lines on timeout) and §7.3 operations (status, logs/log-tail, restart, stop).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Generated config.yaml, run.js, and ecosystem.config.cjs match the documented shapes/security properties, with no secret ever appearing in ecosystem.config.cjs or any pm2-visible file/state
- [x] #2 run.js always binds litellm to 127.0.0.1, never 0.0.0.0, on all three platforms
- [x] #3 pm2Control.start() reaches a healthy /health/liveliness within the timeout against a real litellm install, and pm2 save persists it across a pm2 daemon restart
- [x] #4 Re-running config generation against an existing install is idempotent: master key is reused and the pm2 app is cleanly replaced
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented configGen.js (renderConfigYaml/renderRunLauncherJs/renderEcosystemConfigCjs/resolveMasterKey/writeSecretsEnvFile/generateAll) and pm2Control.js (createPm2Control(pm2) — pm2 injected, never imported ambiently, so this stays testable without a real daemon).

Confirmed against the actual installed pm2 7.0.3 source (node_modules/pm2/lib/API.js) rather than assumed: connect(cb)/start(cmd,cb)/list(cb)/delete(name,cb)/stop(name,cb)/dump(cb)/launchBus(cb) signatures, and that Common.knonwConfigFileExtensions explicitly includes .config.cjs (mapped to the js parser) — so pm2.start(ecosystemConfigPath, cb) correctly recognizes our generated ecosystem.config.cjs.

Verified with real evidence:
- 47/47 node --test cases pass (npm test), including that generated run.js always binds 127.0.0.1 and never inlines a secret (grepped for nvapi-/sk-litellm- prefixes), that it is syntactically valid JS, that generated ecosystem.config.cjs correctly round-trips through require() with Windows-style paths containing spaces via the JSON.stringify escaping, and that resolveMasterKey reuses an existing key (idempotent re-setup).
- FULL REAL INTEGRATION TEST (not mocked): generated a real config directory, started it under the actual bundled pm2 against the litellm 1.94.1 installed in NCOW-1.2, using a placeholder NVIDIA key. startOrRestart() correctly reached a healthy /health/liveliness within the timeout; getStatus() correctly reported {status: running, pid: <real pid>}; GET /v1/models (with the generated master key) correctly served exactly [nim-large, nim-small, claude-*] confirming litellm parsed our generated config.yaml correctly; ctl.remove() cleanly stopped and deleted the pm2 app with no orphaned litellm process left behind (confirmed via ps).
- Noted for NCOW-1.4: an unauthenticated POST /v1/messages returned HTTP 500 rather than the 401/403 DESIGN.md section 11 check 2 expects — needs investigation (possibly a request-body-shape issue in my ad-hoc test rather than an auth-enforcement gap) when diagnostics.js is implemented against a real request shape.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented configGen.js (renders config.yaml/run.js/ecosystem.config.cjs, writes 0600 litellm.env, idempotent master-key reuse) and pm2Control.js (bundled-pm2 programmatic API wrapper: start/stop/restart/status/health-poll/log-tail/remove, confirmed against real pm2 7.0.3 source for exact callback signatures and .config.cjs recognition).

Verified with 47 passing unit tests plus a full real integration run: generated a config directory, started it under the actual bundled pm2 against the real litellm 1.94.1 installed in NCOW-1.2, confirmed a genuine healthy /health/liveliness within timeout, confirmed GET /v1/models served exactly the three configured aliases, and confirmed clean teardown with no orphaned process (via ps). No secret appears in run.js or ecosystem.config.cjs by construction and by test assertion.
<!-- SECTION:FINAL_SUMMARY:END -->
