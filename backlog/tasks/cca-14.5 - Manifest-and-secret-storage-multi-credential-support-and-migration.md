---
id: CCA-14.5
title: 'Manifest and secret storage: multi-credential support and migration'
status: In Progress
assignee: []
created_date: '2026-08-16 14:45'
updated_date: '2026-08-17 15:15'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. manifest.js: add a `provider` field to the schema + resolveManifestProviderId(manifest) as
   the single place every reader defaults an absent field to 'nvidia-nim' (every pre-CCA-14.5
   install, unambiguously).
2. secretStore.js: add saveFor/loadFor/clearFor(providerId), additive per-provider credential
   files under a `<storagePath>.credentials/` sibling dir. Legacy save/load/clear (single file)
   untouched -- zero migration needed for it. importFromExistingEnvFile() gains an optional
   providerId arg.
3. configGen.js: resolveExistingNvidiaApiKey becomes resolveExistingApiKeyForEnvVar(envVar)
   under the hood; regenerateStaleConfig() takes an optional `provider` opt (id/apiKeyEnvVar/
   litellmProvider), defaulting to NVIDIA's values for backward compatibility. On success,
   backfills manifest.provider in the same saveManifest call that stamps generated_by_version.
   Also fixes configGen.js:379's stale "today's only provider" comment (forward-flagged finding
   #3 from wave-18's review).
4. engine-context.js: config.generate() stamps provider: activeProvider.id. The regen path
   resolves its provider from manifestStore.resolveManifestProviderId(manifest) via
   providers.getProvider(...), reading the manifest back rather than activeProvider, so the
   stamped field is load-bearing once CCA-15 lands. Unknown provider id falls back to
   activeProvider rather than throwing.
5. Prove AC#3 non-vacuously: construct a real pre-CCA-14.5 fixture (no manifest.provider field,
   litellm.env with NVIDIA_NIM_API_KEY, a legacy encrypted nim-key.enc in the real
   apiKey.validateAndSave() shape), run actual createEngineContext() with a bumped appVersion
   (the real upgrade trigger), assert manifest.json gains provider:'nvidia-nim' on disk, the key
   survives under the same env var, and getMasked() still works with zero manual steps.

Decision on the two forward-flagged configGen.js findings (documented, not silently decided):
finding #3 (stale comment) fixed. Finding #2 (apiBaseLine-only-on-first-entry + unconditional
api_key with no keyless-provider path) left OUT of scope -- unreachable today (no registered
provider has apiKeyEnvVar:null), and fixing it means restructuring the live config-generation
YAML/env format, materially riskier/bigger than this task's data-layer scope.
<!-- SECTION:PLAN:END -->

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

IMPLEMENTED (worker, wave 19).

npm test: worker reports 550 total/548 pass/2 fail BEFORE any changes (test/main/licenses.test.js,
test/renderer/about-dialog.test.js -- both "Electron failed to install correctly" errors,
attributed to this fresh worktree's node_modules/electron still settling right after npm
install/creation, not caused by this task). Re-ran clean twice AFTER changes: 580/580 pass, 0
fail, both times. Worker notes the 550->580 jump (vs 550+18-new) is explained by the crash
having undercounted registered tests in the two crashed files, not just failed 2 -- reviewer
should independently confirm this arithmetic and confirm the pre-existing-flake explanation
rather than trust it.

AC#3 non-vacuous proof: new test in test/main/engine-context-config-regen.test.js constructs a
real pre-CCA-14.5 fixture (manifest with no provider field, litellm.env with
NVIDIA_NIM_API_KEY, a legacy encrypted nim-key.enc in the real apiKey.validateAndSave() shape),
runs actual createEngineContext() with a bumped appVersion (the real upgrade trigger), and
asserts manifest.json on disk gains provider:'nvidia-nim' (genuine migration, not just a
runtime default), the key survives under the same env var, and getMasked() still works with
zero manual steps.

Files touched: src/engine/manifest.js, src/engine/secretStore.js, src/engine/configGen.js,
src/main/engine-context.js, test/engine/manifest.test.js, test/engine/secretStore.test.js,
test/engine/configGen.test.js, test/main/engine-context-config-regen.test.js. Also updated 2
pre-existing exact-patch assertions in configGen.test.js that the provider-backfill change
intentionally altered (flagged, not silent -- reviewer should confirm these 2 updated
assertions are legitimate and not a weakened guarantee).

Commits on feat/CCA-14.5-multi-credential-secrets (pushed): a81e0fc (manifest), ddfc6c1
(secretStore), dac33be (configGen), d5c9eaf (engine-context).

Judgment call on the two forward-flagged configGen.js findings: #3 (stale comment) fixed,
grepped whole repo, only instance. #2 (apiBaseLine/api_key keyless-provider gap) left OUT of
scope -- unreachable today (no registered provider has apiKeyEnvVar:null), fixing it means
restructuring the live config-generation format, judged materially riskier/bigger than this
task's data-layer scope. Reviewer should independently assess whether this call was reasonable.

