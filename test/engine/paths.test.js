'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  resolveConfigDir,
  getFilePaths,
  resolveClaudeCodeSettingsPath,
  resolveClaudeDesktopConfigLibraryDir,
} = require('../../src/engine/paths');

test('resolveConfigDir: macOS/Linux use ~/.config/claude-nim-proxy exactly, per DESIGN.md section 2', () => {
  for (const platform of ['darwin', 'linux']) {
    assert.equal(
      resolveConfigDir({ platform, homedir: '/Users/alice' }),
      path.join('/Users/alice', '.config', 'claude-nim-proxy')
    );
  }
});

test('resolveConfigDir: Windows uses %APPDATA%\\claude-nim-proxy', () => {
  assert.equal(
    resolveConfigDir({ platform: 'win32', homedir: 'C:\\Users\\alice', appData: 'C:\\Users\\alice\\AppData\\Roaming' }),
    path.join('C:\\Users\\alice\\AppData\\Roaming', 'claude-nim-proxy')
  );
});

test('getFilePaths: matches DESIGN.md section 2 file table plus run.js/legacyRunSh', () => {
  const files = getFilePaths('/cfg');
  assert.equal(files.configYaml, path.join('/cfg', 'config.yaml'));
  assert.equal(files.litellmEnv, path.join('/cfg', 'litellm.env'));
  assert.equal(files.runLauncher, path.join('/cfg', 'run.js'));
  assert.equal(files.legacyRunSh, path.join('/cfg', 'run.sh'));
  assert.equal(files.ecosystemConfig, path.join('/cfg', 'ecosystem.config.cjs'));
  assert.equal(files.manifestJson, path.join('/cfg', 'manifest.json'));
  assert.equal(files.desktopSetupMd, path.join('/cfg', 'DESKTOP-SETUP.md'));
  assert.equal(files.outLog, path.join('/cfg', 'logs', 'out.log'));
  assert.equal(files.errLog, path.join('/cfg', 'logs', 'err.log'));
});

test('resolveClaudeCodeSettingsPath: same ~/.claude/settings.json on every platform', () => {
  assert.equal(resolveClaudeCodeSettingsPath({ homedir: '/home/bob' }), path.join('/home/bob', '.claude', 'settings.json'));
});

test('resolveClaudeDesktopConfigLibraryDir: confirmed per-platform paths', () => {
  assert.equal(
    resolveClaudeDesktopConfigLibraryDir({ platform: 'darwin', homedir: '/Users/alice' }),
    path.join('/Users/alice', 'Library', 'Application Support', 'Claude-3p', 'configLibrary')
  );
  assert.equal(
    resolveClaudeDesktopConfigLibraryDir({
      platform: 'win32',
      homedir: 'C:\\Users\\alice',
      localAppData: 'C:\\Users\\alice\\AppData\\Local',
    }),
    path.join('C:\\Users\\alice\\AppData\\Local', 'Claude-3p', 'configLibrary')
  );
  assert.equal(
    resolveClaudeDesktopConfigLibraryDir({ platform: 'linux', homedir: '/home/bob' }),
    path.join('/home/bob', '.config', 'Claude-3p', 'configLibrary')
  );
});
