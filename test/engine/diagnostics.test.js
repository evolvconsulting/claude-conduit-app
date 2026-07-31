'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildRequestA, buildRequestB, checkCliConfigCoherent, buildLiveCliSmokeEnv } = require('../../src/engine/diagnostics');
const { ENV_KEYS } = require('../../src/engine/claudeCodeConfig');

test('buildRequestA: matches DESIGN.md section 11 Request A shape exactly', () => {
  const req = buildRequestA({ model: 'claude-sonnet-4-5' });
  assert.deepEqual(req, { model: 'claude-sonnet-4-5', max_tokens: 64, messages: [{ role: 'user', content: 'Reply with exactly: OK' }] });
});

test('buildRequestA: stream:true is added only when requested', () => {
  assert.equal(buildRequestA().stream, undefined);
  assert.equal(buildRequestA({ stream: true }).stream, true);
});

test('buildRequestB: adds the get_weather tool per DESIGN.md section 11 Request B', () => {
  const req = buildRequestB({ model: 'claude-sonnet-4-5' });
  assert.equal(req.tools[0].name, 'get_weather');
  assert.deepEqual(req.tools[0].input_schema.required, ['city']);
  assert.match(req.messages[0].content, /weather in Paris/);
});

test('checkCliConfigCoherent: passes (warn-only, not-configured) when cli_configured is false', async () => {
  const r = await checkCliConfigCoherent({ manifest: { cli_configured: false } });
  assert.equal(r.critical, false);
  assert.equal(r.status, 'pass');
});

// Regression test for a real, confirmed-live bug (2026-07-31): this
// originally read manifest.master_key, a field manifest.json never actually
// contains (DESIGN.md section 9.3's own schema keeps secrets out of it —
// the master key only ever lives in litellm.env). The original version of
// this test masked the bug by inventing a master_key field on the manifest
// fixture that doesn't reflect how the real app populates it — a live
// end-to-end run caught what this unit test's unrealistic fixture missed.
test('checkCliConfigCoherent: passes when settings.json matches the manifest (masterKey passed separately, not read from manifest)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-diag-cli-test-'));
  const settingsPath = path.join(dir, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:4000', ANTHROPIC_AUTH_TOKEN: 'sk-litellm-abc' } }));

  const r = await checkCliConfigCoherent({
    manifest: { cli_configured: true, port: 4000 }, // deliberately no master_key field — matches the real manifest schema
    masterKey: 'sk-litellm-abc',
    settingsPath,
  });
  assert.equal(r.status, 'pass');
});

test('checkCliConfigCoherent: warns (fails, non-critical) when settings.json has drifted from the manifest', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-diag-cli-test-'));
  const settingsPath = path.join(dir, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9999', ANTHROPIC_AUTH_TOKEN: 'sk-litellm-abc' } }));

  const r = await checkCliConfigCoherent({
    manifest: { cli_configured: true, port: 4000 },
    masterKey: 'sk-litellm-abc',
    settingsPath,
  });
  assert.equal(r.critical, false);
  assert.equal(r.status, 'fail');
});

// Regression test for a real, confirmed-live bug (2026-07-31): check 10
// originally hand-rolled a PARTIAL env var subset for the `claude -p` smoke
// test, missing CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC and
// CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS in particular. Reproduced live: the
// claude CLI, invoked without those two flags against a NIM-backed gateway,
// hung indefinitely (confirmed past 5 minutes, requiring a manual SIGKILL of
// an orphaned subprocess) — execFile's own `timeout` did not reliably kill
// it once the CLI had spawned its own child. Fixed by reusing the exact
// same buildEnvValues() the Claude Code CLI integration itself uses.
test('buildLiveCliSmokeEnv: sets every one of the 11 DESIGN.md section 9.1 keys, not a partial subset', () => {
  const env = buildLiveCliSmokeEnv({ port: 4000, masterKey: 'sk-litellm-abc', primaryModel: 'x', smallModel: 'y', baseEnv: {} });
  for (const key of ENV_KEYS) {
    assert.ok(key in env, `${key} must be set — a missing env var here previously caused the claude CLI to hang indefinitely`);
  }
  assert.equal(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
  assert.equal(env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS, '1');
});

test('buildLiveCliSmokeEnv: preserves the surrounding process env rather than replacing it', () => {
  const env = buildLiveCliSmokeEnv({ port: 4000, masterKey: 'k', baseEnv: { PATH: '/usr/bin', HOME: '/Users/example' } });
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/Users/example');
});

test('buildLiveCliSmokeEnv: omits the default-model overrides when no model was given', () => {
  const env = buildLiveCliSmokeEnv({ port: 4000, masterKey: 'k', baseEnv: {} });
  assert.equal('ANTHROPIC_DEFAULT_SONNET_MODEL' in env, false);
  assert.equal('ANTHROPIC_DEFAULT_HAIKU_MODEL' in env, false);
});