REVIEW PASS 1 (opus): REQUEST_CHANGES. Confirmed AC indices: [1, 2, 3, 4] -- all four
independently confirmed; the blocking finding is a test-coverage gap on supporting production
code, not an AC failure.

npm test personally observed: dev baseline 562/562 (matches CLAUDE.md exactly), branch 580/580
twice. Count reconciles exactly (562 + 18 new = 580) -- no regression, no unexplained drift.
Worker's reported 550/548/2 confirmed as a genuine transient (both files pass standalone and
in the full suite now).

BLOCKING F1: the engine-context.js change (regenProvider resolved from
manifestStore.resolveManifestProviderId() rather than activeProvider) has ZERO regression
protection. Reviewer reverted just that one line in a scratch copy -- suite still passed
578/580 (only the pre-existing symlink artifact difference), meaning nothing catches this
being silently undone by a future refactor. This undermines the worker's own stated
justification for touching engine-context.js at all ("the recorded field is read back, not
write-only").

Required fix: add an integration test to test/main/engine-context-config-regen.test.js driving
createEngineContext() with a manifest recording provider:'openrouter' and a litellm.env holding
only OPENROUTER_API_KEY, asserting {regenerated:true, restarted:false}, the OpenRouter env var
in the regenerated env, and openrouter/ in the yaml. Reviewer already proved this discriminates
correctly (fails on the mutation, passes on real branch source) -- reuse that shape.

Non-blocking (not gating): F2 (credentialPathFor() not injective across different providerId
strings that sanitize to the same value -- unreachable with today's 3 code-owned ids, but the
code comment overclaims "regardless of what a future caller passes"), F3 (an unresolvable
manifest.provider value is preserved verbatim rather than self-healing to a known id -- harmless
today, latent risk after CCA-15), F4 (the new .credentials/ dir has no lifecycle owner yet --
clear()/uninstall.js/migrateLegacyKeyFile() don't touch it -- zero impact today), F5 (CLAUDE.md's
test count is stale at 562 vs branch's 580 -- correctly deferred to wave-19 cleanup since CCA-63
owns CLAUDE.md this wave), F6 (the worker's own baseline arithmetic in commit d5c9eaf's message
is off -- cosmetic, superseded by the reviewer's own clean reconciliation).

Migration depth check (all independently run by reviewer, not read): second regen pass at same
version is a correct no-op (zero pm2 calls); version-bump regen is idempotent and preserves
provider; unknown-provider fallback engages without crashing (also null manifest -> nvidia-nim,
no throw); a real-but-mismatched provider fails safe (no-existing-secrets, doesn't corrupt);
fixture fidelity confirmed byte-exact against the real createSecretStore/fakeSafeStorage
round-trip; non-vacuity proven by mutation (deleting the provider backfill fails the AC#3 test).

Scope judgment: engine-context.js touch judged justified, not creep (activeProvider is a
module-level constant that will diverge from per-connection reality once CCA-15 lands -- but
must be tested, hence F1). Finding-#2 deferral judged reasonable and actually safer than the
worker claimed -- reviewer verified all 3 registered providers have concrete apiKeyEnvVar
values, and the regen path is structurally immune (falsy apiKeyEnvVar short-circuits to null
before generateAll is ever called).

Everything else confirmed clean: AC#1 single-place claim holds (only other manifest.provider
touch is configGen.js's own idempotent preserve-if-set logic); AC#2 legacy path verified
byte-for-byte unchanged structurally; the 2 updated pre-existing assertions are not weakened
(gained a new correct key, didn't loosen the match); scope exactly the 8 files; zero overlap
with CCA-63/CCA-65.

FIX PASS 1 (worker): addressed blocking F1. Added a discriminating regression test to
test/main/engine-context-config-regen.test.js via a new seedStaleOpenRouterInstall(homeDir)
fixture (mirrors the file's existing seedStaleInstall convention): manifest.provider =
'openrouter', litellm.env holding ONLY OPENROUTER_API_KEY (no NVIDIA_NIM_API_KEY anywhere on
disk). Asserts regen produces OpenRouter-shaped output.

npm test: 580/580 before, 581/581 after. Non-vacuity reproduced exactly per the reviewer's own
method: manually reverted engine-context.js's regenProvider line to always use activeProvider
(uncommitted scratch edit) -- new test failed with {regenerated:false, reason:
'no-existing-secrets'}, all 27 other tests in that file still passed; reverted cleanly, both
green again.

Files touched: test/main/engine-context-config-regen.test.js only (engine-context.js itself
untouched, confirmed via git diff). F2-F6 correctly left untouched per instructions.

Commit on feat/CCA-14.5-multi-credential-secrets (pushed): 61702ec.
<!-- SECTION:NOTES:END -->
