'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { migrateLegacyConfigDir } = require('../../src/engine/configDirMigration');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nim-configdir-migration-test-'));
}

/** Mimics a real pre-NCOW-12 install: config.yaml, litellm.env, manifest.json,
 * plus the two generated files that embed the OLD directory's absolute path. */
function seedLegacyInstall(legacyDir) {
  fs.mkdirSync(path.join(legacyDir, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'config.yaml'), 'model_list: []\n');
  fs.writeFileSync(path.join(legacyDir, 'litellm.env'), 'NVIDIA_NIM_API_KEY=nvapi-fake\nLITELLM_MASTER_KEY=sk-litellm-fake\n');
  fs.writeFileSync(path.join(legacyDir, 'manifest.json'), JSON.stringify({ port: 4000 }, null, 2));
  fs.writeFileSync(
    path.join(legacyDir, 'run.js'),
    `const env = require(${JSON.stringify(path.join(legacyDir, 'litellm.env'))});\n` +
      `const cfg = ${JSON.stringify(path.join(legacyDir, 'config.yaml'))};\n`
  );
  fs.writeFileSync(
    path.join(legacyDir, 'ecosystem.config.cjs'),
    `module.exports = { apps: [{ name: 'litellm-nim', script: ${JSON.stringify(path.join(legacyDir, 'run.js'))}, ` +
      `out_file: ${JSON.stringify(path.join(legacyDir, 'logs', 'out.log'))} }] };\n`
  );
}

test('migrateLegacyConfigDir: moves a pre-rename install to the new directory name', () => {
  const root = tempRoot();
  const legacyDir = path.join(root, 'claude-nim-proxy');
  const newDir = path.join(root, 'claude-conduit');
  seedLegacyInstall(legacyDir);

  const result = migrateLegacyConfigDir({ legacyConfigDir: legacyDir, newConfigDir: newDir });

  assert.equal(result.migrated, true);
  assert.equal(fs.existsSync(legacyDir), false, 'old directory is gone, not duplicated');
  assert.equal(fs.existsSync(path.join(newDir, 'config.yaml')), true);
  assert.equal(
    fs.readFileSync(path.join(newDir, 'litellm.env'), 'utf8'),
    'NVIDIA_NIM_API_KEY=nvapi-fake\nLITELLM_MASTER_KEY=sk-litellm-fake\n',
    'secrets carry over byte-for-byte'
  );
});

test('migrateLegacyConfigDir: repairs absolute paths baked into run.js and ecosystem.config.cjs', () => {
  const root = tempRoot();
  const legacyDir = path.join(root, 'claude-nim-proxy');
  const newDir = path.join(root, 'claude-conduit');
  seedLegacyInstall(legacyDir);

  migrateLegacyConfigDir({ legacyConfigDir: legacyDir, newConfigDir: newDir });

  const runJs = fs.readFileSync(path.join(newDir, 'run.js'), 'utf8');
  const ecosystem = fs.readFileSync(path.join(newDir, 'ecosystem.config.cjs'), 'utf8');
  assert.doesNotMatch(runJs, /claude-nim-proxy/, 'no stale legacy path left in run.js');
  assert.doesNotMatch(ecosystem, /claude-nim-proxy/, 'no stale legacy path left in ecosystem.config.cjs');
  assert.match(runJs, new RegExp(path.join(newDir, 'litellm.env').replace(/[\\.]/g, '\\$&')));
  assert.match(ecosystem, new RegExp(path.join(newDir, 'run.js').replace(/[\\.]/g, '\\$&')));
});

test('migrateLegacyConfigDir: repairs paths whose JSON.stringify escaping doubles backslashes (win32-style paths)', () => {
  // configGen.js's renderRunLauncherJs/renderEcosystemConfigCjs embed every
  // absolute path via JSON.stringify(...) (see those functions' own doc
  // comments). On a real win32 machine that means the *file text* contains
  // doubled backslashes (JSON.stringify escapes each `\` to `\\`), not the
  // raw single-backslash path — a naive content.includes(legacyConfigDir)
  // (single backslashes) therefore silently finds nothing there, even though
  // the exact same code correctly matches on POSIX paths (no backslash to
  // escape). Constructing win32-style paths directly here (independent of
  // process.platform / path.join's actual separator) reproduces that on any
  // CI runner, not just a real Windows one.
  const root = tempRoot();
  const legacyDir = `${root}\\claude-nim-proxy`;
  const newDir = `${root}\\claude-conduit`;
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'config.yaml'), 'model_list: []\n');
  fs.writeFileSync(path.join(legacyDir, 'litellm.env'), 'NVIDIA_NIM_API_KEY=nvapi-fake\n');
  fs.writeFileSync(path.join(legacyDir, 'manifest.json'), JSON.stringify({ port: 4000 }, null, 2));
  const litellmEnvPath = `${legacyDir}\\litellm.env`;
  fs.writeFileSync(
    path.join(legacyDir, 'run.js'),
    `const env = require(${JSON.stringify(litellmEnvPath)});\n`
  );

  const result = migrateLegacyConfigDir({ legacyConfigDir: legacyDir, newConfigDir: newDir });

  assert.equal(result.migrated, true);
  const runJs = fs.readFileSync(path.join(newDir, 'run.js'), 'utf8');
  assert.doesNotMatch(runJs, /claude-nim-proxy/, 'no stale legacy path left in run.js');
  assert.match(
    runJs,
    new RegExp(JSON.stringify(`${newDir}\\litellm.env`).slice(1, -1).replace(/[\\.]/g, '\\$&')),
    'run.js now embeds the new dir, still correctly JSON-escaped'
  );
});

test('migrateLegacyConfigDir: no-op (fresh install) when neither directory exists', () => {
  const root = tempRoot();
  const result = migrateLegacyConfigDir({
    legacyConfigDir: path.join(root, 'claude-nim-proxy'),
    newConfigDir: path.join(root, 'claude-conduit'),
  });
  assert.deepEqual(result, { migrated: false, reason: 'no-legacy-dir' });
});

test('migrateLegacyConfigDir: no-op when the new directory already exists — never clobbers it', () => {
  const root = tempRoot();
  const legacyDir = path.join(root, 'claude-nim-proxy');
  const newDir = path.join(root, 'claude-conduit');
  seedLegacyInstall(legacyDir);
  fs.mkdirSync(newDir, { recursive: true });
  fs.writeFileSync(path.join(newDir, 'manifest.json'), JSON.stringify({ port: 9999 }, null, 2));

  const result = migrateLegacyConfigDir({ legacyConfigDir: legacyDir, newConfigDir: newDir });

  assert.deepEqual(result, { migrated: false, reason: 'new-dir-already-exists' });
  assert.equal(fs.existsSync(legacyDir), true, 'legacy dir left untouched');
  assert.equal(JSON.parse(fs.readFileSync(path.join(newDir, 'manifest.json'), 'utf8')).port, 9999);
});

test('migrateLegacyConfigDir: is safe to call twice in a row (idempotent across restarts)', () => {
  const root = tempRoot();
  const legacyDir = path.join(root, 'claude-nim-proxy');
  const newDir = path.join(root, 'claude-conduit');
  seedLegacyInstall(legacyDir);

  const first = migrateLegacyConfigDir({ legacyConfigDir: legacyDir, newConfigDir: newDir });
  const second = migrateLegacyConfigDir({ legacyConfigDir: legacyDir, newConfigDir: newDir });

  assert.equal(first.migrated, true);
  assert.deepEqual(second, { migrated: false, reason: 'new-dir-already-exists' });
});
