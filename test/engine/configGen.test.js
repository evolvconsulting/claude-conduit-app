'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  renderConfigYaml,
  renderRunLauncherJs,
  renderEcosystemConfigCjs,
  resolveMasterKey,
  writeSecretsEnvFile,
} = require('../../src/engine/configGen');

test('renderConfigYaml: matches DESIGN.md section 6.1 — drop_params, wildcard, no api_base by default', () => {
  const yaml = renderConfigYaml({ primaryModelId: 'qwen/qwen3-coder-480b-a35b-instruct', smallModelId: 'meta/llama-3.1-8b-instruct' });
  assert.match(yaml, /model_name: claude-sonnet-4-5/);
  assert.match(yaml, /model: nvidia_nim\/qwen\/qwen3-coder-480b-a35b-instruct/);
  assert.match(yaml, /model_name: claude-haiku-4-5/);
  assert.match(yaml, /model: nvidia_nim\/meta\/llama-3\.1-8b-instruct/);
  assert.match(yaml, /model_name: "claude-\*"/);
  assert.match(yaml, /drop_params: true/);
  assert.match(yaml, /num_retries: 2/);
  assert.match(yaml, /request_timeout: 600/);
  assert.match(yaml, /master_key: os\.environ\/LITELLM_MASTER_KEY/);
  assert.doesNotMatch(yaml, /api_base:/);
});

test('renderConfigYaml: emits api_base only when nimBaseUrl is given', () => {
  const yaml = renderConfigYaml({ primaryModelId: 'a/b', smallModelId: 'c/d', nimBaseUrl: 'https://self-hosted.example/v1' });
  assert.match(yaml, /api_base: https:\/\/self-hosted\.example\/v1/);
});

test('renderRunLauncherJs: always binds 127.0.0.1, never 0.0.0.0, and never inlines a secret', () => {
  const js = renderRunLauncherJs({
    litellmEnvPath: '/cfg/litellm.env',
    litellmAbsPath: '/usr/local/bin/litellm',
    configYamlPath: '/cfg/config.yaml',
    port: 4000,
  });
  assert.match(js, /'127\.0\.0\.1'/);
  assert.doesNotMatch(js, /0\.0\.0\.0/);
  assert.doesNotMatch(js, /nvapi-/);
  assert.doesNotMatch(js, /sk-litellm-/);
  assert.match(js, /loadEnvFile\("\/cfg\/litellm\.env"\)/);
});

test('renderRunLauncherJs: is syntactically valid JS (roundtrips through the Function constructor without throwing)', () => {
  const js = renderRunLauncherJs({ litellmEnvPath: '/a', litellmAbsPath: '/b', configYamlPath: '/c', port: 4000 });
  assert.doesNotThrow(() => new Function('require', 'process', js));
});

test('renderEcosystemConfigCjs: no secret ever appears, and paths with spaces/backslashes survive via JSON.stringify escaping', () => {
  const cjs = renderEcosystemConfigCjs({
    runLauncherPath: 'C:\\Users\\Jeremy Newhouse\\claude-nim-proxy\\run.js',
    outLog: 'C:\\Users\\Jeremy Newhouse\\claude-nim-proxy\\logs\\out.log',
    errLog: 'C:\\Users\\Jeremy Newhouse\\claude-nim-proxy\\logs\\err.log',
  });
  assert.doesNotMatch(cjs, /nvapi-/);
  assert.doesNotMatch(cjs, /sk-litellm-/);
  assert.doesNotThrow(() => {
    const mod = { exports: {} };
    new Function('module', 'exports', cjs)(mod, mod.exports);
    assert.equal(mod.exports.apps[0].script, 'C:\\Users\\Jeremy Newhouse\\claude-nim-proxy\\run.js');
  });
});

test('renderEcosystemConfigCjs: name is litellm-nim and autorestart is on, per DESIGN.md section 7.1', () => {
  const cjs = renderEcosystemConfigCjs({ runLauncherPath: '/r.js', outLog: '/o.log', errLog: '/e.log' });
  const mod = { exports: {} };
  new Function('module', 'exports', cjs)(mod, mod.exports);
  assert.equal(mod.exports.apps[0].name, 'litellm-nim');
  assert.equal(mod.exports.apps[0].autorestart, true);
  assert.equal(mod.exports.apps[0].max_restarts, 10);
});

test('resolveMasterKey: generates a fresh sk-litellm-* key when no env file exists', () => {
  const key = resolveMasterKey('/nonexistent/litellm.env');
  assert.match(key, /^sk-litellm-[0-9a-f]{48}$/);
});

test('resolveMasterKey: reuses the existing key — idempotent re-setup per DESIGN.md section 4 Step 4', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-configgen-test-'));
  const envPath = path.join(dir, 'litellm.env');
  writeSecretsEnvFile(envPath, { nvidiaApiKey: 'nvapi-abc', masterKey: 'sk-litellm-existing123' });

  assert.equal(resolveMasterKey(envPath), 'sk-litellm-existing123');
});

test('writeSecretsEnvFile: writes both keys and restricts file permissions', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nim-configgen-test-'));
  const envPath = path.join(dir, 'litellm.env');
  writeSecretsEnvFile(envPath, { nvidiaApiKey: 'nvapi-xyz', masterKey: 'sk-litellm-abc' });

  const content = fs.readFileSync(envPath, 'utf8');
  assert.match(content, /^NVIDIA_NIM_API_KEY=nvapi-xyz$/m);
  assert.match(content, /^LITELLM_MASTER_KEY=sk-litellm-abc$/m);

  if (process.platform !== 'win32') {
    const mode = fs.statSync(envPath).mode & 0o777;
    assert.equal(mode, 0o600);
  }
});
