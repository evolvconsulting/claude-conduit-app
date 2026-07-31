'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ENV_KEYS,
  mergeClaudeCodeSettings,
  removeClaudeCodeSettings,
  SettingsUnparseableError,
} = require('../../src/engine/claudeCodeConfig');

function tempSettingsPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-claudecode-test-'));
  return path.join(dir, 'settings.json');
}

// Modeled on a real ~/.claude/settings.json shape (permissions.deny list,
// hooks, a top-level model, pre-existing unrelated env vars) — a fixture,
// never the real file on this machine.
const REALISTIC_FIXTURE = {
  env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1', ECK_HOME: '/Users/example/.claude/evolv-coder-kit' },
  permissions: { deny: ['Bash(rm -rf /)', 'Bash(sudo *)'], defaultMode: 'auto' },
  model: 'sonnet',
  hooks: {
    PostToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'node "/hooks/monitor.js"' }] }],
  },
};

test('mergeClaudeCodeSettings: starts from {} when the file does not exist yet, no backup created', () => {
  const settingsPath = tempSettingsPath();
  const { backupPath, keysSet } = mergeClaudeCodeSettings(settingsPath, { port: 4000, masterKey: 'sk-litellm-abc' });

  assert.equal(backupPath, null);
  assert.deepEqual(keysSet, ENV_KEYS);

  const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.equal(written.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:4000');
  assert.equal(written.env.ANTHROPIC_AUTH_TOKEN, 'sk-litellm-abc');
});

test('mergeClaudeCodeSettings: preserves every unrelated key byte-for-byte against a realistic fixture', () => {
  const settingsPath = tempSettingsPath();
  fs.writeFileSync(settingsPath, JSON.stringify(REALISTIC_FIXTURE, null, 2));

  const { backupPath } = mergeClaudeCodeSettings(settingsPath, { port: 4000, masterKey: 'sk-litellm-abc' });
  assert.ok(backupPath && fs.existsSync(backupPath));
  assert.deepEqual(JSON.parse(fs.readFileSync(backupPath, 'utf8')), REALISTIC_FIXTURE);

  const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  // Untouched top-level keys.
  assert.deepEqual(written.permissions, REALISTIC_FIXTURE.permissions);
  assert.equal(written.model, 'sonnet');
  assert.deepEqual(written.hooks, REALISTIC_FIXTURE.hooks);
  // Untouched pre-existing env entries.
  assert.equal(written.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS, '1');
  assert.equal(written.env.ECK_HOME, '/Users/example/.claude/evolv-coder-kit');
  // The 11 documented keys were added.
  for (const key of ENV_KEYS) assert.ok(key in written.env, `${key} should be set`);
});

test('mergeClaudeCodeSettings: unparseable JSON aborts with no write and no backup', () => {
  const settingsPath = tempSettingsPath();
  fs.writeFileSync(settingsPath, '{ this is not valid json');

  assert.throws(() => mergeClaudeCodeSettings(settingsPath, { port: 4000, masterKey: 'k' }), SettingsUnparseableError);
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{ this is not valid json');
  assert.equal(fs.readdirSync(path.dirname(settingsPath)).length, 1, 'no backup or temp file should have been created');
});

test('mergeClaudeCodeSettings: a non-object top-level JSON value (e.g. an array) is also treated as unparseable', () => {
  const settingsPath = tempSettingsPath();
  fs.writeFileSync(settingsPath, '[1,2,3]');
  assert.throws(() => mergeClaudeCodeSettings(settingsPath, { port: 4000, masterKey: 'k' }), SettingsUnparseableError);
});

test('mergeClaudeCodeSettings: idempotent re-run overwrites only the 11 keys again, nothing duplicated or corrupted', () => {
  const settingsPath = tempSettingsPath();
  mergeClaudeCodeSettings(settingsPath, { port: 4000, masterKey: 'sk-litellm-first' });
  mergeClaudeCodeSettings(settingsPath, { port: 4001, masterKey: 'sk-litellm-second' });

  const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.equal(written.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:4001');
  assert.equal(written.env.ANTHROPIC_AUTH_TOKEN, 'sk-litellm-second');
  assert.equal(Object.keys(written.env).length, ENV_KEYS.length);
});

test('removeClaudeCodeSettings: removes exactly the recorded keys, preserving everything else', () => {
  const settingsPath = tempSettingsPath();
  fs.writeFileSync(settingsPath, JSON.stringify(REALISTIC_FIXTURE, null, 2));
  const { keysSet } = mergeClaudeCodeSettings(settingsPath, { port: 4000, masterKey: 'sk-litellm-abc' });

  const { removed } = removeClaudeCodeSettings(settingsPath, keysSet);
  assert.deepEqual(removed.sort(), [...ENV_KEYS].sort());

  const finalSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.deepEqual(finalSettings.env, REALISTIC_FIXTURE.env);
  assert.deepEqual(finalSettings.permissions, REALISTIC_FIXTURE.permissions);
  assert.equal(finalSettings.model, 'sonnet');
  assert.deepEqual(finalSettings.hooks, REALISTIC_FIXTURE.hooks);
});

test('removeClaudeCodeSettings: merge-then-remove round trip restores the original content exactly', () => {
  const settingsPath = tempSettingsPath();
  fs.writeFileSync(settingsPath, JSON.stringify(REALISTIC_FIXTURE, null, 2) + '\n');
  const originalParsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

  const { keysSet } = mergeClaudeCodeSettings(settingsPath, { port: 4000, masterKey: 'sk-litellm-abc' });
  removeClaudeCodeSettings(settingsPath, keysSet);

  assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), originalParsed);
});

test('removeClaudeCodeSettings: a no-op (never configured) file is left untouched, no backup created', () => {
  const settingsPath = tempSettingsPath();
  fs.writeFileSync(settingsPath, JSON.stringify({ model: 'sonnet' }));
  const { removed, backupPath } = removeClaudeCodeSettings(settingsPath, ENV_KEYS);
  assert.deepEqual(removed, []);
  assert.ok(backupPath);
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsPath, 'utf8')), { model: 'sonnet' });
});

test('removeClaudeCodeSettings: missing file is a safe no-op', () => {
  const result = removeClaudeCodeSettings('/nonexistent/settings.json', ENV_KEYS);
  assert.deepEqual(result.removed, []);
});
