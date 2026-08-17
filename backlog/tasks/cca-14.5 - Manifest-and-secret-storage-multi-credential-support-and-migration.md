---
id: CCA-14.5
title: 'Manifest and secret storage: multi-credential support and migration'
status: In Progress
assignee: []
created_date: '2026-08-16 14:45'
updated_date: '2026-08-17 13:49'
labels: []
dependencies:
  - CCA-14.1
parent_task_id: CCA-14
priority: high
type: feature
ordinal: 81000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Extend the manifest format to carry provider type, and extend secretStore.js to hold multiple credentials, including providers that need none. Ensure an existing NVIDIA-only install continues to work after upgrading to this abstraction.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The manifest format records provider type per configured provider
- [ ] #2 secretStore.js supports multiple stored credentials, including a provider with no credential
- [ ] #3 An existing NVIDIA-only install migrates and continues working after upgrade with no manual intervention
- [ ] #4 npm test passes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reminder from CCA-14.1: once this task adds a provider field to the manifest (AC#1), also thread it through configGen.regenerateStaleConfig()/resolveExistingNvidiaApiKey() in src/engine/configGen.js -- those still hardcode NVIDIA_NIM_API_KEY today because there was nothing else to read yet.

## Forward-flagged from CCA-14.3's wave-18 review (2026-08-17) — relevant to this task's own scope

CCA-14.3 (Custom/Local provider, Done) registered a provider with `litellmProvider: 'openai'`. Its
reviewer found `configGen.js:24`'s `apiBaseLine` is only emitted on the FIRST of three generated
model entries (absent on the other two). Harmless for `nvidia_nim` today (litellm knows the vendor
default base URL), but once a Custom/Local connection is actually wired up end to end, litellm's
`openai` provider defaults to `api.openai.com` when no `api_base` is given -- so the `claude-haiku-4-5`
and `claude-*` wildcard model entries would SILENTLY ROUTE TO OPENAI instead of the user's local
endpoint. Separately, `configGen.js` emits `api_key: os.environ/<VAR>` unconditionally, while a
keyless Custom/Local setup has no such env var to reference -- litellm's openai provider generally
expects a key, so the keyless path needs explicit handling (a placeholder value, an omitted key line,
or whatever litellm's own convention is for a keyless OpenAI-compatible backend -- verify against
litellm's real docs rather than assuming).

Not added to this task's acceptance criteria unilaterally -- recorded here so whoever picks up
CCA-14.5 (or CCA-15, which is the actual end-to-end wiring point) doesn't rediscover it from scratch.

## Second forward-flagged item from wave-18's integration/cleanup review (2026-08-17)

`src/engine/configGen.js:379`'s comment `apiKeyEnvVar defaults to 'NVIDIA_NIM_API_KEY' (today's only
provider)` is now stale -- all three registered providers (nvidia-nim, openrouter, custom-local) each
declare their own `apiKeyEnvVar` today. Outside wave 18's own cumulative diff (configGen.js wasn't
touched by CCA-64/14.3/14.4/61), so left for whoever picks up this task rather than fixed in that
wave's cleanup. Distinct from the other configGen.js finding already recorded above (the
`apiBaseLine`/unconditional-`api_key` integration risk) -- this one is just a stale comment.
<!-- SECTION:NOTES:END -->
