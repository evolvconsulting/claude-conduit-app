'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { uninstall } = require('../../src/engine/uninstall');
const { mergeClaudeCodeSettings, ENV_KEYS } = require('../../src/engine/claudeCodeConfig');

function fakePm2Control() {
  let removed = false;
  return { remove: async () => { removed = true; }, wasRemoved: () => removed };
}

function tempConfigDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nim-uninstall-test-'));
}

test('uninstall: keep (no purge) removes pm2 app and CLI config but leaves the config directory', async () => {
  const configDir = tempConfigDir();
  fs.writeFileSync(path.join(configDir, 'config.yaml'), 'model_list: []\n');
  const settingsPath = path.join(configDir, 'settings.json');
  mergeClaudeCodeSettings(settingsPath, { port: 4000, masterKey: 'sk-litellm-abc' });

  const pm2Control = fakePm2Control();
  const result = await uninstall({
    configDir,
    manifest: { cli_configured: true, settings_file: settingsPath, env_keys_set: ENV_KEYS },
    pm2Control,
    purge: false,
  });

  assert.ok(pm2Control.wasRemoved());
  assert.ok(result.removed.includes('pm2-app'));
  assert.ok(result.removed.includes('claude-code-cli-config'));
  assert.ok(result.kept.includes(configDir));
  assert.ok(fs.existsSync(configDir), 'config dir must survive a non-purge uninstall');

  const finalSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  for (const key of ENV_KEYS) assert.equal(key in finalSettings.env, false);
});

test('uninstall: purge additionally deletes the config directory entirely', async () => {
  const configDir = tempConfigDir();
  fs.writeFileSync(path.join(configDir, 'config.yaml'), 'model_list: []\n');

  const pm2Control = fakePm2Control();
  const result = await uninstall({ configDir, manifest: null, pm2Control, purge: true });

  assert.ok(result.removed.includes('config-directory'));
  assert.equal(fs.existsSync(configDir), false);
});

test('uninstall: skips Claude Code CLI removal entirely when it was never configured', async () => {
  const configDir = tempConfigDir();
  const pm2Control = fakePm2Control();
  const result = await uninstall({ configDir, manifest: { cli_configured: false }, pm2Control, purge: false });
  assert.equal(result.removed.includes('claude-code-cli-config'), false);
});

test('uninstall: is safe to run with no manifest at all (nothing was ever configured)', async () => {
  const configDir = tempConfigDir();
  const pm2Control = fakePm2Control();
  const result = await uninstall({ configDir, manifest: null, pm2Control, purge: false });
  assert.ok(pm2Control.wasRemoved());
  assert.equal(result.removed.includes('claude-code-cli-config'), false);
});

test('uninstall: never touches Claude Desktop as a side effect', async () => {
  // Purely structural: uninstall() must not require() claudeDesktopConfig at
  // all, so there is nothing for it to call — asserted by import inspection
  // rather than a runtime check, since that IS the guarantee. (Mentioning
  // the module name in a doc comment, as this file does, is fine — only an
  // actual require(...) call would be a real dependency.)
  const src = fs.readFileSync(require.resolve('../../src/engine/uninstall.js'), 'utf8');
  assert.doesNotMatch(src, /require\(['"]\.\/claudeDesktopConfig['"]\)/);
});
